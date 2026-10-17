# Roadmap — Repackshot

Qué hay que hacer, en qué orden, y **qué modelo ejecuta cada fase**. Es
autocontenido: cada fase se puede ejecutar leyendo este documento, los
que enlaza (`SPEC.md`, `ARCHITECTURE.md`, `UI.md`) y el repositorio.

---

## Contexto (leer siempre primero)

Repackshot es un renderizador de producto al estilo KeyShot, de código
disponible y gratuito para uso no comercial (PolyForm Noncommercial 1.0.0),
escrito desde cero en **sala limpia** (reglas en `../README.md`,
innegociables) y que corre en el navegador. Reutiliza las ideas y varias
soluciones de **EZ Packshot**, un addon de Blender del mismo autor
(GPL-3.0; los catálogos y fórmulas se han portado con su permiso y la
implementación es nueva): tipos de producto, catálogo de montajes de luz
por estilos con normalización de exposición, materiales con desgaste
procedural, Doctor, selección por niveles, lenguaje de fotógrafo, guía
con flechas que no tapa.

**Ficheros clave:**

- `src/core/` — modelo de datos puro y *store* (`ARCHITECTURE.md` §4)
- `src/data/` — catálogos portados: 16 estudios, 72 montajes, 77
  materiales, desgaste, ópticas, movimientos, secuencias, Doctor
- `engine/` — **el motor**: Rust desde cero, sin dependencias, portable
  (`ARCHITECTURE.md` §5.1); `rt-core`, `rt-cli`, `rt-wasm`
- `src/render/` — vista previa (three.js) y puente al motor en wasm
  (`ARCHITECTURE.md` §5.0, §5.3)
- `src/ui/` — la interfaz (`UI.md`)
- `tests/` — vitest; `tools/screenshot.mjs` — captura con Chromium local
- `.github/workflows/qa.yml` y `engine.yml` — las dos suites corren en
  cada pull request; la del motor compila cruzado a ARM64, RISC-V y wasm

**Reglas de trabajo no negociables** (ampliadas en `../CLAUDE.md`):

1. Ningún cambio se entrega sin `npm run qa` en verde (y `npm run
   engine:test`, `clippy` y `fmt` si toca el motor).
2. Todo bug corregido lleva su test de regresión, comprobado que falla
   si se reintroduce el bug.
3. Una fase por PR; al cerrarla se marca aquí con un párrafo de qué se
   hizo y qué no encajó con el plan.
4. Cromo acromático; cadenas en `es` y `en`; todo por el *store*; claves
   de catálogo estables; sin binarios ni recursos de KeyShot; **ninguna
   dependencia externa en el motor** y ningún código de otro
   renderizador.
5. Lo marcado **Fable** no lo decide otro modelo: se prepara el terreno y
   se anota.

---

## Cómo usar la columna de responsable

Cada fase lleva el modelo que la ejecuta. El criterio es el tipo de
trabajo, no la dificultad:

- **Fable** — decisiones sin test que las sustituya: arquitectura,
  contratos, fotografía (números de una receta, visto bueno sobre un
  render), criterio visual de la interfaz, revisión de lo entregado.
  Escribe las fases; no las ejecuta salvo que sean solo datos.
- **Opus** — construcción con superficie de diseño grande y muchas
  decisiones acopladas: la interfaz, el motor en Rust (BVH, integrador,
  materiales), los importadores complejos, la animación. Lee la fase, la
  ejecuta entera y anota lo que no encajó.
- **Sonnet** — trabajo mecánico con criterio de corrección claro y
  testeable: portar datos, implementar reductores sobre un contrato dado,
  importadores sencillos, generadores, tests de invariantes.
- **Haiku** — mantenimiento: CI, plantillas, versiones, changelog,
  cadenas, limpieza, sincronizar documentación con lo hecho.

Si una fase resulta más grande de lo previsto, el agente **no la parte
por su cuenta**: entrega lo que cierra con tests, anota lo que falta como
subfase propuesta, y lo deja aquí para que Fable la reparta.

### Cómo se lanza una fase

Quien dirige el proyecto abre una sesión con el modelo indicado y le da
este encargo, cambiando solo el identificador:

> Ejecuta la fase **U1** de `docs/ROADMAP.md` del repositorio Repackshot.
> Lee antes `CLAUDE.md` y los documentos que la fase enlaza. Trabaja en
> una rama, con `npm run qa` en verde, abre un PR con la plantilla y
> marca la fase como hecha en el roadmap con un párrafo de qué hiciste y
> qué no encajó. No toques las fases de otros ni los contratos; si algo
> no encaja, anótalo y sigue.

Para una fase **Fable** el encargo es el mismo, y lo que se espera son
decisiones escritas (datos, contratos, revisión), no código.

---

## Hitos

| Versión | Qué se puede hacer | Fases |
| --- | --- | --- |
| **v0.1** — "parece el producto" | Abre en modo estándar; importa glTF, OBJ, STL, FBX, 3DM, 3MF, PLY, DAE y USD con la hoja de importación; tipo de producto, materiales del catálogo, montaje de luz; el motor en Rust renderizando progresivamente en el visor y a PNG, en el navegador y en la línea de comandos. **Primera release `v0.1.0`** (petición del usuario): además lo ya hecho de v0.2 (U3, U4, U5, I2), los Ajustes con el gestor de modelos, y escritorio con Windows portable, Linux portable e instalador de Windows | F0, A1–A3, U1, U2, I1, I3, E1–E4; para la release también U6, X1 parte A, P2, P1 |
| **v0.2** — "sirve para trabajar" | STEP e IGES con caras CAD; herramienta de mover y operaciones de pieza al estilo KeyShot; focos propios y montajes guardados; biblioteca propia; ventana de render al estilo KeyShot con cola y visor de resultados; vidrio y emisores reales, madera y tela, bisel, colocación por reflejo, campo claro, cielo, HDRI, miniaturas propias, recetas revisadas, cara CAD, pases | I2, U3, U4, U5, L4, E5, E6, L1, L2, L3, M1, N2, D1 |
| **v0.3** — "sustituye al comercial" | Desgaste visible, texturas y etiquetas, animación y vídeo al estilo KeyShot con paseo de cámara, luces IES, lotes nativos, escritorio; tipo de escena *Interior* con sus valores por defecto, habitación paramétrica y cámara de interiores; post-procesado IA opcional | E7, E8, M2, N1, N3, L5, Q1, K1, K2, K3, X1–X4 |
| **v0.4** — "interiores y mobiliario" | El motor renderiza habitaciones iluminadas por ventana con portales, árbol de luces, adaptativo y *denoise*; guiado de caminos; entregables de mobiliario; grupos de luz tras el render | K4, K5, K6, K7, K8 |

---

## Ya hecho (no repetir)

- **F0** · Documentación de arranque: `CLAUDE.md`, `README.md`,
  `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/UI.md`, este roadmap —
  **Fable**.
- **A1** · Andamiaje Vite + TypeScript + vitest + captura con Chromium
  local (`tools/screenshot.mjs`) — **Sonnet**.
- **A2** · Catálogos portados a `src/data/` con tipos, y matemáticas de
  luz en `src/core/light-math.ts`, `rig.ts`, `wear.ts`, con tests de
  recuento, fórmula y normalización 16 × 71 — **Sonnet**.
- **A3** · `.github/workflows/qa.yml`, plantilla de PR, `CONTRIBUTING.md`
  — **Haiku**.
- **E1** · Workspace del motor en Rust sin dependencias: `rt-core`,
  `rt-cli`, `rt-wasm`, formato RSB, PNG propio, lanzador de rayos de
  marcador, CI con cross-compilación a ARM64, RISC-V y wasm — **Sonnet**.
- **U1** · La interfaz completa de `UI.md` sobre el *store*, con el visor
  de vista previa de three.js, modo estándar por defecto, 201 tests y
  capturas en `docs/ui/` — **Opus**.
- **I1** · Importadores OBJ y STL propios con soldadura, normales por
  ángulo, aristas vivas, detección de escala y arreglo de unidades en el
  Doctor; `importFile` común para glTF, OBJ y STL — **Sonnet**.
- **E2** · SIMD propio (escalar, SSE2, AVX2, NEON, simd128, bit a bit
  iguales), BVH4/8 con SAH y recorrido SIMD, intersección *watertight*,
  instancias, `pick`, `rt-bench`; 121 tests, también ejecutados en wasm
  — **Opus**.
- **I3** · FBX, 3DM, 3MF, PLY, DAE y USD por cargadores MIT bajo demanda,
  hoja de importación en línea con unidades y eje detectados por formato,
  tubería de opciones pura; 405 tests — **Sonnet**.
- **U3** · Herramienta de mover con *gizmo*, pivotes, apoyar y centrar,
  duplicar y enlazado, grupos, patrones, operaciones de material y de
  geometría, menú contextual completo y atajos; 442 tests — **Opus**.
- **E3** · Integrador: Sobol con Owen, BSDF físico, luces de área y sol
  con NEE y MIS, cúpula con muestreo por importancia, suelo y
  atrapasombras, curvas de tono, hoja de contactos, paridad wasm; 178
  tests con furnace, factor de forma y conservación de energía — **Opus**.
- **U4** · Biblioteca propia: materiales, montajes de luz, tipos de
  producto y estudios con miniatura, pestañas *Míos*, persistencia,
  exportación e importación JSON; 504 tests — **Sonnet**.
- **E4** · El motor en el navegador: escritor RSB en TypeScript idéntico
  byte a byte al de `rt-core`, pool de workers con `rt.wasm` escalar y
  `simd128`, conmutador **Rápido · Completo**, *Render* siempre con el
  trazador, paridad exacta navegador / nativo; 561 tests web y 182 del
  motor — **Opus**.
- **I2** · STEP e IGES con occt-import-js aislado, caras CAD como rangos
  de triángulos con aristas vivas topológicas, ensamblaje, colores,
  unidades y calidad de teselado; 682 tests — **Opus**.
- **U2** · Guardar y abrir `.repack.json` con las mallas dentro, archivo
  recordado con File System Access, cambios sin guardar con pregunta en
  línea, test de límites entre capas; 792 tests — **Sonnet**.
- **P2** · Lanzador de escritorio propio con motor nativo idéntico al
  wasm, almacén de modelos por `sha256`, portables de Windows y Linux e
  instalador NSIS; 846 tests web y 241 del motor — **Opus**.
- **P1** · Primera release `v0.1.0`: portables de Windows y Linux e
  instalador de Windows, CHANGELOG y notas — **Haiku**.
- **U6** · Ventana de Ajustes con buscador y secciones agrupadas, gestor
  de modelos de IA con descargas reanudables verificadas por `sha256`,
  importación y recomendación por equipo; 939 tests — **Opus**.
- **U5** · Ventana de render al estilo de KeyShot con *Imagen · Animación*,
  salida por plantilla, carpeta, ppp escritos en PNG y JPEG, PNG de 16
  bits y EXR, *Terminar por* muestras o tiempo, cola deshacible, visor de
  resultados con divisor y historial en IndexedDB; 621 tests — **Opus**.
- **E12** · Elección de luz por punto: la lista plana del árbol de luces de
  Conty Estevez y Kulla con su cota de orientación, pesos en unidades de
  irradiancia, MIS con la misma probabilidad en el vértice del rayo BSDF;
  el atrapasombras y los fotones siguen por flujo; sin chispas en los sets
  con *pool*; 614 tests del motor — **Opus**.
- **M2b** · Texturas y etiquetas en el motor: `IMGS`, el bloque de
  texturas de `MATL` y las UV de `MESH` en `rt-core`, *mipmaps* y huella por
  diferenciales de rayo y cono, las cinco proyecciones de *Rápido*, mapas de
  normales y de alturas, recorte y opacidad por punto también en las sombras,
  etiquetas como capa; `rt_features`; los mismos píxeles sin texturas; 474
  tests de `rt-core` — **Opus**.

- **N1** · Animación y vídeo: `FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC` (y
  `PATH` reservado), giro con pivote, curva personalizada de dos asas, cambio de
  cámara con fundido a negro o blanco, asistente en tres pasos con rejilla de
  tipos, animaciones bajo su objetivo en el árbol, vídeo WebM/MP4 por WebCodecs
  con *muxers* propios y el Doctor `output` conectado; un proyecto de U1
  reproduce lo mismo; 2907 tests web y 1098 del motor (sin tocar) — **Opus**.

(Las fases de esta lista las cierra quien las ejecuta en el mismo PR en
que se entregan; el detalle de cada una está en su sección.)

---

## F0 · Documentación de arranque — **Fable** — hecha

Este documento y sus hermanos. Decisiones tomadas aquí y no abiertas a
discusión dentro de un PR: stack (`ARCHITECTURE.md` §1), interfaz en
blanco y negro de tres columnas con inspector contextual (`UI.md`),
*store* único con deshacer (`ARCHITECTURE.md` §4), catálogos como datos
con claves estables, sistema de coordenadas relativo a cámara, visor que
es el render.

## A1 · Andamiaje — **Sonnet** — hecha

Vite 8, TypeScript 7, vitest 5, three 0.186, playwright-core 1.64.
`npm run qa` y `npm run screenshot` en verde sobre un `main.ts` de
marcador. La captura usa `--use-gl=swiftshader` y espera a
`#app[data-ready="1"]`.

## A2 · Catálogos portados — **Sonnet** — hecha

Ver `src/data/README.md`. Las claves son las de EZ Packshot. Los tests
fijan: 16 estudios; 72 montajes (PRODUCT 12, TRADITIONAL 13, CINEMATIC
11, CREATIVE 8, EMOTIONAL 8, EXPERIMENTAL 8, SIGNATURE 6, SPICY 6; tres
con `world: 'SKY'`); 77 materiales en 7 categorías; 8 ópticas; 16
secuencias; 14 chequeos; 9 básicos de desgaste y 8 tipos. `setupRig`
iguala la irradiancia de cualquier montaje a la del tipo de producto.

## A3 · CI y plantillas — **Haiku** — hecha

La suite corre en cada PR y sube `dist/` como artefacto para probar la
interfaz de cualquier commit sin release.

---

## U1 · La interfaz — **Opus** — hecha

**Qué.** Toda la interfaz de `UI.md`, funcional sobre el *store* de
`ARCHITECTURE.md` §4 y un visor de vista previa con three.js detrás de
`RenderEngine`. Sin trazador de caminos ni importadores más allá de GLB.

**Depende de.** A1, A2.

**Criterio de aceptación.** La lista de `UI.md` §7, punto por punto, y:

- **Modo estándar por defecto** (`SPEC.md` §2): al abrir, y tras *Nuevo*,
  el estudio `GENERIC` (etiqueta *Estándar*) ya está construido con su
  rig, la cúpula, la cámara de referencia y calidad de previa; una pieza
  importada sin material recibe el material por defecto; deshacer no
  puede deshacer ese estado inicial.

- `tests/store.test.ts`: asignar material por nivel (los cuatro),
  inventario de confirmación cuando hay materiales distintos y no cuando
  son iguales, deshacer y rehacer de una secuencia de diez acciones,
  `transaction` que deja una sola entrada, serialización ida y vuelta
  (`JSON.parse(JSON.stringify(state))` igual al estado).
- `tests/strings.test.ts`: mismas claves en `es` y `en`, ninguna vacía.
- `tests/ui-achromatic.test.ts`: ningún color con saturación en
  `src/ui/**/*.css`.
- `tests/doctor.test.ts`: cada chequeo de escena detecta su caso y su
  arreglo lo deja limpio (escala, apoyo, suavizado, bisel, clipping,
  luces visibles).
- `out/screenshot.png` adjunta al PR con la pieza de ejemplo, el estudio
  de joyería creado y un montaje elegido.

**Qué no tocar.** `src/data/` (salvo añadir, nunca cambiar valores),
`src/core/light-math.ts`, `rig.ts`, `wear.ts`, los documentos de `docs/`
(si algo no encaja, se anota en el PR).

**Qué dejar preparado para después.** `RenderEngine` implementado por la
vista previa y usado por `main.ts` a través de una variable, de modo que
E4 solo tenga que añadir la segunda implementación (el pool de workers
sobre `rt.wasm`), el cambio automático *preview mientras se mueve,
trazador cuando se para*, y una acción `setEngine`.

**Hecho.** Toda la interfaz de `UI.md` funciona sobre el *store*
(`src/core/store.ts`: estado inmutable, deshacer y rehacer con etiquetas
bilingües, transacciones por gesto, `reset`) y el visor de vista previa
de three.js (`src/render/preview.ts`, con la conversión Z-arriba → Y-arriba
solo en `toThree`). El flujo de aceptación sin ratón (paleta: ejemplo →
joyería → crear estudio → oro → `Ctrl ⏎`) descarga un PNG de 1920 × 1080
y deshacer lo revierte paso a paso; arrastrar un `.glb` sobre el estado
vacío importa, apoya y encuadra; los cuatro niveles de selección, el
inventario de confirmación, las 72 miniaturas y las 77 esferas
renderizadas en el navegador, el cajón de animación con reproducción, la
cola, el Doctor con siete chequeos de escena, la guía con flechas, los
dos temas y los dos idiomas en caliente, y el modo estándar al arrancar
(el estado base del historial, que deshacer no puede quitar). 201 tests
en 16 ficheros; `tests/ui-achromatic.test.ts` y `tests/strings.test.ts`
en verde. Capturas: `docs/ui/dark-studio.png`, `light-materials.png`,
`animation-drawer.png`. Parámetros de URL para demos y capturas
documentados en `src/ui/README.md`.

Lo que no encajaba con el plan, resuelto así: la geometría vive en un
registro fuera del estado (`core/meshes.ts`) y el estado guarda solo
id, recuentos y caja, para seguir siendo JSON plano; la selección y la
cola de render no son deshacibles (la cola sí lo es desde U5); los focos se colocan y apuntan al
centro de la pieza visible, no al origen del mundo, porque la pieza
apoya su base en el origen; el bisel se guarda en el material y se
muestra en la sección Pieza; `render()` admite una cámara para que cada
trabajo de la cola use la suya; *Crear estudio* pide siempre
confirmación porque con el modo estándar siempre hay estudio; el
importador glTF hace su propia conversión Y-arriba → Z-arriba (es del
formato, no del visor); el tema *Sistema* es oscuro salvo que el sistema
pida claro; three.js deja el paquete en 1.1 MB; en la vista previa,
*Cielo* y *HDRI* usan la cúpula, el campo claro es un disco suave en la
posición del panel, y reflejo del suelo, halo, nitidez, saturación,
contraste y viñeta se guardan pero no se pintan (todos marcados
*próximamente*). Queda para U2: abrir proyectos y las mallas embebidas. Los tipos `SceneNode`, `MaterialInstance`, `LightInstance`,
`CameraState`, `Shot`, `MotionClip`, `RenderJob` en `src/core/*.ts`,
exportados y documentados con una línea cada uno.

## U2 · Proyecto en archivo y límites — **Sonnet** — hecha

**Qué.** `src/io/project.ts`: guardar y cargar `.repack.json` con las
mallas embebidas (GLB en base64), `schema: 1`, y una tabla de migraciones
vacía con su mecanismo. `tests/boundaries.test.ts`: recorre los `import`
de `src/` y falla si `core` importa de `ui`/`render`/`io`, si `ui`
importa de `render` o `io`, o si `data` importa de cualquier otro.
`tests/project.test.ts`: ida y vuelta de un proyecto con dos piezas y
tres materiales; un fichero fijo `tests/fixtures/project-v1.json` que
tiene que seguir cargando en cada versión.

**Depende de.** U1.

**Criterio.** Los tres tests en verde; *Guardar* y *Abrir* del menú
funcionan en el navegador con descarga y `<input type="file">`.

**Hecho.** `src/io/project.ts` guarda y abre `.repack.json` (`schema` 2:
`state` y un bloque `meshes` con un GLB en base64 por malla usada, con
`sharpEdges` y `triangleSource` al lado; `-0` conservado), con
`glb.ts`/`base64.ts` (por trozos) y `project-file.ts` (File System Access
con el archivo recordado: `Ctrl/⌘ S` escribe en él, `Ctrl/⌘ ⇧ S`
pregunta, `Ctrl/⌘ O` abre; descarga e `<input>` donde no hay API; soltar
un proyecto lo abre). Abrir valida todo antes de tocar nada, renombra los
ids de malla que chocarían (`prjN:`), regenera la geometría del ejemplo en
archivos antiguos y hace `store.reset` (el historial empieza de nuevo).
El punto de cambios sin guardar sale de un contador de revisiones del
*store* (`revision()`; deshacer hasta lo guardado lo limpia); *Nuevo* y
*Abrir* preguntan en línea (*Guardar · No guardar · Cancelar*) y
`beforeunload` avisa. `tests/boundaries.test.ts` (sin infracciones),
`project.test.ts` (incluido un ensamblaje STEP de I2 guardado y reabierto
idéntico, caras CAD y aristas vivas incluidas), `project-files.test.ts`,
`fixtures/project-v1.json` (generado por el propio código de U1) y
`project-v2.json`; 102 tests nuevos, unas 110 mutaciones comprobadas.

No encajó con el plan: el esquema ya era 2 (U5) y no se sube; no hay
referencia externa por ruta, solo mallas dentro; abrir no se deshace
(como *Nuevo*); deshacer hasta el punto guardado deja el proyecto limpio.

**Cambio posterior (B1, petición del usuario): la extensión.** El proyecto se
guarda como `.repack` (el mismo JSON); `.repack.json` es lo que se escribió
hasta v0.1.6 y se sigue abriendo, en el selector, en el diálogo del
escritorio y al soltarlo en la ventana (`core/project-names.ts`; el lanzador
admite `repack` en `WRITABLE_EXTENSIONS`). Donde arriba se lee `.repack.json`
es lo que se hizo entonces.

## I1 · Importadores OBJ y STL — **Sonnet** — hecha

**Qué.** `src/io/obj.ts` y `src/io/stl.ts` propios (ASCII y binario para
STL; OBJ con grupos `o`/`g` como piezas y `usemtl` como material inicial
de familia `SIMPLE` gris), sin dependencia. Normales: si el archivo no
las trae, por ángulo de suavizado (30°). Aristas vivas marcadas por
diedro > 30° en `mesh.sharpEdges`. Detección de `partSizeMm` y de
unidades (un STL de 0.03 de alto en un tipo "joyería" son metros; se
ofrece ×1000 con el Doctor). El estado vacío acepta los tres formatos.

**Depende de.** U1.

**Criterio.** `tests/io-*.test.ts` con fixtures pequeños escritos a mano
(un cubo OBJ con dos grupos, un STL binario y uno ASCII del mismo
tetraedro) comprobando vértices, caras, grupos, normales y aristas vivas
con números exactos. El Doctor sugiere la escala cuando procede.

**Hecho.** `src/io/obj.ts`, `stl.ts`, `mesh-common.ts` (soldadura por
posición con tolerancia 1e-5 del tamaño, normales con ángulo de
suavizado de 30°, aristas vivas, conversión Y-arriba → Z-arriba) e
`import.ts` (`importFile` por extensión y cabecera, con cada lector en
su propio *chunk*; glTF pasa también por aquí). 49 tests nuevos con
recuentos exactos y 46 mutaciones comprobadas una a una; arrastrar OBJ,
STL ASCII y binario y GLB funciona en el navegador; 1 M de triángulos
en ~4 s (OBJ) y ~3 s (STL binario) en el hilo principal. El Doctor
ofrece ×1000 / ÷1000 exactos cuando el importador deja una pista de
unidades (`ModelSource.unitHint`).

Lo que no encajaba: las aristas vivas son por pieza y no cuentan las
abiertas, así que un CAD que exporta un grupo por cara no tiene aristas
vivas (M1 las sacará de la topología); los vértices se parten a lo largo
de las aristas vivas (24 en un cubo), y los recuentos "soldados" se
fijan como posiciones distintas; STL se deja Z-arriba y en milímetros,
sin escalar; un grupo OBJ con varios `usemtl` es una pieza con
`faceMaterials`; los `.mtl` se ignoran con aviso; un archivo en metros
se ve vacío al principio porque el plano cercano de la cámara (1 mm) lo
tapa hasta aplicar el arreglo de escala: I3 lo resuelve aplicando las
unidades de la hoja de importación antes de añadir el modelo y ajustando
los planos de recorte al encuadrar.

## I2 · STEP e IGES — **Opus** — hecha

**Decisión tomada (Fable).** Se lee STEP (AP203, AP214, AP242) e IGES con
**OpenCascade** compilado a wasm a través de `occt-import-js` 0.0.23. El
paquete entero es **LGPL-2.1** (no MIT, como decía una versión anterior
de este documento): es la única excepción LGPL del proyecto y va
aislada con las condiciones de `ARCHITECTURE.md` §1 (copiado sin
modificar a `public/vendor/occt-import-js/` por `tools/vendor.mjs`, nunca
empaquetado, cargado por URL en un worker, licencia y enlace al fuente al
lado, nombrado en *Acerca de*). Entra solo en la capa `io/` del lado web,
se carga **bajo demanda** al soltar el primer archivo CAD (unos MB que no
se pagan si no se usan), y el motor de render no lo conoce. Un teselador de B-rep propio en Rust queda como idea para
después, no como requisito.

**Qué.** `src/io/step.ts`: carga diferida del módulo, lectura con la
**calidad de teselado** de la hoja de importación (tolerancia de cuerda y
ángulo), conservando **cada cara CAD** como rango de triángulos
(`faceRanges`, lo que usa M1 para que *Caras* coja una cara entera), los
**nombres y colores** del ensamblaje como jerarquía de grupos y
materiales iniciales, y las unidades declaradas. IGES por el mismo camino.
Aristas vivas desde la topología (aristas entre caras), no por ángulo.

**Depende de.** I3 (la hoja de importación y `import.ts`).

**Criterio.** Fixtures STEP pequeños escritos a mano o exportados de un
CAD libre (un cubo con nombre y color, un cilindro, un ensamblaje de dos
piezas): número de caras CAD, de piezas y de grupos exactos; cambiar la
calidad cambia el número de triángulos; el módulo no se descarga hasta
que se importa un STEP (test de que `import('…/occt')` no aparece en el
chunk inicial de `vite build`).

**Hecho.** STEP (AP203/214/242) e IGES con occt-import-js 0.0.23 en un
worker de módulo, cargado al soltar el primer archivo CAD; la hoja se
abre al instante con una línea de estado (descarga en MB, lectura,
piezas) y la calidad de teselado en vivo (Baja · Media · Alta y
*Personalizada* con cuerda en % del tamaño y ángulo), que vuelve a leer
el archivo. Cada cara CAD es un rango de triángulos
(`SceneNode.faceRanges`) con vértices y normales propios; aristas vivas =
aristas entre caras; ensamblaje como grupos con nombre; colores como
instancias SIMPLE; unidades declaradas leídas del texto del archivo;
*Separar por cara CAD* en la hoja. La biblioteca va copiada sin
modificar a `public/vendor/occt-import-js/` con sus dos textos LGPL-2.1
y un README con el enlace al fuente, y un test tras `vite build`
comprueba que no está en ningún *chunk*. 61 tests nuevos (682 en total),
41 mutaciones comprobadas; captura `docs/ui/import-step.png`.

No encajó con el plan: la biblioteca aplana los subensamblajes (un nivel
de grupos como mucho) y no da nombres de colores (las instancias se
llaman por su hexadecimal); STEP e IGES no declaran eje arriba y se toma
**Z** (pendiente de Fable, ver *Decisiones*); el worker ejecuta el guion
sin modificar con `new Function` (una CSP futura necesitaría
`unsafe-eval` o un worker clásico); la conversión corre en el hilo
principal (≈ 0,65 s por 230 k triángulos) y `ReadFile` no informa de
progreso mientras tesela; en un ensamblaje con varias unidades manda la
primera; las caras tangentes también quedan como aristas vivas, con
normales iguales, así que el sombreado sigue suave; la primera lectura
es siempre en calidad Media.

## I3 · Importadores y hoja de importación — **Sonnet** — hecha

**Qué.** `src/io/import.ts`: detección por extensión y cabecera,
**hoja de importación** en línea (`UI.md` §2.3, `SPEC.md` §5) con
unidades, eje arriba, centrar, apoyar, encuadrar, añadir o sustituir,
agrupar por, mantener materiales, separar piezas, invertir normales, y
las conversiones correspondientes a nodos del *store*. Formatos por
bibliotecas MIT ya decididas en `ARCHITECTURE.md` §1, cada una en un
chunk cargado bajo demanda: **FBX** (`FBXLoader`: jerarquía, materiales,
texturas incrustadas, unidades), **3DM** (`3DMLoader` + rhino3dm: mallas
de render, capas como grupos, materiales; aviso claro cuando un B-rep
no trae malla), **3MF**, **PLY**, **DAE**, **USD/USDZ**. OBJ y STL siguen
siendo propios (I1). Los materiales que trae el archivo se convierten a
instancias `SIMPLE` con color, rugosidad y metal aproximados; las
texturas se guardan para M2.

**Depende de.** U1, I1.

**Criterio.** Un fixture pequeño por formato (generado con herramientas
libres y con su licencia anotada) con recuentos exactos de piezas,
grupos, triángulos y materiales; la hoja aplica cada opción (test del
*store*: unidades × 25.4, eje arriba intercambia Y/Z, agrupar por
material produce N grupos); el chunk inicial no contiene ningún
importador (test sobre `dist/`).

**Hecho.** Lectores `fbx.ts` (ASCII y binario 7400/7500, `UnitScaleFactor`
y `UpAxis`), `rhino.ts` (rhino3dm 8.35.0 MIT en un worker, capas como
grupos, capas ocultas, unidades del documento, aviso de B-rep sin malla
de render), `threemf.ts`, `ply.ts`, `collada.ts`, `usd.ts` (`USDLoader`,
porque `USDZLoader` está obsoleto en three 0.186) y `three-scene.ts`
(conversión común de `Object3D` a nodos); `src/core/import-options.ts`
con `applyImportOptions` puro (unidades, eje, invertir normales, agrupar
por, política de materiales, separar) por el que pasan también glTF, OBJ
y STL, que ya no escalan ni giran por su cuenta; hoja de importación en
el inspector con los valores detectados; `frameBox` ajusta los planos de
recorte. 405 tests en 29 ficheros, 58 mutaciones comprobadas; en el
navegador, FBX, 3DM, 3MF, DAE, PLY, USDA y USDZ abren la hoja e importan
con `Enter`, sin errores de consola.

Lo que no encajaba: un fichero por lector en vez de `mesh-formats.ts`;
`npm run qa` pasa a `check → build → test` para que el test de *chunks*
corra siempre sobre el `dist/` fresco; *Centrar* mueve también el origen
del modelo al centro (`centrePivot`) para que el Doctor no avise tras
importar; las texturas incrustadas se recogen en el *payload* y no se
aplican (M2); la vista previa limita el plano cercano a 0,01 mm, así que
un modelo por debajo de 0,05 mm aún puede recortarse; `.usdc` binario no
se escanea; FBX con eje X arriba no se ofrece; materiales Phong con
rugosidad derivada del brillo. `rhino3dm` se copia a `public/vendor/` en
`predev` y `prebuild` (`tools/vendor.mjs`).

## E1 · Andamiaje del motor en Rust — **Sonnet** — hecha

**Qué.** El workspace de Cargo en `engine/` con los tres *crates* de
`ARCHITECTURE.md` §5.1 y **cero dependencias externas**: `rt-core` con
matemáticas (`Vec3`, `Ray`, `Aabb`), RNG PCG32, color (sRGB, ACES,
exposición), película, codificador PNG propio (zlib almacenado + CRC-32 +
Adler-32), lector y escritor del formato de escena **RSB** v1
(`ARCHITECTURE.md` §5.2) y un `render_tile` de marcador que ya es un
lanzador de rayos real (cámara de lente fina, Möller–Trumbore por fuerza
bruta, `n·l`); `rt-cli` con cola de baldosas e hilos, `--example` y
`--write-example`; `rt-wasm` con las exportaciones `extern "C"` escritas
a mano. `.github/workflows/engine.yml`: fmt, clippy `-D warnings`, test,
build nativo y wasm, `cargo check` cruzado a `aarch64-unknown-linux-gnu`
y `riscv64gc-unknown-linux-gnu`, y un paso que falla si `Cargo.lock`
contiene una fuente externa. `npm run engine:test` y `npm run
engine:build`.

**Depende de.** —

**Criterio.** Los cinco *gates* en verde; el ejemplo renderiza un PNG con
el centro más claro que la esquina; tests de determinismo (baldosas en
cualquier orden dan la misma película), ida y vuelta RSB con sección
desconocida ignorada, PNG estructuralmente válido; el `.wasm` no importa
nada de WASI.

**Hecho.** 79 tests (`rt-core` 63, `rt-cli` 10, `rt-wasm` 6), fmt, clippy
y `cargo doc -D warnings` limpios; `Cargo.lock` sin ninguna fuente
externa; `cargo check` cruzado a `aarch64-unknown-linux-gnu` y
`riscv64gc-unknown-linux-gnu` en verde; `rt_wasm.wasm` de 50 KB sin
sección de importaciones. El mismo RSB renderizado en nativo x86_64 y en
wasm (cargado en Node) da el mismo hash de baldosa, y un test lo fija.
Fuerza bruta sobre 322 triángulos a 4 hilos: 1.4 M rayos/s, que es el
número que E2 tiene que multiplicar.

Lo que no encajaba o quedó abierto, para E2–E4: la semilla del RNG es
por (escena, píxel, muestra) y no por baldosa, así que la película es
idéntica con cualquier tamaño de baldosa, no solo con cualquier orden;
`MATL.kind`, `ENVR.background_mode` y `LGHT.flags` se guardan en bruto
porque sus significados los fija E3; `RNDR.max_seconds` se lee pero el
CLI no lo aplica aún; el sombreado de marcador ignora la potencia de la
luz. La escena de ejemplo vive en `rt_core::example` porque `rt-wasm`
también la necesita en sus tests. Las funciones de `rt-wasm` que reciben
punteros son `unsafe extern "C"`; el registro de escenas es un `Mutex`,
no un `static mut`.

## E2 · Geometría y aceleración — **Opus** — hecha

**Qué.** En `rt-core`: el módulo `simd` (`f32x4`/`f32x8` con referencia
escalar y rutas SSE2/AVX2, NEON y `simd128`, test de igualdad dentro de
1 ulp); mallas indexadas en *structure-of-arrays*; BVH con construcción
SAH por *binning* y nodos anchos (BVH4, BVH8 donde haya 8 carriles)
recorridos con SIMD y pila explícita; intersección *watertight*; normales
suaves por baricentro; instancias (misma malla, varias transformaciones);
rayos de sombra con salida temprana; `pick` (rayo único con id de nodo,
cara, punto y normal). Un binario `rt-bench` en `rt-cli` que mide
rayos/s sobre la pieza de ejemplo y un modelo de un millón de triángulos
generado por procedimiento.

**Depende de.** E1.

**Criterio.** Tests: el BVH devuelve exactamente lo mismo que la fuerza
bruta en 10 000 rayos aleatorios sobre tres escenas (esfera, pieza de
ejemplo, malla aleatoria con triángulos degenerados); construcción
determinista; SIMD = escalar. Objetivo medido (se apunta en el PR, no
es puerta): ≥ 10 M rayos/s por núcleo en x86_64 con AVX2 sobre la pieza
de ejemplo.

**Hecho.** Medido en una máquina virtual de 4 núcleos (Xeon 2,8 GHz,
AVX2, BVH8): pieza de ejemplo **12–14 M rayos/s por núcleo** (54–80 M en
4 hilos según coherencia y *any-hit*); malla de un millón de triángulos,
3,9 M por núcleo coherente y 1,0 M incoherente (limitada por fallos de
caché); construcción de la BVH de 1 M en 1,1 s. Render completo de
ejemplo: de 1,4 M a **15,2 M rayos/s** en 4 hilos. En wasm bajo Node, un
hilo: 2,8 M escalar y 3,7 M con `simd128`, frente a 4,5 M nativo. Las
rutas SIMD escalar, SSE2, AVX2 y `simd128` se ejecutan y comparan bit a
bit (sin FMA, `min`/`max` con la semántica de x86 en todas, reducciones
en árbol fijo); NEON solo compilada y comprobada con clippy (no hay
máquina ARM aquí). 121 tests (rt-core 102, rt-cli 13, rt-wasm 6) en
debug, release y **wasm32-wasip1 bajo Node** (`engine/tools/wasi-run.mjs`),
con tres mutaciones comprobadas (culling, desempate, orden de operandos
de `min` en SSE). El hash de la película se fija ahora sobre dos baldosas
y en todas las rutas SIMD; el wasm real da los mismos hashes.

Lo que no encajaba: nueva sección RSB **`INST`** (malla, transformación
3 × 4, material, banderas) para que las instancias viajen; sin ella, una
instancia identidad por malla como antes (anotado en `ARCHITECTURE.md`
§5.2). La detección de AVX2 vive en `rt-core` (`Isa::detect`, CPUID, no
es una API del sistema) con despacho por baldosa y caída segura a
escalar. La anchura de la BVH depende de la máquina (BVH8 solo con AVX2),
con resultado idéntico porque el impacto más cercano es el menor
`(t, instancia, triángulo)`. Paquetes de triángulos de 4 en todas las
rutas; 8 carriles solo en los nodos. `Scene.meshes` pasa a
`Scene.geometry` y `Mesh` es inmutable. Una instancia con transformación
singular nunca se golpea, no es error. `[profile.test] opt-level = 1`
(los tests de fuerza bruta pasan de 18 s a 2 s); `rt-cli` tiene ahora
dos binarios (`rt`, `rt-bench`) y `default-run`. CI ejecuta además los
tests de `rt-core` en wasm (escalar y `simd128`, en `--release` porque
Node 22 falla con el binario de depuración entero) y un humo de
`rt-bench`. El `.wasm` pasa de 50 a 114 KB; `engine:build` sigue siendo
escalar y la variante `simd128` se decide en E4.

## E3 · Integrador v1 — **Opus** — hecha

**Qué.** El trazador de caminos de verdad: muestreador Sobol con
*scrambling* de Owen (números de dirección de Joe y Kuo citados) sembrado
por (baldosa, píxel, muestra); cámara de lente fina con diafragma y
enfoque, ortográfica; BSDF de principio físico (difuso Lambert/Burley +
especular GGX con Fresnel + metal) con rugosidad y color; luces de área
rectangulares, cuadradas y de disco con muestreo explícito y MIS contra
el BSDF, con `glossy` (visible en reflejos) y `spread`; sol direccional
con disco angular; **cúpula de estudio procedural** (suelo → horizonte →
cenit) como luz de entorno con muestreo por importancia; fondo liso,
transparente o el propio entorno; suelo con sombra de contacto y modo
*solo sombra*; ruleta rusa; acumulación progresiva por baldosa;
exposición y transformadas Estándar, Fílmica y AgX (ajustes de la
literatura, citados). Todo determinista y con 1 y N hilos idéntico.

**Depende de.** E2.

**Criterio.** Tests analíticos en `cargo test`: furnace test (esfera
blanca en entorno uniforme converge a la radiancia del entorno ±1 %);
esfera difusa bajo panel contra el factor de forma analítico (±2 %);
espejo plano que refleja la cúpula con el gradiente correcto; energía
conservada con rugosidad 0 → 1 (la imagen no gana luz); hash idéntico con
1 y 4 hilos. Hoja de contactos con `rt`: 16 estudios × 12 montajes
elegidos, con media, quemados y tapados por imagen (`tools/contact-sheet.mjs`
llama al binario; sale `out/contact-sheet.html` y se adjunta al PR).

**Qué no tocar.** Las recetas (`src/data/`): si un montaje sale mal, se
anota para L3, no se cambia.

**Hecho.** Muestreador Sobol con *scrambling* de Owen (tabla de Joe y Kuo
de 63 dimensiones verificada contra el fichero original, licencia BSD en
el módulo; pares 2-D con t ≤ 2; semilla por píxel y dimensión), cámara de
lente fina y ortográfica, BSDF principal (Lambert × (1−F)² + GGX con
Smith correlado y VNDF, Schlick con F0 de `ior` o color según `metallic`,
barniz como segundo lóbulo), emisores, luces rectángulo y disco con
caída `spread`, sol como disco, NEE con MIS por heurística de potencia y
sin doble conteo, cúpula de estudio con CDF por elevación, fondo entorno,
color o transparente con alfa, suelo visible o atrapasombras (sección
`FLOR`), ruleta rusa, `clamp_indirect`, `max_depth`, `max_seconds` en el
CLI por pasadas, curvas lineal, ACES, fílmica, AgX y estándar, `--sheet`
con seis recetas internas y estadísticas, `rt_render_tile_rgba` y
paridad del `.wasm` real en Node (`tools/wasm-parity.mjs`, en CI). 178
tests: furnace 1 ± 1 % a 1024 muestras, metal rugoso sin ganancia de
energía, reciprocidad, factor de forma ±2 %, gradiente de la cúpula en
un espejo, mismo emisor por NEE y por BSDF ±2 %, alfa, atrapasombras,
curvas monótonas, hilos y pasadas sin efecto en la película. Rendimiento
con sombreado real: 7,9 M rayos/s en 4 hilos (2,7 rayos por camino).

Lo que no encajaba: matemáticas deterministas propias (`fmath`: sin, cos,
exp2, log2, pow, atan2, acos solo con las cuatro operaciones y raíz),
porque las de `std` llaman a la biblioteca del sistema y romperían la
igualdad de píxeles entre plataformas; `MATL.flags` nuevo (bit 0: el
emisor también se muestrea como luz); `glossy` significa "ilumina todos
los lóbulos y se ve en reflejos" (sin él, solo difuso por NEE); F90 =
min(1, 50·F0) para que `ior` 1 sea Lambert puro; los metales rugosos
pierden energía (GGX de una dispersión; se propone compensación
Kulla–Conty para después); luces por área uniforme, una por vértice
elegida por flujo (el árbol de luces es de K4); fílmica como rango log2
más el polinomio de AgX; la matriz y el polinomio de AgX se escribieron
de memoria y **Fable debe juzgar el aspecto**; los rayos de sombra y de
rebote de mallas suaves parten de un punto elevado a la superficie que
describen las normales (Hanika 2021), lo que quita el terminador dentado
y deja un borde oscuro en siluetas de mallas gruesas; la luz del ejemplo
pasa de 1000 a 5 W; `rt_version` 0.2.0 y `.wasm` de 180 KB.

## E4 · El motor en el navegador — **Opus** — hecha

**Qué.** `src/io/rsb.ts`: escritor RSB en TypeScript desde el
`ProjectState` (mallas, instancias, materiales con la semántica fijada
en E3, rig resuelto por `setupRig`, cámara, entorno, suelo `FLOR`,
render), con test de paridad byte a byte contra el escritor de
`rt-core` (fixture generado por `rt --write-example`). `src/render/worker.ts`
y `src/render/pathtracer.ts`: pool de workers, cada uno con su `rt.wasm`
(variante `simd128` cuando el navegador la soporta, escalar si no) y su
copia de la escena, baldosas intercaladas, acumulación, exposición y
transformada en el hilo principal, `status()` honesto (modo, muestras,
tiempo, workers, SIMD). **Conmutador *Rápido · Completo* en la cabecera**
(`meta.viewportMode`, atajo `Ctrl ⇧ R`): *Rápido* = vista previa
rasterizada siempre; *Completo* = trazador siempre, también durante los
gestos de cámara, a resolución reducida (½ o ¼ según el tiempo del
último fotograma) mientras dura el gesto y a resolución completa al
soltar, con reinicio de la acumulación al cambiar cualquier cosa de la
escena. **`render()` y la cola usan siempre el trazador** a la
resolución de salida y con el presupuesto, en cualquier modo. Si
`rt.wasm` no está (no se ha ejecutado `npm run engine:build`) o el
navegador no da workers, *Completo* queda deshabilitado con el motivo y
la interfaz funciona en *Rápido*.

**Depende de.** U1, E3.

**Criterio.** Paridad: la misma escena renderizada por `rt` y por el pool
en Chromium local (vía `tools/screenshot.mjs` con `?mode=full`) da el
mismo hash de imagen a 4 muestras; `tests/rsb.test.ts` en verde; captura
del visor en *Completo* convergiendo con el medidor mostrando muestras
reales y otra en *Rápido*; orbitar en *Completo* mantiene al menos 10
fotogramas por segundo a resolución reducida en el Chromium local con
swiftshader (o lo que dé, anotado); el botón *Render* en modo *Rápido*
produce la imagen del trazador, no la de la vista previa (test de
píxeles: la imagen descargada tiene ruido de muestreo y sombras suaves).

**Hecho.** `src/io/rsb.ts` escribe el RSB desde el estado y reproduce
`rt --write-example` byte a byte; `src/render/{pathtracer,worker,
pool-protocol,tiles,tonemap}.ts` con un pool de workers (escalar o
`simd128` según el navegador), baldosas intercaladas, generación para
descartar baldosas viejas, acumulación en `f32` y en orden de muestra, y
las curvas de tono del motor portadas a TypeScript **bit a bit**
(comparadas con `rt --tone-table`). Conmutador *Rápido · Completo* en la
cabecera con `Ctrl ⇧ R`, recordado, y deshabilitado con su motivo cuando
no hay `rt.wasm`. **Paridad**: la escena de joyería con Rembrandt y
atrapasombras, renderizada en la página a 4 muestras y con `rt` nativo,
da el mismo hash a 1920 × 1080 (0 bytes distintos). En la VM de pruebas
con swiftshader: el visor *Completo* converge a 3,6 muestras/s en
1000 × 875 (3,15 M caminos/s con 3 workers y SIMD) y orbita a 13 fps a ¼
de resolución; *Render* de 1920 × 1080 a 128 muestras, 84–111 s. El
render en modo *Rápido* sale del trazador (ruido de muestreo y sombra de
contacto medidos). Brillo *Completo* frente a *Rápido*: 0,95 (0,94 tras
la corrección de abajo), dentro de la tolerancia de ±10 %. Fotometría
común en `src/core/photometry.ts`: flujo de un panel = π/4 × potencia ×
tamaño² (convención de Cycles; **corregido después de E4**: con `/ 4` los
paneles daban π veces menos luz que en Blender y la cúpula los tapaba, de
modo que cambiar de montaje apenas cambiaba el render; test de regresión
en `tests/photometry.test.ts`); sensor de 36 mm en el lado largo. Capturas
`docs/ui/viewport-full.png`, `viewport-fast.png`, `render-output.png`.

Lo que no encajaba: nueva exportación `rt_scene_update`
(`Scene::update_from_rsb`): un RSB sin `MESH` conserva las mallas y sus
BVH, para no reconstruir la geometría en cada movimiento de cámara; la
conversión final a 8 bits de *Render* corre en los workers y el visor usa
un camino rápido por tabla (exacto salvo donde la curva fílmica del motor
oscila a nivel de ulp); arrastres del *gizmo* y de controles también
renderizan a resolución reducida; el visor renderiza a píxeles CSS, sin
supermuestreo HiDPI; con swiftshader, el contorno de selección y el
lienzo WebGL superpuesto se apagan durante los gestos para no leer el
lienzo en cada fotograma; acción de la paleta *Exportar escena del motor
(.rsb)*; `groundShadow`, `groundReflection` y el color del entorno plano
no tienen equivalente en el motor todavía; el ACES del motor da NaN por
encima de ~1e19 de radiancia. Dos correcciones del responsable al
recibir la fase: el **ángulo del sol** estaba documentado en radianes y
salía como un disco de 31°, cuando en EZ Packshot está en **grados**
(0,545° es el sol real; ahora se pasa tal cual, con test de regresión); y
*Render* **ya no cae a la vista previa** cuando falta `rt.wasm`: lo dice
y no renderiza, como decidió el usuario.

## E5 · Dieléctricos, emisores, barniz, cielo, HDRI — **Opus** — hecha

**Qué.** En `rt-core`: transmisión con IOR y absorción (vidrio, acrílico,
policarbonato, tintado), rugosidad en transmisión; barniz como capa
dieléctrica; anisotropía; subsuperficie aproximada (*random walk* corto
o perfil de Burley); emisores de cuerpo negro y color; control de
cáusticas (AUTO sigue al tipo de producto); cielo procedural (modelo de
la literatura pública, citado) para `world: 'SKY'` con el sol del rig;
lectores propios de **RGBE (.hdr)** y **OpenEXR** (solo escaneado, sin
compresión o con ZIP: el *inflate* también propio) para HDRI de archivo,
con rotación e intensidad, como sección RSB; fondo de imagen; *denoise*
ligero propio al terminar (filtro guiado por normales y albedo).

**Depende de.** E3.

**Criterio.** Vidrio en furnace test con absorción cero no pierde energía
(±2 %); una esfera de vidrio frente a un panel con `camera = true`
produce el campo claro del montaje BACKLIT; test de cielo: cenit frente a
horizonte en el orden esperado y color del sol de 5200 K; el lector HDR
reproduce un fichero de prueba generado por el propio escritor; hoja de
contactos con los tres montajes SKY y los de campo claro.

**Hecho.** En `rt-core`: la parte `transmission` del material principal es
vidrio de verdad, transmisión GGX lisa o rugosa (Walter et al. 2007) con el
Fresnel dieléctrico exacto, reflexión total interna y el 1/η² del
transporte de radiancia; absorción de Beer–Lambert dentro de los sólidos
(`absorption_mm`: el color es lo que conserva la luz blanca tras esos
milímetros), pared fina (refleja 2R/(1+R) y deja pasar el resto sin
refractar), recortes por `opacity`, anisotropía GGX (Burley 2012, adelantada
de E6) y barniz que atenúa las capas de debajo. El integrador sigue el
sólido en el que va el camino; las paredes finas y los recortes son
sucesos rectos que conservan la densidad del último vértice para que la MIS
siga siendo correcta, y los rayos de sombra los atraviesan. Los emisores se
eligen como luces por su flujo y respetan `emitKind`; radiancia = color ×
emitPower × `EMIT_RADIANCE_PER_WATT` (0,06, `src/core/photometry.ts`).
Cielo de Preetham, Shirley y Smits (1999), con el sol del rig, escalado a
la irradiancia horizontal de la cúpula con los mismos valores. Lectores
propios de RGBE (`.hdr`), OpenEXR de líneas (sin compresión, RLE, ZIPS y
ZIP) e *inflate* (RFC 1950/1951); HDRI equirectangular en la convención de
three.js, con rotación, intensidad y muestreo por importancia 2-D con su
densidad exacta; imagen de fondo (llenar, encajar, estirar) en el marco de
salida. RSB: `MATL` de 72 B, `ENVR` de 80 B y la sección nueva `BMAP`; un
RSB sin `BMAP` conserva los mapas cargados. El camino opaco de E3 da los
mismos bits que antes (sus hashes fijados no cambian); dos hashes nuevos
fijan una escena E5 con vidrio, paredes finas, recortes, anisotropía, HDRI
leído de sus bytes, imagen de fondo y cielo en nativo (escalar, SSE2,
AVX2), en WASI (escalar y `simd128`) y con el `rt_wasm.wasm` real. En la
interfaz: *Entorno* con *Cúpula de estudio*, *Cielo*, *Plano* y *Archivo
HDRI*, *Cargar HDRI…*, bruma y sol propio del cielo, *Imagen de fondo* con
*Cargar imagen…* y encaje; la vista previa usa los mismos píxeles del HDRI,
el mismo cielo (portado a TypeScript, igual al del motor a 7·10⁻⁷) y la
misma colocación del fondo; el proyecto guarda las imágenes (bloque
`images`). Vidrio con *Distancia de absorción* y *Paredes*. Se quitan
`env.kindSoon`, `env.backplateSoon` y `light.skyNote`. Hoja de contactos
con la botella de vidrio ante el panel de BACKLIT (campo claro, también
con test), el tablero de materiales, el filamento en una bombilla de
pared fina, los tres montajes SKY y el HDRI de estudio procedural
(`tests/fixtures/studio.hdr`): `docs/ui/engine-e5-*.png`. Los tests
nuevos se comprobaron reintroduciendo catorce errores (sin el 1/η², otro
Fresnel, media absorción, sin el desplazamiento de la MIS, sombras
tapadas por paredes finas, `u` reflejado, encaje al revés, RGBE redondeado
al centro, predictor de EXR sin deshacer, cielo mal escalado y cuatro del
lado TypeScript): todos fallan. Rendimiento del ejemplo opaco: misma
imagen y mismos rayos; sin diferencia medible por encima del ruido de una
máquina compartida (mediana de un hilo +6 %, mejor −2 %).

Lo que no encajó con el plan:

- **Hošek–Wilkie no se portó.** El lead lo decidió (implementación de
  referencia v1.4a, BSD de 3 cláusulas), pero el clasificador de permisos
  de la sesión bloqueó usar la implementación descargada; queda pendiente
  de la aprobación explícita del usuario (el usuario pidió después un
  cielo propio en sala limpia: fase **E5c**). Preetham, el respaldo previsto,
  está detrás de la misma interfaz (`Preetham::new`, `radiance`) y el
  puerto TypeScript lo sigue con un test píxel a píxel, así que el cambio
  será local. Crepúsculo y noche, fuera de E5.
- **Imagen de fondo en *Rápido* frente a *Completo*: decisión para el
  lead.** En *Completo* y en el render pasa por la exposición y la curva
  de tono como el resto de la película, de modo que no sale idéntica a la
  foto; en *Rápido* se pinta tal cual. Lo correcto parece componerla en
  espacio de pantalla después de la curva (afecta al contrato de la
  película y a la salida); se deja anotado. Los rayos refractados por un
  sólido o reflejados ven el entorno, no la imagen de fondo.
- **El vidrio rugoso pierde energía** (dispersión simple): a rugosidad 1 y
  desde dentro conserva solo el 42 % en el peor caso. Un término de
  dispersión múltiple (Kulla y Conty 2017, Heitz et al. 2016) lo
  devolvería.
- **Memoria del HDRI por worker**: cada worker decodifica su copia (hasta
  4096 × 2048 en `f32`, unos 100 MB cada uno); los HDRI más anchos se
  reducen a la mitad al leerlos.
- **El vidrio macizo tapa los rayos de sombra**: sus cáusticas salen solo
  del muestreo de la BSDF, con luciérnagas visibles cuando un emisor
  pequeño se ve por reflexión especular (la bombilla de la hoja). El
  control de cáusticas y el *denoise* pasan a **E5b**, como dice el plan
  de oleadas.
- **Subsuperficie, madera, tela y bisel**, a **E6**. PIZ, PXR24, B44, DWA
  y los EXR en mosaico o profundos se rechazan con un mensaje que los
  nombra. Las paredes finas no se difuminan con la rugosidad. El cielo
  ignora la rotación (lo coloca su sol) y sujeta el sol a 1° como mínimo.

## E5c · Cielo físico propio, en sala limpia — **Opus** — hecha

**Decisión del líder (2026-10-13, a petición del usuario: «haz un port del
cielo desde una clean room»).** Ni se lee ni se usa la implementación de
referencia de Hošek–Wilkie ni sus tablas de coeficientes (la copia
descargada en E5 se borró sin abrirse). De la literatura pública se toma
solo la **forma funcional** del modelo (Hošek y Wilkie, «An Analytic Model
for Full Spectral Sky-Dome Radiance», ACM TOG 31(4), 2012): Perez
extendido con nueve coeficientes y el término de halo χ(H, γ), con
interpolación en la elevación del sol por Bézier de grado 5 sobre
elevación^(1/3), lineal en el albedo del suelo y en la turbidez. **Los
coeficientes los ajustamos nosotros** contra **nuestro propio simulador de
atmósfera**, como hicieron los autores con el suyo. Todo es nuestro y se
licencia con el proyecto.

**Qué.**
1. **Simulador** (herramienta fuera de línea, Rust solo `std`, sin tocar
   `rt-core`): atmósfera esférica estratificada; Rayleigh desde el índice
   de refracción del aire con el factor de King; aerosoles con espesor
   óptico desde la turbidez (Linke/Ångström) y fase de Cornette–Shanks o
   Henyey–Greenstein doble; absorción de ozono por capa; albedo del suelo;
   dispersión múltiple por Monte Carlo **determinista** (semilla fija,
   igual con cualquier número de hilos); espectral (≥ 32 bandas de 380 a
   720 nm) a XYZ con el ajuste analítico de las funciones CIE de Wyman,
   Sloan y Shirley (2013), y a Rec.709 lineal. Datos físicos solo de
   fuentes de dominio público o de fórmulas publicadas, citadas.
2. **Ajuste**: Levenberg–Marquardt propio por canal y por nudo (turbidez
   1–10, albedo 0 y 1, elevaciones), con la radiancia de escala aparte. La
   tabla resultante entra como datos con **receta, semilla y *hash***
   (como los recursos de A6) y se regenera con una orden de `rt`.
3. **Motor y vista previa**: el modelo nuevo en `sky.rs` detrás de la
   interfaz de Preetham, con la misma normalización a la irradiancia de la
   cúpula; Preetham queda como alternativa (*Clásico*) con un campo de
   modelo en `ENVR` (clave estable); el modelo nuevo es el de por defecto;
   puerto TypeScript para *Rápido* que coincide con el motor (≤ 1e-6
   relativo); *hashes* fijados para el cielo nuevo.
4. **Validación**: error del ajuste frente al simulador por elevación y
   turbidez (objetivo: < 5 % RMS relativo fuera de la corona solar), forma
   de la distribución frente al cielo despejado estándar de la CIE (ISO
   15469/CIE S 011, tipos 12 y 13, fórmula publicada) y frente a Preetham.
5. **Capturas para el usuario en cada hito** (lo pidió): cielos del
   simulador en ojo de pez a varias elevaciones; ajuste frente a simulador
   con mapa de diferencias; la escena de producto con el cielo nuevo frente
   a Preetham (amanecer, hora dorada, mediodía, turbio).

**Depende de.** E5.

**Criterio.** Lo de arriba medido y en tests (determinismo del simulador
y del ajuste, coincidencia motor/vista previa, *hashes* nuevos sin mover
los de antes), y el visto bueno visual del líder sobre las capturas.

**Hecho.** Un *crate* nuevo, `engine/crates/rt-sky` (herramienta fuera de
línea, Rust solo con `std`; `rt-core` no lo conoce), con el binario
`rt-sky`:

- **Simulador** (`atmosphere.rs`, `trace.rs`, `simulate.rs`): Tierra de
  6371 km y atmósfera hasta 86 km en 64 capas esféricas (la primera de
  50 m, el grosor creciendo en progresión geométrica), cada una con la
  densidad media de su tramo; aire de la U.S. Standard Atmosphere 1976;
  sección eficaz de Rayleigh de Bodhaine et al. (1999) con el índice de
  Peck y Reeder (1972) a 360 ppm de CO₂ y el factor de King de Bates
  (1984) (τ_R(550 nm) = 0,097 a nivel del mar, como su tabla), fase de
  Rayleigh con la anisotropía molecular de Chandrasekhar; aerosoles con
  τ_a(550) = (T − 1) τ_R(550) (Linke; equivale a la relación de Preetham
  entre su turbidez y la β de Ångström) y λ^−1,3, altura de escala
  1,2 km, albedo simple 0,95, fase de Cornette y Shanks con **asimetría
  0,7** (su parámetro no es la asimetría: se despeja, 0,638; el primer
  hito usó 0,7 como parámetro, es decir 0,757 de asimetría, y el visto
  del líder lo cazó: test del coseno medio); ozono de 300 DU en una capa
  gaussiana a 22 km con los coeficientes de Leckner (1978) tabulados por
  Bird y Riordan (1986); sol de cuerpo negro a 5772 K con el radio
  nominal de la IAU 2015 (1361 W/m²); 34 bandas de 10 nm de 380 a
  720 nm → XYZ con el ajuste de Wyman, Sloan y Shirley (2013) → Rec. 709
  lineal. La dispersión simple, por cuadratura a lo largo del rayo (pasos
  de 2 km y 0,05 de profundidad óptica, la transmitancia hacia el
  observador integrada exacta en cada paso; un test la compara con Monte
  Carlo al 1 %); la múltiple, por Monte Carlo con estimación del sol en
  cada suceso, todas las bandas a la vez con MIS de una muestra entre
  bandas (heurística de balance), colisión forzada hacia arriba,
  direcciones de la mezcla de las dos fases y un lóbulo hacia el sol,
  suelo lambertiano y los dos albedos (0 y 1, y 0,2 para validar) de los
  mismos caminos. Determinista: funciones elementales `f64` propias
  (`dmath`), un flujo xoshiro256** por (semilla, cielo, dirección),
  resultados en casillas fijas.
- **Ajuste** (`model.rs`, `fit.rs`): la forma funcional de Hošek y Wilkie,
  por canal, turbidez 1–10 y albedo 0 y 1 (60 nudos); `L_M` por mínimos
  cuadrados lineales (Bézier de 6 puntos en (elevación/90°)^(1/3)), cada
  elevación sola (rejilla de los cuatro coeficientes no lineales con los
  cinco lineales resueltos exactos, Levenberg–Marquardt desde los ocho
  mejores y desde la elevación anterior con un tirón débil hacia ella, y
  otra pasada dividiendo por su propio modelo y no por el dato ruidoso),
  curvas de Bézier por los no lineales, los 30 puntos lineales resueltos
  exactos para ellas, y Levenberg–Marquardt propio sobre los 54 puntos
  contra todas las elevaciones. Cotas: |H| < 0,95 y E ≤ −0,5 (sin ella
  aparecían pares C ≈ −100, D ≈ +100 que imitaban una recta en γ y
  arruinaban el arranque conjunto).
- **Receta** (`dataset.rs`, en la cabecera de `sky_table.rs`): semilla
  `0x0e5c5c1e`, 272 caminos de dispersión múltiple por dirección, 16
  elevaciones del sol (90° (i/15)³), 768 direcciones (anillos de 3° hasta
  84° y de 1,5° hasta el horizonte por 24 acimuts) y 34 bandas. Tabla:
  3240 coeficientes y 360 radiancias `f32`, **SHA-256
  `2329ac7376204749a317d5b31e23e17fa27950515be0f0d50018cd9c16e8a721`**.
  `cargo run --release -p rt-sky -- table` simula (unos 10 min con 3
  hilos en la máquina compartida) y ajusta (unos 12 min). Regenerada desde
  cero con 2 hilos en lugar de 3: la simulación y la tabla salen idénticas
  byte a byte.
- **Motor**: `PhysicalSky` en `rt-core/src/sky.rs` detrás de la interfaz
  de Preetham (`new`, `radiance`), mezclando radiancias (no
  coeficientes) entre turbideces y albedos, albedo del suelo 0,2, sol de 0
  a 90°; `sky_image` lo normaliza a la irradiancia de la cúpula como antes,
  con sumas compensadas (Neumaier) solo en el físico: el clásico da los
  mismos bits que en E5. `ENVR.sky_model` (84 B): 0 físico (también un RSB
  sin el campo y cualquier valor desconocido), 1 clásico; es el último
  campo. *Hashes*: los de antes no se mueven (ejemplo `0x223515c3`, E5 HDRI
  `0xbf8abd5b`, E5 cielo `0x2fcb098a`, que pasa a pedir *Clásico*
  explícitamente); nuevo **`0x8bb09f6b`**, la escena de E5 con el cielo
  físico a 12° y turbidez 2,5 (`rt --write-e5c-example`), igual en
  escalar, SSE2, AVX2, WASI escalar y `simd128` y con el `rt_wasm.wasm`
  real (paso nuevo de `engine.yml`). La hoja de contactos añade cuatro
  pares físico/clásico (amanecer, hora dorada, mediodía, bruma).
- **Vista previa e interfaz**: `src/core/sky.ts` porta el cielo físico
  sobre `src/core/f32math.ts`, que emula en `f32` el `fmath` del motor;
  `tests/fixtures/sky-physical.json` (6 cielos, 354 píxeles, escrito por
  `rt-sky fixture` y comprobado al día por un test de `rt-sky`) coincide
  **bit a bit** (6372 valores). `skyModel` (`PHYSICAL` · `CLASSIC`) en el
  estado, el proyecto (sin el campo: `PHYSICAL`) y la biblioteca;
  *Entorno* ▸ *Cielo* ▸ *Modelo* (*Físico · Clásico*, con ayuda), en es y en;
  la bruma baja a 1.
- **Validación** (`rt-sky validate`, `validation.json`): 40 cielos de bajo
  ruido (4352 caminos; turbidez 2, 2,5, 4, 6,5 y 9, sol a 0,5, 3, 10, 20,
  35, 50, 70 y 85°, ninguno en una elevación del ajuste y la mitad entre
  dos turbideces), 143 direcciones. Error RMS relativo de la luminancia
  fuera de la aureola (10°), suelo negro / blanco / gris 0,2 interpolado:
  **sol ≥ 20°: 1,0–7,9 % (media 3,8) / 1,4–5,3 % (2,3) / 2,8–7,3 % (4,1)**;
  sol a 10°: 5,2–14,6 % (8,5) / 3,5–10,0 % / 4,6–13,7 %; **sol ≤ 3°:
  9,2–16,7 % (12,9)** / 6,4–11,1 % / 8,7–15,6 %. El ruido de los datos del
  ajuste es 1,8 % por cielo a T 1, 3–5 % a T 2 y 5–9 % a T 6–9 (otra
  semilla): el 9,5 % medio de `table.json` frente a esos datos es sobre
  todo ruido. Forma frente al cielo despejado de la CIE (ISO 15469, L/L_z
  fuera de la aureola, sol ≥ 10°): tipo 12 frente a turbidez ≤ 2,5,
  23 % de media (Preetham 44 %); tipo 13 frente a 4–6,5, 22 % (Preetham
  43 %). En el almucantar, a 65° el físico sigue al tipo 12 a menos de un
  10 % de 3 a 30° del sol; a 30°, la aureola de turbidez 2,5 sale 1,45–1,7
  veces la del tipo 12, cerca del 13 (informativo). Ozono comprobado: a
  1° el cénit pasa de xy (0,300, 0,318) sin ozono a (0,265, 0,279) con él
  (Preetham: 0,281, 0,301).
- **Tests nuevos**: 22 en `rt-sky` (funciones elementales frente a `std`,
  atmósfera estándar y Rayleigh frente a sus tablas, fases normalizadas y
  coseno medio, turbidez de Linke, geometría de capas, simulación igual
  con 1 y 3 hilos, cuadratura frente a Monte Carlo, gradiente analítico,
  ajuste de un cielo sintético y su determinismo, SHA-256, caché, rejillas,
  la tabla frente a su *hash* y a las dos fuentes generadas, el *fixture*
  al día), 4 en `rt-core` (cielo físico, linealidad y entradas, clásico
  intacto, `sky_model` del RSB) más el *hash* de E5c, el par físico/clásico
  de la hoja en `rt-cli` y 6 en `tests/sky-physical.test.ts`; se
  comprobó que fallan reintroduciendo seis errores (parámetro de
  Cornette–Shanks = asimetría, pesos de turbidez cambiados en motor y
  vista previa, RSB viejo leído como clásico, sumas sin compensar, el
  modelo sin escribir en el RSB).

Capturas de cada hito (para el visto bueno, que el líder dio): cielos del
simulador en ojo de pez, ajuste frente a simulador con mapa de errores a
exposición automática y fija, la escena de producto con los dos modelos y
la vista *Rápida* con el *Inspector*.

Lo que no encajó con el plan:

- **Límite de la forma funcional con el sol bajo (aceptado por el
  líder).** El objetivo de < 5 % se cumple con el sol a 20° o más (salvo
  turbidez 9 a 20°, 7,9 %); a 10° el error es del 5–15 % y por debajo de
  3° del 9–17 %, y ajustando cada elevación por separado ya queda en el
  12–18 %: es la forma, no el ajuste ni la interpolación (ni aflojando las
  cotas mejora). Se ve como un patrón acimutal de ±20 % al amanecer y un
  resplandor de la hora dorada con bruma un ~20 % oscuro junto al sol, a
  lo largo del horizonte. **Propuesta de continuación** (no construida):
  una tabla pequeña de corrección residual para el sol por debajo de
  ~10°, ajustada con el mismo simulador (nuestra, con receta, semilla y
  *hash*) y aplicada como factor después del modelo analítico.
- **La orden de regeneración es `rt-sky table`**, un binario aparte, no
  una opción de `rt`: el simulador no debe ir en el `rt` que se distribuye.
- **El ozono** usa los coeficientes de Leckner tal como los tabula Bird y
  Riordan, escritos con dos o tres cifras y, en el pico de Chappuis
  (0,12 (atm·cm)⁻¹), un ~10 % por debajo de las secciones eficaces de
  laboratorio modernas; conviene cotejarlos con la tabla original. **El
  sol** es un cuerpo negro de 5772 K, no el espectro medido (le faltan las
  rayas de Fraunhofer y anda un ~10 % bajo entre 450 y 550 nm); solo
  afecta al color, y poco, porque el cielo se escala a la cúpula.
- **Albedo del suelo fijo en 0,2** (el habitual en ingeniería solar): el
  modelo admite 0–1 (`PhysicalSky::new` lo recibe) pero `ENVR` no tiene
  campo ni la interfaz control; decisión de producto para el líder. Mezclar
  linealmente entre los albedos 0 y 1 cuesta lo que se ve en la columna
  gris de la validación (2,8–7,3 % con el sol alto).
- **Proyectos y RSB antiguos se abren con el cielo físico** (el valor por
  defecto, como decía el plan): un proyecto de E5 con *Cielo* cambia de
  aspecto al abrirlo; si se prefiere que conserve el clásico, es un paso
  de esquema de una línea. La escena fijada de E5 pide *Clásico* para que
  su *hash* no se mueva.
- **La vista previa no es `f64`**: en el primer factor (1 + A e^(B/(cos θ
  + 0,01))) A ≈ −1,1 y el resultado se cancela hasta ~0,12 cerca del cénit,
  y el `f32` del motor difería del `f64` en 1,5·10⁻⁶; emular el `f32` da
  los mismos bits. La bruma va de 1 a 10 en los dos modelos; el clásico la
  sujeta a 1,7.
- **Las capturas del hito (a)** se hicieron antes de corregir la asimetría
  de los aerosoles; las de (b) a (d), con la tabla final.

## E5b-1 · Cáusticas y *denoise* propio — **Opus** — hecha

**Petición del usuario (2026-10-13):** «integra también cáusticas,
*denoise*…». Se adelanta esta parte de E5b; el reflejo del suelo, los
efectos de imagen y la región de render quedan en **E5b-2**.

**Decisiones del líder.**
- ***Denoise* propio**, en Rust sin dependencias (en `rt-post` o en un
  *crate* propio, nativo y wasm), escrito desde la literatura pública
  (medias no locales guiadas por rasgos, Rousselle, Knaus y Zwicker 2012;
  à-trous con aristas, Dammertz et al. 2010): guiado por los pases exactos
  de X2 (albedo, normal, profundidad, ids) y por la **varianza por píxel**
  (la película acumula también la suma de cuadrados). Determinista: la
  misma entrada da los mismos bits en nativo y en wasm. Nada de redes ni de
  pesos de terceros.
- Dónde: *Ajustes de render ▸ Avanzado ▸ Denoise* (*Apagado · Visor ·
  Render · Los dos*, por defecto **Los dos**) y un interruptor en el visor
  *Completo*; en el render se guardan la imagen limpia y, si se pide, la
  original (*Guardar también sin denoise*). Nunca toca la imagen de la IA
  más que como entrada.
- **Cáusticas**: mapa de fotones progresivo (SPPM, Hachisuka y Jensen
  2009) para los caminos luz → especular → difuso, determinista, sin
  contar dos veces lo que ya trae el trazador; interruptor *Cáusticas* en
  la ventana de render (por defecto **automático**: encendido cuando la
  escena tiene vidrio o metal pulido y luces pequeñas), con su calidad en
  *Avanzado*. El vidrio macizo sigue tapando la sombra directa; la luz que
  lo atraviesa llega por las cáusticas.

**Criterio.** *Denoise*: error frente a una referencia de muchas muestras
menor que la imagen sin filtrar a igual número de muestras (escenas del
`--sheet`), aristas de id intactas (ninguna mezcla entre piezas),
paridad nativo/wasm bit a bit, *hashes* de la imagen sin *denoise* sin
mover. Cáusticas: una esfera de vidrio sobre el suelo con una luz pequeña
da su foco de luz con la energía esperada (test analítico o frente a una
referencia larga del trazador), sin luciérnagas en la imagen con
*denoise*; determinismo con cualquier número de hilos. Capturas antes y
después.

**Hecho.**

- **Varianza en la película.** `Film::lum2` suma el cuadrado de la
  luminancia de cada muestra (`f32`, en orden de muestra) sin tocar la
  radiancia, el peso ni la cobertura: ningún *hash* de imagen se movió
  (ejemplo `0x223515c3`, E5 `0xbf8abd5b`, cielo de E5 `0x2fcb098a`, E5c
  `0x8bb09f6b` y los seis de pases de X2, en todas las rutas SIMD, WASI y
  el `rt.wasm` real). La página la suma con la misma regla
  (`Accumulator.lum2`, `Math.fround`).
- ***Denoise*** (`rt_post::denoise`, Rust con `std`, sin pesos de nadie):
  à-trous con paradas en aristas de Dammertz, Sewtz, Hanika y Lensch (HPG
  2010; núcleo B3, cinco pasadas con pasos 1–16 px) con la parada de
  luminancia guiada por la varianza de SVGF (Schied et al., HPG 2017:
  varianza emborronada 3 × 3 y propagada como `Σ w² Var / (Σ w)²`, normal
  `max(0, n·n')^128`, profundidad con su gradiente, albedo dividido y
  vuelto a multiplicar, varianza espacial 7 × 7 por debajo de cuatro
  muestras). Lo nuestro: la varianza de la película, los pases exactos de
  X2 como guía, **peso cero entre dos piezas o dos materiales** (nunca las
  mezcla) y el fondo intacto, un recorte de luciérnagas antes de filtrar
  (un píxel más de cuatro veces más brillante que todos sus vecinos de la
  misma superficie baja a eso) y `(1 − x/16)^16` en lugar de exponenciales.
  Bandas de filas con un halo de 72 filas, exactamente esas filas de la
  imagen entera, así que `rt`, el lanzador y la página reparten el trabajo
  como quieren con los mismos bits. Error relativo (relMSE) frente a una
  referencia de 384 muestras en escenas de la hoja (48 × 36, el test):
  *key-only* 0,0401 → 0,0132 a 4 spp y 0,0048 → 0,0030 a 16; frasco de
  vidrio 0,1259 → 0,0301 y 0,0284 → 0,0070; al tamaño de la hoja, entre el
  4 y el 20 % del error sin filtrar a 4 spp. Coste: 4,6 s una imagen de
  1920 × 1080 en un hilo y 2,4 s en cuatro (máquina compartida y cargada).
  *Hash* fijado `0xab15f290` (`PINNED_DENOISED_EXAMPLE_4SPP`, el ejemplo
  a 4 spp), igual en nativo, en el `rt.wasm` real por bandas y por el
  código de la página con 1 y 2 *workers*.
- **Cáusticas** (`rt_core::caustics`): SPPM (Hachisuka y Jensen 2009) en
  la forma probabilística de Knaus y Zwicker (2011): cada índice de muestra
  es una pasada con sus fotones, sin estado por píxel, y la película
  promedia las pasadas. Partición *caster* / receptor / suceso recto, mapa
  de los tramos `L C+ R` reunido en **cada** receptor del camino de cámara
  y el trazador sin esa luz (ver los destellos, abajo); emisión dirigida a
  las esferas envolventes de los *casters* con la densidad de la mezcla,
  flujo sin 1/η², corrección adjunta de normales de Veach, PCG por
  (semilla, muestra, fotón), rejilla *hash*, núcleo de Epanechnikov;
  atrapasombras con cáusticas relativas al suelo abierto. Coste medido: el
  frasco a 640 × 480 y 64 spp, 9,2 s sin fotones y 11,4 s con 16 384 por
  muestra (*Media*), un 24 % más. *Hash* fijado **`0x55d60f2f`**
  (`PINNED_E5B_CAUSTICS_4SPP`, la escena de E5 con 2048 fotones por
  muestra, `rt --write-e5b-example`), igual en escalar, SSE2, AVX2, WASI
  escalar y `simd128`, el `rt.wasm` real, el lanzador con 1, 4 y 16 hilos y
  el código de la página.
- **RSB**: `RNDR` pasa a 52 B con `denoise` (bit 0 imagen limpia, bit 1
  también la original), `caustic_photons` (hasta 2²²) y `caustic_radius`
  (px); un RSB anterior se lee sin *denoise* ni cáusticas. **Anfitriones**:
  `rt --denoise --keep-noisy --caustics N --caustic-radius R` y la hoja
  con los pares nuevos; el lanzador traza los mapas por rangos en todos
  sus hilos, en el visor reduce ruido en el primer fotograma, en el último
  y entre medias solo si ha pasado tres veces lo que costó la última vez, y
  el render final entrega la limpia y, si se pide, la original; en la
  página cada *worker* traza los mapas de sus muestras (guarda 16) y el
  *pool* reduce ruido por bandas (`rt_denoise`).
- **Interfaz**: *Calidad* ▸ *Cáusticas* (*Automático · Encendidas ·
  Apagadas*; *Automático*: un *caster* y una luz *glossy* que vista desde
  ellos no pase de 20°, un sol o un emisor encendido); *Avanzado* ▸
  *Calidad de cáusticas* (*Baja* 4096 fotones y 4 px, *Media* 16 384 y
  3 px, *Alta* 65 536 y 2 px), *Reducción de ruido* (*Apagada · Visor ·
  Render · Los dos*, por defecto *Los dos*) y *Guardar también sin
  reducción de ruido*; en el visor *Completo*, el medidor dice *Ruido
  reducido* y *Cáusticas · N fotones por muestra* cuando el motor lo hace,
  y el botón *Reducir ruido* cambia solo la parte del visor. La IA recibe
  la imagen limpia como entrada.
- **Tests**: 19 nuevos en `rt-core` (clasificación de *casters*; flujo de una esfera de vidrio frente
  a una integración exacta en `f64`, 0,2 %; núcleo; reparto y SIMD de un
  mapa; calendario del radio; partición frente al trazador solo en la
  sombra de una esfera, bajo una esfera de metal pulido, con dos esferas
  solapadas, en un suelo iluminado por la cáustica de una pared y con un
  punto de luz de L4 junto al mapa; vidrio
  macizo; atrapasombras; luz encerrada en vidrio con mapa vacío; estados
  de la partición; orden de baldosas; `lum2`; RSB; *hash* fijado), 7 en
  `rt-post`, los de `rt-cli` (hilos 1/4/16, error del
  *denoise*, CLI), `rt-wasm`, `rt-app` (paridad con `rt`, visor, cáusticas
  con 1/4/16 hilos) y la interfaz (`tests/denoise.test.ts` con el
  `rt.wasm` real, *pool*, lanzador, cola, RSB). Se comprobó que fallan
  reintroduciendo cada error: sin regla de descarte, sin reunir, sin η²,
  núcleo mal normalizado, sin atrapasombras, radio congelado, estado que
  cambia en un suceso recto, NEE sin descartar en un *caster*, densidad de
  un solo cono, estado que no vuelve a empezar en el segundo receptor,
  reunir solo en el primero, la luz de un punto quitada con el mapa
  encendido, sin parada de ids, halo corto, `lum2` sin cuadrado (en Rust y
  en la página), sin guardar la original, sin leerla del lanzador.

**Convergencia de la cáustica (pregunta del líder).** Sí: el radio se
encoge con las pasadas como dicen Knaus y Zwicker,
`r_i² = r_1² Π_{k=1..i} (k + α)/(k + 1)` con α = 2/3, así que
`r_i ∝ i^(−1/6)` (r_1024 ≈ 0,33 r_1); converge a calidad final sin estado
por píxel. Medido en el frasco a 240 × 180 (r_1 = 3 px, 16 384 fotones por
muestra), región de la cáustica = 2328 píxeles del suelo en la sombra del
centro de la luz a más de 2 px de la silueta; relMSE (media de
`(x − r)²/(r² + 0,01)` por canal, valores recortados a 1) frente a una
referencia larga con otra semilla:

| muestras | radio | cúpula 0,12 (ref. 8192 spp) sin / con *denoise* | entorno negro (ref. 4096) sin / con |
|---|---|---|---|
| 16 | 1,98 mm | 0,0224 / 0,0104 | 0,0325 / 0,0168 |
| 64 | 1,58 mm | 0,0074 / 0,0052 | 0,0107 / 0,0077 |
| 256 | 1,25 mm | 0,0037 / 0,0032 | 0,0051 / 0,0044 |
| 1024 | 1,00 mm | 0,0026 / 0,0025 | 0,0031 / 0,0031 |

Media de la región a 1024: 0,2852 frente a 0,2864 de la referencia
(cúpula) y 0,2181 frente a 0,2186 (negro). Antes de corregir los destellos
la curva subía a 1024 (0,0048 y 0,0068): dos píxeles con un destello se
llevaban el 77 % del error. Las referencias se hicieron antes de esa
corrección (el trazador es insesgado para esos caminos, así que valen).
La hoja añade el par pedido: el frasco con cáusticas a 1024 muestras
(*Final*), sin y con *denoise* (`e5b-bottle-caustics-final`).

**Los destellos del par *Final* (pregunta del líder).** Con cada muestra
separada por tipo de camino (recorte de 260 × 125 alrededor de la base,
1024 spp): de 324 píxeles con destello, **157 eran del tipo (a)**: luz de
una luz de fotones que, después del **segundo** receptor del camino, llegaba
por el vidrio (`L C+ R C* R E`, una cáustica vista por un rebote difuso:
el suelo junto al frasco viendo la cáustica a través del vidrio). La
partición reunía el mapa solo en el primer receptor y dejaba al trazador
todo lo de después: no contaba dos veces (la energía cuadraba), pero esos
caminos llegaban en una muestra de cada mil con unas 1300 veces el valor
medio. **Corregido**: cada receptor reúne el mapa (los siguientes al
primero con el recorte de la luz indirecta) y el trazador descarta esa luz
después de cualquier receptor; tests nuevos (luz encerrada en una bola de
vidrio: con el mapa vacío todos los píxeles de receptor quedan negros, y la
energía de un suelo iluminado por la cáustica de una pared cuadra con el
trazador solo a −3 %; con el código anterior, 305 de 814 píxeles se
encienden y el suelo sale −11 % a 192 spp). Del tipo (b) no hay nada: el
vidrio macizo tapa la NEE y la NEE en un *caster* después de un receptor se
descarta. Quedan **40 píxeles del tipo (c)**, brillos reales: la luz vista
por la base de vidrio (`E C+ L`, también el brillo del tapón a través de
ella), dos manchas de 2–4 px con medias de hasta 81 que el *denoise*
conserva, y la línea focal de la cáustica en el borde de la base (estable
de muestra a muestra). Capturas: `docs/ui/engine-e5b1-bottle-caustics-final.png`
(el par vuelto a hacer) y `docs/ui/engine-e5b1-bottle-glints-4x.png`
(la base a 4×: antes, después y después con *denoise*). Las escenas sin
cáusticas no cambian de bits.

Capturas: `docs/ui/engine-e5b1-denoise-4spp.png` (4 spp sin y con
*denoise*), `docs/ui/engine-e5b1-bottle-caustics.png` (el frasco a 64 spp
sin y con cáusticas) y las dos de arriba.

Lo que no encajó con el plan:

- **SPPM sin estadísticas por píxel**: el radio es global por pasada
  (Knaus y Zwicker) y no el de Hachisuka y Jensen por punto visible; es lo
  que permite renderizar baldosas en cualquier orden e hilo con los mismos
  bits. Converge igual, pero el radio no se adapta a la densidad local.
- **El entorno no emite fotones** (sus cáusticas siguen en el trazador) ni
  las luces no *glossy*, ni los **puntos, esferas y focos direccionales de
  L4** (llegaron con la fusión: sus cáusticas siguen en el trazador, así
  que un punto no da ninguna, y *Automático* no los cuenta; un test
  comprueba que con el mapa encendido el trazador no les quita su luz por
  el vidrio); los brillos `E C+ L` de luces pequeñas en vidrio
  liso siguen siendo del trazador (son reales, pero convergen despacio).
- **Las cáusticas del primer receptor no pasan por el recorte de luz
  indirecta** (`clamp_indirect`); las de los siguientes, sí.
- **Atrapasombras con fondo transparente**: sin cáusticas (su alfa lleva
  solo la sombra).
- El ***denoise* filtra RGB, no la cobertura**, y no se aplica a los
  fotogramas de resolución reducida de los gestos; entre dos *denoise* el
  visor muestra el último limpio. El recorte de luciérnagas pierde algo de
  energía donde las hay.
- **El interruptor *Cáusticas* está en *Calidad*** y su calidad en
  *Avanzado*, como pedía el plan, pero los dos campos se guardan en
  `advanced` del proyecto; los proyectos antiguos abren con *denoise*
  *Los dos* y cáusticas *Automático* (los valores por defecto).
- ***Automático*** decide con un umbral de 20° para «luz pequeña» y
  cuenta el metal cepillado como *caster* a lo largo de su cepillo
  (`r ⁴√(1 − 0,9 a)` ≤ 0,25), así que el tapón del frasco lo es.
  **Decisión tomada (Fable): se quedan los dos.** *Automático* quiere decir
  «encendidas cuando puede salir una cáustica nítida que el trazador solo
  encontraría por casualidad», que es justo lo que da luciérnagas. Una luz
  de más de 20° vista desde el objeto (un *softbox* de 1 m a menos de unos
  2,8 m) da cáusticas tan blandas que el trazador las resuelve bien, y no
  las enciende. Un metal cepillado bajo una luz pequeña sí echa al suelo
  una estela de luz a lo largo del cepillo, así que cuenta. El coste
  (≈ +24 %) solo se paga con una luz pequeña en escena, y *Apagadas* sigue
  a mano.
- **El coste en el visor *Completo*** se dice en el medidor (fotones por
  muestra) y en la ayuda, no en segundos.

## Hacia el mejor modo Completo — decisión **Fable** (tras v0.1.5)

**Qué hay ya, y está bien.** Sobol con *scramble* de Owen por píxel y
dimensión (Burley 2020) y un *layout* de pares comprobado; estimación del
siguiente evento con heurística de potencia; GGX anisótropo con vidrio
refractado por microfacetas (Walter 2007), absorción, pared fina, recorte
y barniz con capa que conserva la energía; HDRI por CDF 2D, cielo físico
propio, sol como disco; cáusticas por mapa de fotones progresivo; *denoise*
propio guiado por pases; terminador de sombra suave (RTG II); curvas ACES,
fílmica y AgX; determinismo por bits con cualquier número de hilos. Es una
base seria. Lo que sigue es lo que separa un render «correcto» de una
fotografía, por orden de lo que más se nota en una foto de producto.

**Qué falta, por orden de importancia visual.**

1. **Aristas vivas.** Un modelo CAD tiene aristas matemáticamente afiladas,
   y una arista afilada no coge luz: se ve el «aspecto 3D» a la primera.
   El bisel en el sombreado (E6, adelantado y pasado a Opus) es la mejora
   de realismo más barata y más visible que nos queda.
2. **Materiales translúcidos y líquidos.** Plástico de bote (HDPE, PP),
   jabón, cera, acrílico esmerilado, leche, zumo, cremas: hoy no se pueden
   hacer bien (hay absorción, no dispersión). Es el material del
   *packaging*. Medios dispersores dentro de un sólido (E9b).
3. **Energía del GGX.** Un metal o un plástico rugosos pierden hasta un
   40 % de luz con una sola dispersión de microfacetas: salen oscuros y
   apagados frente a la realidad. Compensación de dispersión múltiple
   (E9a). Pequeña y de efecto inmediato en todo el catálogo.
4. **Ruido donde importa.** Hoy cada píxel recibe las mismas muestras; la
   varianza por píxel que ya guardamos (`lum2`) permite dar más a los
   bordes de sombra, los vidrios y los brillos y menos al fondo. Muestreo
   adaptativo determinista y «terminar por ruido» (E10): la misma limpieza
   en menos tiempo, o más limpieza en el mismo.
5. **Reducción de ruido en directo** en el visor, con su interruptor en
   la barra superior (U11, petición del usuario).
6. **Texturas y etiquetas** (M2): sin la ilustración del envase no hay
   foto de producto. No es calidad del motor, es lo que falta para «el
   mejor resultado»; va en la ola siguiente.
7. **Dispersión cromática** del vidrio (perfume, cristal): E9c, al final
   de E9 si cabe, con longitud de onda por camino (sin motor espectral).
8. **Óptica de cámara** (láminas del diafragma, ojo de gato, viñeteo,
   aberración cromática): ya está planificado en `STUDIO-TOOLS.md` §1 y no
   se duplica aquí.
9. Después: árbol de luces (K4) cuando haya muchas luces; estimación en
   variedad (MNEE) para los brillos de luces pequeñas a través de vidrio;
   *denoise* temporal del visor; rendimiento de la BVH (E8); IES (L5).

**Lo que no se hace, y por qué.** Motor espectral: multiplica el coste y
solo aporta en dispersión y metamerismo; la dispersión se resuelve con
una longitud de onda por camino. Bidireccional o Metropolis: las
cáusticas ya las da el mapa de fotones y el resto lo resuelve mejor el
muestreo adaptativo. GPU: fuera de las reglas del motor (portable, sin
dependencias, determinista).

**Orden.** Ola A, en paralelo: U11, E9 (a, luego b, luego c si cabe) y
E6 (bisel primero). Ola B: E10 (toca el bucle de render, después de U11)
y M2. Cada fase, una PR; `npm run qa`, `engine:test` en *debug* y
*release*, *hashes* fijados intactos salvo donde la fase diga.

## U11 · Reducción de ruido en directo — **Opus** — hecha

**Qué.** Un interruptor **Reducir ruido** en la barra superior, a la
derecha de *Rápido · Completo*, con el mismo estado que el botón del
medidor del visor y que el bit *Visor* de *Avanzado ▸ Reducción de ruido*
(una sola verdad, deshacible, guardada en el proyecto como hasta ahora);
en *Rápido* se ve deshabilitado con la ayuda «se aplica al modo
Completo». Y que sea **en directo**: hoy el visor reduce ruido en el
primer fotograma, en el último y entre medias solo si ha pasado tres
veces lo que costó la última, y mientras tanto enseña el último limpio,
que se queda atrás. Debe pasar a: (1) al encenderlo, reducir ruido de la
acumulación actual al momento; (2) mientras se acumula, un *denoise* en
canal aparte (un hilo del lanzador; en la web, los *workers* por bandas
como ahora) que no para el render y presenta el resultado en cuanto
acaba, con el siguiente arrancando entonces, de forma que el visor
refresca la imagen limpia tan a menudo como cuesta un *denoise* y nunca
enseña una limpia de hace más de un *denoise*; (3) un **ajuste de visor**
del filtro (3 pasadas à-trous en vez de 5 y sin la varianza espacial 7×7
a partir de 4 muestras, o lo que mida mejor) para que en el tamaño del
visor quede por debajo de ~0,4 s en 4 hilos; el render final conserva el
filtro completo. Atajo de teclado (uno libre; documentarlo), paso del
recorrido guiado actualizado, cadena en `es` y `en`.

**Depende de.** E5b-1.

**Criterio.** Con el visor en *Completo* y el interruptor encendido, la
imagen limpia se refresca al menos cada `max(2 × coste del denoise,
0,5 s)` (test del lanzador con un *denoise* falso de coste fijo); al
apagarlo, el siguiente fotograma es el ruidoso; el render final no
cambia de *hash* (`0xab15f290` del ejemplo con *denoise*); los gestos
siguen a resolución reducida sin *denoise*; captura `docs/ui/
denoise-live.png` con la barra superior.

**Hecho.**

- **Interruptor *Reducir ruido*** en la barra superior, a la derecha de
  *Rápido · Completo* y en la misma zona (`data-guide="viewport-mode"`,
  la que rodea el paso *Rápido y Completo* del recorrido guiado, cuyo
  texto lo nombra con su atajo): un botón de una posición, acromático, en
  negativo cuando está encendido, con su *tooltip* y el atajo **`D`**
  (libre; en la tabla de UI.md §3). **Una sola verdad**: la parte *Visor*
  de `render.advanced.denoise` (*Los dos* ↔ *Render*, *Visor* ↔
  *Apagada*), que la barra, el botón del medidor y `D` leen y cambian con
  el mismo comando (`toggleViewportDenoise`), por el *store*, deshacible
  con su nombre (*Reducir el ruido del visor* / *Dejar de reducir el ruido
  del visor*) y guardada en el proyecto. En *Rápido* se ve deshabilitado
  con la ayuda *Se aplica al modo Completo* y `D` solo lo dice.
- **Ajuste de visor del filtro** (`rt_post::denoise::Preset`): `FULL`
  (el de E5b-1, para el render y `rt`, mismos bits: `0xab15f290`) y
  `VIEWPORT`, **tres pasadas à-trous y la varianza espacial 3 × 3** por
  debajo de cuatro muestras, con su halo propio de 24 filas
  (`Preset::halo = 2^(pasadas+1) + 8`, que da los 72 del completo).
  Bandas exactamente iguales a la imagen entera con los dos; *hashes*
  fijados del ejemplo con el del visor a 2 y 4 muestras
  (`PINNED_DENOISED_VIEWPORT_EXAMPLE_2SPP` = `0x04d4a08c` y `_4SPP` =
  `0xc90ee509`; con la elección de luz de E12, `0x17514303` y
  `0x6db6039b`), iguales en nativo, en el `rt.wasm` real
  (`rt_denoise_with`, `rt_denoise_halo`) y por el código de la página con
  1 y 3 *workers*. Lo elige el tipo de trabajo; el `RSB`/`RNDR` no cambia.
  Medido (tabla abajo): de las ocho combinaciones probadas es la que da
  mejor calidad por debajo de ~0,4 s en el tamaño del visor con cuatro
  hilos.
- **En directo, en el lanzador** (`rt-app/src/render.rs`): un visor a
  resolución completa renderiza siempre las guías y tiene su interruptor
  (`denoise=0|1` al publicarlo, `POST /api/render/<id>/denoise?on=0|1`
  después). Cada pasada se entrega a un **carril** propio (un hilo por
  trabajo de visor) que, encendido, reduce el ruido de la pasada más
  nueva, la presenta en cuanto acaba y arranca el siguiente sobre la más
  nueva entonces; mientras trabaja **toma uno de los hilos de render del
  visor** (el último de los que renderizan, `Gate::viewport_turn`), así
  que con un render final en marcha nunca le quita un hilo a este. Al
  encenderlo reduce el ruido de lo acumulado al momento (si ya tenía la
  limpia de esa pasada, la enseña sin más), también con el visor ya
  terminado; al apagarlo, el fotograma siguiente es la acumulación
  ruidosa, publicada en la misma llamada. Con el interruptor encendido las
  pasadas duran lo que un *denoise* y al menos 250 ms (`live_pass_cap`):
  como una muestra cae en la pasada que sea sin cambiar un píxel, la
  imagen limpia llega como mucho una pasada y un *denoise* después de la
  anterior. La regla de antes (primera, última y entre medias si habían
  pasado tres veces lo que costó la anterior) desaparece en el visor; el
  render final sigue con un *denoise* al final con el filtro completo.
- **En la web** (`render/pathtracer.ts`): igual, con el carril en los
  *workers* del visor por bandas entre sus baldosas (las pasadas siguen);
  la página guarda las sumas de la última pasada para él. Las mismas
  pasadas cortas (`livePassCap`).
- **Fotogramas con número de imagen**: la cabecera `RPX1` pasa a 52 bytes
  con `Frame::version`, que cambia cada vez que cambian las sumas (una
  pasada, una imagen limpia, el interruptor). El *long-poll* de la página
  la pide con `version=`; el lanzador manda las sumas solo con una imagen
  más nueva, y con un visor ya terminado espera a la limpia que se pidió.
  Un lector de antes lee la cabecera por su longitud, que va en ella.
- **Los gestos** siguen a resolución reducida, sin guías ni *denoise*.
- **Pruebas** (rt-post 4, rt-wasm 1, rt-app 6 unitarias y 1 por HTTP; la
  interfaz: `tests/live-denoise.test.ts`, 12; `tests/pathtracer.test.ts`,
  3 nuevas y 1 rehecha; `tests/denoise.test.ts`, 2 nuevas, una con el
  `rt.wasm` real) y una comprobación en el navegador
  (`tools/denoise-live-check.mjs`). Se comprobó que fallan
  reintroduciendo cada error (lista abajo).

**Medidas.** Máquina compartida de 4 núcleos; los tiempos «en calma» son
de cuando los otros agentes apenas cargaban (carga 1–3), los «cargados» con
carga 10–16.

*Calidad* (relMSE frente a 1024 muestras con otra semilla, 480 × 280, solo
píxeles de pieza; cinco pasadas y 7 × 7 es el filtro completo, `L3r1` el
de visor elegido):

| escena · spp | sin filtrar | completo | L4 7×7 | L4 5×5 | L3 7×7 | L3 5×5 | **L3 3×3** | L2 5×5 | L2 3×3 |
|---|---|---|---|---|---|---|---|---|---|
| ejemplo · 1 | 0,5123 | 0,0137 | 0,0147 | 0,0149 | 0,0195 | 0,0195 | **0,0215** | 0,0375 | 0,0393 |
| ejemplo · 2 | 0,1646 | 0,0044 | 0,0046 | 0,0045 | 0,0058 | 0,0057 | **0,0060** | 0,0108 | 0,0111 |
| ejemplo · 4 | 0,0634 | 0,0019 | 0,0019 | 0,0019 | 0,0021 | 0,0021 | **0,0021** | 0,0034 | 0,0034 |
| ejemplo · 16 | 0,0077 | 0,0007 | 0,0007 | 0,0007 | 0,0007 | 0,0007 | **0,0007** | 0,0008 | 0,0008 |
| frasco · 1 | 0,3279 | 0,0447 | 0,0457 | 0,0415 | 0,0453 | 0,0421 | **0,0371** | 0,0443 | 0,0439 |
| frasco · 2 | 0,1612 | 0,0396 | 0,0401 | 0,0354 | 0,0389 | 0,0350 | **0,0266** | 0,0311 | 0,0269 |
| frasco · 4 | 0,0739 | 0,0144 | 0,0145 | 0,0145 | 0,0151 | 0,0151 | **0,0151** | 0,0163 | 0,0163 |
| frasco · 16 | 0,0223 | 0,0067 | 0,0067 | 0,0067 | 0,0068 | 0,0068 | **0,0068** | 0,0072 | 0,0072 |
| tablero · 1 | 0,4434 | 0,0466 | 0,0482 | 0,0462 | 0,0530 | 0,0508 | **0,0468** | 0,0675 | 0,0634 |
| tablero · 2 | 0,1622 | 0,0365 | 0,0370 | 0,0346 | 0,0386 | 0,0360 | **0,0304** | 0,0421 | 0,0365 |
| tablero · 4 | 0,0812 | 0,0171 | 0,0172 | 0,0172 | 0,0176 | 0,0176 | **0,0176** | 0,0199 | 0,0199 |
| tablero · 16 | 0,0352 | 0,0073 | 0,0072 | 0,0072 | 0,0073 | 0,0073 | **0,0073** | 0,0080 | 0,0080 |

A 64 muestras los nueve quedan iguales (0,0002 / 0,0021 / 0,0033–0,0034).

*Tiempo* a 1200 × 700 (el mejor de 3–5; «4 bandas» son cuatro hilos con el
halo de cada ajuste):

| | completo, 1 hilo | completo, 4 bandas | visor, 1 hilo | visor, 4 bandas |
|---|---|---|---|---|
| ejemplo (todo pieza), en calma, 2 / 4 / 16 spp | 1,92 / 1,77 / 1,54 s | 1,04 / 1,12 / 0,82 s | 1,16 / 0,94 / 0,91 s | 0,46 / 0,33–0,40 / 0,33 s |
| frasco, en calma, 2 / 4 / 16 spp | 1,28 / 1,04 / 1,12 s | 1,06 / 0,65 / 0,82 s | 0,70 / 0,69 / 0,75 s | 0,35 / 0,31 / 0,31 s |
| ejemplo, cargado, 2 / 4 / 16 spp | 1,90 / 1,67 / 1,68 s | 1,71 / 2,16 / 1,81 s | 1,05 / 0,99 / 1,07 s | 0,63 / 0,66 / 1,04 s |
| ejemplo a 1920 × 1080, cargado, 2 / 4 spp | 6,46 / 6,39 s | 8,69 / 8,70 s | 4,56 / 3,46 s | 4,25 / 4,08 s |

Con cuatro hilos libres el de visor queda por debajo de los ~0,4 s del plan
a 1200 × 700 (0,31–0,46 s); L4 ya no (0,45–0,69 s). Las guías, cuando el
interruptor está encendido, añaden un 30 % por muestra al ejemplo y un
19 % a la escena de E5 (1200 × 700, 4 spp, 4 hilos).

*El carril del lanzador*, tomando un hilo del visor o como hilo de más
(el ejemplo a 1200 × 700, 4 hilos, filtro real, 15–20 s): en calma, 12 frente
a 16 muestras renderizadas y 5 frente a 4 imágenes limpias (*denoise* de
3,4 frente a 3,1 s, con el visor y el carril compitiendo); cargado, 8 frente a
8–9 muestras y 3–4 frente a 2–3 limpias (*denoise* 3,5–5,1 frente a
5,1–5,2 s). Indistinguibles con esta carga; se queda el que toma un hilo
del visor, que no le quita nada a un render final. Refresco observado: la
media de los huecos entre limpias es lo que cuesta un *denoise* (4,8–5,2 s
con ese coste), el máximo 6,6 s, por debajo de `2 × denoise`.

*En la web* (`tools/denoise-live-check.mjs`, swiftshader, 3 *workers*, visor
de 840 × 775, cargado): 20 imágenes limpias en 24 s, huecos de 0,72 a
1,77 s con *denoise* de 0,33 a 0,97 s; 16 de 19 dentro de
`max(2 × denoise, 0,5 s)` y 3 acotados por la pasada (una muestra de toda
la vista costaba ~1,2 s y llegó más de un *denoise* después de la limpia
anterior); ninguna limpia de una pasada vieja.

*Comprobado que fallan* reintroduciendo cada error: el lanzador con la
regla de antes (esperar dos veces el coste después de cada limpia), con el
carril sobre una entrada vieja (300 ms de retraso antes de filtrar), sin
publicar la ruidosa al apagar, sin esperar la limpia de un trabajo
terminado, sin arrancar el carril al encender, sin el albedo de las
primeras muestras, sin tomar el hilo del visor, sin acortar las pasadas,
con el filtro completo en el visor o el de visor en el final, con las
sumas aunque la imagen no sea nueva; `rt-post` con un halo corto y con la
7 × 7 en el visor; `rt_denoise_with` sin mirar el ajuste; la web sin
arrancar el siguiente *denoise* al volver, parando las pasadas mientras
filtra, sin filtrar al encender, sin quitar la limpia al apagar, sin
acortar las pasadas, con el interruptor contando como cambio de imagen,
con el albedo siempre; el lanzador de la página volviendo a publicar la
vista, sin volver a seguirla terminada, sin `version`; el comando
cambiando el borrador de la ventana de render y sin negarse en *Rápido*;
un halo de la página distinto del del motor; las guías sin aceptar huecos.
Captura: `docs/ui/denoise-live.png`.

**No encajó.**

- **Las guías se renderizan siempre a resolución completa**, también con
  el interruptor apagado: es lo que deja reducir el ruido «de la
  acumulación actual al momento» al encenderlo. Cuestan (el rayo de
  albedo de cada muestra) entre un 19 y un 30 % más por muestra (el
  ejemplo y la escena de E5 a 1200 × 700 en cuatro hilos), así que
  apagado el albedo solo se renderiza para las primeras 8 muestras
  (`LIVE_ALBEDO_SAMPLES`) y la imagen limpia de después lo hace con esas
  guías (el test lo compara con una referencia así). El plan no lo decía.
- **El refresco tiene un suelo: una muestra de todo el visor.** La pasada
  más corta es de una muestra; si una muestra de toda la vista cuesta más
  que `max(2 × denoise, 0,5 s)` − *denoise* (una vista muy grande, una
  escena lenta, swiftshader en una máquina cargada: en la comprobación del
  navegador de esta máquina, a 840 × 775, una muestra tardaba ~1,2–1,3 s y
  el *denoise* 0,3–1,0 s), no hay nada más nuevo que filtrar y la limpia llega
  una pasada después: el carril nunca espera teniendo trabajo (la
  comprobación lo verifica y cuenta esos huecos aparte). Cumplirlo también
  ahí pediría filtrar pasadas a medias (baldosas con `n` y `n + 1`
  muestras, normalizadas): queda para el líder si hace falta.
- **El carril del lanzador es un hilo** (lo que pedía el plan); el ajuste
  de visor baja de ~0,4 s en cuatro hilos por bandas, pero en un hilo
  cuesta ~0,7–1,2 s a 1200 × 700, y eso es lo que tarda en refrescarse la
  limpia en el lanzador. Darle más hilos refrescaría antes a costa de
  converger más despacio: decisión **Fable** (los datos, abajo).
  *Veredicto del responsable*: el carril se queda en un hilo (el visor
  comparte la máquina con el render, como se decidió en P3e).
- **«Sin la varianza espacial 7 × 7 a partir de 4 muestras»**: la 7 × 7
  solo se usa por debajo de 4 muestras; el ajuste de visor la deja en
  3 × 3 ahí, que medido es igual o mejor en las escenas de producto y peor
  en la superficie lisa del ejemplo a 1–2 muestras.
- **La última limpia del visor convergido** usa también el ajuste de visor
  (el contrato: lo elige el tipo de trabajo). Un *denoise* completo al
  converger daría algo más de calidad en la imagen que se queda en
  pantalla: queda anotado para el líder.
- **El protocolo del lanzador cambia** (no el RSB): la cabecera `RPX1` pasa
  de 48 a 52 bytes con el número de la imagen, `GET /api/render/<id>`
  acepta `version=`, `POST /api/render` acepta `denoise=0|1` (solo para
  vistas) y hay un `POST /api/render/<id>/denoise?on=0|1`. El RSB de una
  vista a resolución completa dice siempre `denoise` bit 0 (las guías), sea
  cual sea el modo; el interruptor va aparte.
- **Arreglado de paso**: el botón del medidor cambiaba el borrador del
  trabajo de la cola cuando la ventana de render lo estaba editando (usaba
  `setRenderSettings`); el comando nuevo cambia siempre el proyecto (con su
  test). Y cambiar *Guardar también sin reducción de ruido* o la parte
  *Render* del *denoise* ya no vuelve a empezar la imagen del visor
  (`advancedTouchesView`).
- **El medidor del lanzador no sabe lo que cuesta su *denoise*** (está en
  `GET /api/render/state`, `liveDenoise.costMs`); el de la web sí, en sus
  atributos `data-*`. Ninguno lo pinta en texto.

## U11b · Intensidad de la reducción de ruido — **Opus** (con U11) — hecha

**Qué.** Petición del usuario: elegir cuánto *denoise* se aplica. En la
ventana de render, *Avanzado ▸ Reducción de ruido* gana **Intensidad**
(0–100 %, por defecto 100): la imagen entregada es la mezcla lineal
`ruidosa × (1 − s) + limpia × s`, por canal, en luz lineal, en el motor
(`rt_post::denoise` recibe `s`; `RNDR` gana `denoise_strength` como
campo final; sin él, 100 %: *hashes* intactos). Vale para el render
final, para el visor *Completo* (la misma intensidad: un solo mando) y
para `rt --denoise-strength`. Con 0 % no se ejecuta el filtro (la imagen
es la ruidosa, byte a byte). Deshacible, guardado en `advanced` del
proyecto; proyectos anteriores abren al 100 %. Cadena `es`/`en`.

**Criterio.** Test: 50 % da exactamente la media de las dos imágenes
(bits), 0 % la ruidosa y 100 % la limpia; el *hash* `0xab15f290` con 100 %
no cambia; paridad wasm.

**Hecho.**

- **Motor** (`rt-post`): `blend(ruidosa, limpia, s)` hace en sitio
  `n × (1 − s) + c × s` por canal de color en `f32` (el alfa no se toca;
  con `s = 0,5` el producto por 0,5 es exacto y da `(n + c) / 2` bit a
  bit) y `denoise_rows_at(entrada, y0, y1, ajuste, s)` es la banda ya
  mezclada: con `s = 0` no ejecuta el filtro y devuelve las filas ruidosas
  (comprobando igualmente que la banda trae su halo), con `s = 1` es
  `denoise_rows_with`; fuera de `0..=1` se recorta y NaN es 1. Una banda a
  cualquier intensidad son exactamente esas filas de la imagen entera.
- **RSB**: `RNDR` gana `denoise_strength` (f32) al final, 56 B; sin él, 1;
  fuera de `0..=1`, el RSB no es válido. Lo escriben `rt-core` y
  `src/io/rsb.ts` byte a byte (fijaciones `example.rsb`, `e5.rsb` y
  `e5b.rsb` regeneradas: 16 bytes más cada una).
- **Un solo mando**: el lanzador lo usa en el render final (filtro
  completo, en bandas) y en el carril del visor (ajuste de visor); `rt
  --denoise-strength <S>`; wasm `rt_denoise_with(ajuste, s, …)`
  (`rt_denoise` es `s = 1`); la web, en el render (`Pool.denoise`) y en su
  carril. Con 0 % un final no se filtra (sin la bandera 64 ni la copia
  ruidosa: la imagen es la ruidosa) y ningún carril trabaja.
- **Interfaz**: *Avanzado ▸ Reducción de ruido ▸ Intensidad* en la ventana
  de render (0–100 %, pasos de 5, oculta con la reducción *Apagada*), con
  su nota; `render.advanced.denoiseStrength` en el proyecto, deshacible
  (un arrastre, una entrada), los proyectos anteriores abren al 100 % y
  `engineFieldsOf` la pasa al motor como fracción (`denoiseFraction`).
  Cadenas `es`/`en`.
- **Tests**: `rt-post` (50 % es la media bit a bit con los dos ajustes,
  0 % la ruidosa, 100 % la limpia, bandas iguales a la imagen entera, la
  mezcla a 25 % y el alfa intacto; el ejemplo con 100 % conserva
  `0xab15f290`); `rt-core` (sin el campo, 1; fuera de rango, error;
  ida y vuelta); `rt-app` (un final y un visor a 50 % son la mezcla de
  `rt`, a 0 % la ruidosa sin bandera ni carril); `rt-cli` (la opción);
  `rt-wasm` (50 % y 0 % por la exportación); y en la página: el `rt.wasm`
  real a 50 % es exactamente la media y a 0 % la ruidosa (los dos
  ajustes), los bytes del RSB, el *store* (por defecto, migración,
  recorte), el render del *pool* y el carril del visor con la intensidad
  del proyecto (y sin *denoise* a 0 %). En el navegador
  (`tools/denoise-live-check.mjs`, paso *strength*): la fila *Intensidad*
  bajo la reducción de ruido, 100 % de fábrica con su nota; a 50 % el
  visor vuelve a empezar y se vuelve a filtrar. Captura
  `docs/ui/denoise-strength.png`.

*Comprobado que fallan* reintroduciendo cada error: la mezcla con los
pesos cambiados o tocando el alfa, NaN como 0, la banda a 0 % sin
comprobar su halo, `RNDR` leyendo 0 sin el campo o escribiendo siempre 1,
el final filtrando a 0 %, el carril trabajando a 0 %, los dos ignorando la
intensidad (lanzador y `rt`), `--denoise-strength` sin llegar a la escena,
el wasm ignorándola; en la página, `engineFieldsOf` sin ella, la migración
a 0, el escritor del RSB (campo y proyección), el render del *pool*
filtrando a 0 %, el carril a 100 % siempre o trabajando a 0 %, y la
banda usando `rt_denoise` (sin intensidad) con una intensidad.

**No encajó.**

- **Cambiar la intensidad vuelve a empezar la imagen del visor**: va en el
  `RNDR` de la vista, como el resto de *Avanzado*, y el lanzador la lee de
  ahí. Que no la reiniciara (como el interruptor de U11) pediría pasarla
  aparte (`POST /api/render/<id>/denoise?strength=`); el carril de la web
  ya sabe cambiarla sin reiniciar (descarta la limpia de otra intensidad y
  filtra otra vez la última pasada). Queda para el líder si se quiere
  ajustar mirando la imagen convergida. *Veredicto del responsable*:
  aceptado, que vuelva a empezar.
- **0 % no es «el filtro con peso 0»**: no se ejecuta, así que un render a
  0 % no lleva la imagen filtrada ni la copia «-noisy» (sería la misma) y
  el medidor no dice *Ruido reducido*, aunque el interruptor del visor siga
  encendido. *Veredicto del responsable*: correcto así.

## E11 · Suavizado de bordes, de menos a más coste — **Opus** (tras U11) — hecha

**Qué.** Petición del usuario: elegir en *Ajustes ▸ Motor de renderizado*
el tipo de suavizado de bordes, ordenado de menos a más costoso. Dos
listas, cada una en ese orden, sin cifras de coste inventadas (regla 10:
el orden y una frase de ayuda, no porcentajes que nadie midió):

**Visor Rápido** (three.js): *Ninguno · MSAA 2× · MSAA 4× · MSAA 8×*
(por defecto 4×; el máximo que dé el dispositivo, y se dice cuál).

**Completo y render** (el motor), el *filtro de píxel* y el extra en
bordes, en una sola lista:
1. **Ninguno**: todas las muestras por el centro del píxel (sin *jitter*
   en el plano de imagen): bordes dentados, el más barato.
2. **Estándar**: caja de 1 px con *jitter* uniforme (lo de hoy; por
   defecto).
3. **Suave**: filtro tienda de 2 px por muestreo de importancia del
   filtro (la muestra se desplaza con la CDF inversa; peso 1).
4. **Fino**: Blackman–Harris de 3 px (el filtro habitual de producción),
   con CDF inversa tabulada en `f32` (256 entradas, calculada por un test
   de referencia, sin `exp` ni `cos` en el bucle: determinismo).
5. **Fino + bordes ×2**: lo anterior y el doble de muestras en los
   píxeles de borde (los que en su vecindad 3×3 cambian de `partId` o de
   material, o cuya profundidad salta más del 2 % de la distancia: los
   pases de rayo central ya lo dan, determinista).
6. **Fino + bordes ×4**: ídem con el cuádruple.

Motor: `RNDR` gana `pixel_filter` (0 estándar) y `edge_supersample` (1)
como campos finales; sin ellos, lo de hoy, *hashes* intactos. El
*jitter* usa las mismas dimensiones de cámara con otra deformación. Las
muestras extra de borde se reparten por pasadas (en cada pasada un píxel
de borde recibe `k` muestras seguidas, con índices de muestra propios y
consecutivos, de modo que la decisión depende solo de los pases y la
imagen es la misma con cualquier número de hilos); el *denoise* y los
pases reciben el número de muestras por píxel. El medidor del visor dice
el filtro en uso cuando no es el estándar. Un **ajuste global** (no del
proyecto), como el resto de *Motor de renderizado*; en escritorio vive en
`settings.json` del lanzador (P3e). `UI.md` y `ARCHITECTURE.md`.

**Depende de.** U11, E5b-1, X2 (pases).

**Criterio.** Test: con *Ninguno* todas las muestras de un píxel generan
el mismo rayo primario; con *Suave* y *Fino* la distribución del
desplazamiento sigue la CDF del filtro (χ² sobre 10⁶ muestras); con
bordes ×2 los píxeles de borde acaban con el doble de muestras y los
demás con las mismas, con cualquier número de hilos (bits iguales); el
ejemplo con *Estándar* conserva `0x223515c3`; paridad wasm; hoja
`out/aa-sheet.html`: un recorte 4× del canto del frasco con los seis
ajustes y el tiempo de cada uno (los tiempos van en el PR, no en la
interfaz); captura `docs/ui/settings-aa.png`.

**Hecho.**

- **Motor** (`rt_core::pixel_filter`, §5.2 quinquies de `ARCHITECTURE.md`):
  los cuatro filtros por muestreo de importancia (la muestra pesa 1 y se
  queda en su píxel), *Estándar* con los bits de siempre; Blackman–Harris
  de 3 px con su CDF inversa en una tabla `f32` de 256 puntos hecha y
  comprobada por un test (bisección sobre la integral de la ventana en
  `f64`); **muestras de borde** (`EdgeMask`, `render_tile_edges`,
  `render_tile_albedo_edges`) desde los rayos centrales de la baldosa y de
  su anillo de un píxel: pieza, material o profundidad a más del 2 % en el
  vecino 3 × 3; un píxel de borde hace `k` muestras por índice, los
  índices `s·k … s·k + k − 1` de su secuencia, y suma su media. `RNDR`
  gana `pixel_filter` y `edge_supersample` (64 B; sin ellos, la imagen de
  antes). Lo usan `rt` (`--pixel-filter`, `--edge-samples`,
  `--write-e11-example`), el lanzador (finales y visor) y el wasm (máscara
  por rectángulo de baldosa en la escena cargada).
- **Interfaz**: *Ajustes ▸ Motor de renderizado ▸ Suavizado de bordes*
  con las dos listas en su orden (`engine.fastAa`, segmento de cuatro;
  `engine.pixelFilter`, lista vertical numerada con la frase de cada
  opción), ajustes de la aplicación (en escritorio, en `settings.json`
  con los demás), cadenas `es`/`en`. **De fábrica, *Fino*** (decisión del
  líder al ver la hoja: cuesta los mismos rayos que *Estándar* y es el
  filtro de producción); un ajuste ya guardado se conserva, y el motor,
  ante un RSB sin el campo, sigue con la caja (los *hashes* intactos).
  *Rápido* sigue a 4× de fábrica y dibuja con el multimuestreo pedido
  hasta el máximo del dispositivo, que la línea dice
  (`PreviewEngine.setMsaa`, `msaa()`); *Completo* y los renders llevan el
  filtro (`setPixelFilter` de los dos motores; los gestos, sin muestras de
  borde). El medidor dice *Filtro · …* cuando no es el de fábrica
  (*Fino*; p. ej. *Filtro · Estándar*) y el
  multimuestreo de *Rápido* cuando no es 4×.
- **Tests**: la tabla frente a su referencia; *Estándar* es la posición
  tal cual y *Ninguno* el centro (todas las muestras de un píxel, el
  mismo rayo primario a través de un estenopo; con lente, el mismo punto
  de la imagen); χ² sobre 10⁶ desplazamientos en bins de 0,1 px
  (*Fino* 33,0 con 29 grados de libertad, cota 58,30; *Suave*
  9,2 con 19, cota 43,82) y la varianza del filtro a menos de un
  0,3 %; la regla de borde; la máscara igual con cualquier corte de
  baldosas; un píxel de borde a ×2 y ×4 es la media de sus `k` muestras
  (imagen y albedo) y los demás la muestra de siempre; *hash* fijado del
  ejemplo con *Fino + bordes ×2* (`0xf3787fe7`; con la elección de luz de
  E12, `0x3d8f85de`) en escalar, SSE2 y AVX2,
  con baldosas de 32 y 23, igual por el `rt.wasm` real
  (`wasm-parity.mjs`, también en CI) y por el código de la página; `rt` y
  el lanzador (final y visor) con 1, 4 y 16 hilos, los mismos bits; el
  ejemplo con *Estándar* conserva `0x223515c3` (el de entonces; con la
  elección de luz de E12, `0x8206111f`, igual con y sin E11) y todos los
  *hashes* fijados siguen; RSB (sin los campos, la caja y ninguna; más de 16, no
  válido) en `rt-core` y en `src/io/rsb.ts`; los ajustes (de fábrica,
  validación, bloque, cadenas sin cifras de coste); los dos motores de la
  página (la vista vuelve a empezar con otro filtro y no con el mismo, los
  gestos sin muestras de borde, los renders con el filtro, `status()`).
  En el navegador (`tools/settings-aa-check.mjs`): el orden de las dos
  listas, MSAA 8× limitado al máximo del dispositivo (4× con swiftshader)
  y dicho, *Ninguno* y 2× cambian solo los bordes de la vista previa
  (diferencia media 0,48 y 0,42 sobre 255, el 98,5 % y el 99,1 % de los
  píxeles iguales a 4×), *Fino + bordes ×2* en *Completo* con su palabra
  en el medidor, guardado al recargar y en español. Capturas
  `docs/ui/settings-aa.png` (el bloque, con *Fino + bordes ×2* elegido) y
  `docs/ui/meter-filter.png` (el medidor con *Filter · Standard*).

*La hoja* (`tools/aa-sheet.mjs` → `out/aa-sheet.html`, el frasco de
ejemplo a 960 × 540, 64 muestras, 4 hilos; recorte de 100 × 75 px
ampliado 4×), en esta máquina cargada (otros agentes a la vez):

| Ajuste | Rayos | Frente a *Estándar* | CPU | Reloj |
| --- | --- | --- | --- | --- |
| Ninguno | 92,79 M | 1,0000 × | 24,4 s (0,97 ×) | 83,3 s |
| Estándar | 92,80 M | 1,0000 × | 25,2 s (1,00 ×) | 88,6 s |
| Suave | 92,80 M | 1,0000 × | 26,2 s (1,04 ×) | 77,3 s |
| Fino | 92,80 M | 1,0000 × | 25,3 s (1,00 ×) | 79,2 s |
| Fino + bordes ×2 | 93,95 M | 1,0125 × | 26,5 s (1,05 ×) | 76,8 s |
| Fino + bordes ×4 | 95,10 M | 1,0248 × | 27,5 s (1,09 ×) | 87,5 s |

Las muestras extra son pocas porque los bordes lo son (en el frasco de la
hoja, un 1,2 % de los rayos de más con ×2; en el ejemplo del motor,
el 1,8 % de los píxeles son borde); el filtro no cuesta rayos, solo su
cuenta.

*Comprobado que fallan* reintroduciendo cada error: la tienda lineal, la
tabla sin interpolar o sin su reparto de puntos, el umbral de
profundidad al 20 %, la vecindad sin la columna de la derecha, *Ninguno*
con *jitter*, las `k` muestras con el mismo índice, la suma sin dividir
(imagen y albedo), la posición en pantalla sin recortar, el mismo número
para los dos ejes, `RNDR` leyendo otro filtro sin el campo o sin escribir
las muestras de borde, `rt`, el lanzador y el wasm sin máscara de bordes,
el wasm sin olvidar las máscaras al actualizar la escena (este pasaba
primero: el test solo actualizaba a una escena sin muestras de borde, que
no mira la caché; ahora también mueve la cámara con ellas, y falla); en la página,
la lista con otro número de muestras, otro filtro o multimuestreo de
fábrica, los gestos con muestras de borde, los renders sin el filtro (las
dos máquinas), un cambio de filtro que no vuelve a empezar la vista, el
estado del lanzador sin el filtro, el RSB escribiendo siempre la caja o
sin limitar las muestras de borde; y en el navegador, el destino de
multimuestreo guardado en sRGB8 (con 2× la vista previa salía más clara:
diferencia media 21/255).

**No encajó.**

- **Las muestras de borde se promedian en una sola aportación por
  índice**, en vez de que «el *denoise* y los pases reciban el número de
  muestras por píxel»: así el peso de la película, el contador de
  muestras de los anfitriones, la trama del lanzador, el pool de la web
  y la varianza que usa el *denoise* (la de la media de `k`) no cambian,
  y un píxel de borde acaba igualmente con `k` veces las muestras. Nada
  del protocolo tuvo que cambiar.
- **La tabla de Blackman–Harris no está en `u = i/255`** (desviación
  aceptada por el líder): con puntos
  equiespaciados en `u` la primera y la última celda (1/255 de las
  muestras cada una) se reparten uniformes por el medio píxel exterior,
  donde la ventana es casi cero: la varianza salía un 1,6 % mayor y el χ²
  con bins de 0,1 px no pasaba (sí con bins de igual probabilidad sobre
  los puntos de la tabla, que no ven la forma dentro de una celda). Con
  los puntos en `q(i/255)` (`2s²` y su simétrica; su inversa, dos raíces
  cuadradas) se juntan hacia los extremos: varianza a un 0,2 % y χ² en
  bins uniformes. Siguen siendo 256 valores `f32` sin trigonometría.
- **El material casi nunca decide**: en el RSB cada instancia tiene un
  material, así que donde cambia el material cambia la pieza. Se compara
  igual (el contrato lo pide; un mallado con varios materiales lo
  necesitará).
- **Los fotogramas de gesto** usan el filtro pero no las muestras de
  borde (se van antes de que se notara y cuestan rayos de su máscara).
- **El mapa de fotones de las cáusticas** de la muestra `s` sirve a las
  `k` muestras de un píxel de borde (no hay mapas de los índices `s·k + j`):
  sus cáusticas no ganan muestras propias.
- **El multimuestreo de *Rápido*** con otro número que el del lienzo
  (`antialias: true`, el que elija el navegador, normalmente 4) dibuja en
  un destino que three.js trata como la pantalla gracias a
  `isXRRenderTarget` (curva de tono y sRGB en cada material): un detalle
  interno de three.js 0.186 que la comprobación del navegador vigila (si
  una versión lo cambia, los colores salen distintos y la comprobación
  falla). Swiftshader llega a 4×: 8× no se ha visto dibujado aquí.
- **El medidor dice el filtro que se pidió al motor** con la vista en
  pantalla (el motor no lo devuelve en sus tramas); en *Rápido* dice el
  multimuestreo que three.js da.
- **Ningún byte fijado del RSB del ejemplo se movió con el nuevo valor de
  fábrica**: las fijaciones de `tests/fixtures/*.rsb` son las escenas de
  `rt-core` (sin ajustes de la interfaz) y las pruebas del proyecto al RSB
  pasan su vista sin filtro, así que `projectScene` sigue escribiendo
  `pixel_filter` 0 (`edge_supersample` 1) mientras nadie lo pida; el
  filtro de fábrica lo ponen los dos motores de la página en cada vista y
  cada render (`setPixelFilter`), y lo que cambió son las expectativas de
  sus tests (la primera vista lleva `pixel_filter` 3 y `status()` dice
  *Fino*; antes, 0 y nada).
- **El medidor nombra el filtro cuando no es el de fábrica**, no «cuando
  no es el estándar» como decía el plan: con *Fino* de fábrica, el plan
  habría dicho *Filtro · Fino* casi siempre. Decisión del líder; así el
  caso de siempre calla y *Filtro · Estándar* sale cuando alguien lo
  elige. El `status()` de los dos motores dice siempre el filtro de la
  vista a resolución completa; el medidor decide.
- **Los tiempos de la hoja** son de una máquina con otros procesos (carga
  media de unos 35): el reloj dice tanto de ellos como del ajuste; por
  eso la hoja da también el tiempo de CPU del proceso y los rayos.

## E12 · Elección de luz por punto (árbol de luces plano) — **Opus**, decisión **Fable** — hecha

**Por qué.** Diagnóstico de L6 sobre las miniaturas finales a 96 spp:
chispas blancas dispersas en el papel de los sets con una luz de *pool*
pequeña y cerca de su papel (STRIP_EDGE, BLACK_ON_BLACK,
WARM_COOL_CINEMA). Con el *pool* apagado desaparecen; con *glossy* fuera
de la clave o del *rim*, o con cáusticas, no. La causa está en el motor:
`Lights::new` elige la luz de la estimación de siguiente evento por
flujo (`flujo × hacia × alcance`), y `alcance` acota la distancia al
radio de la esfera que envuelve la escena, así que toda luz dentro de
esa esfera (todas, con el fondo barrido) tiene el mismo alcance. Un
*pool* a 0,5 m de su papel tiene (0,5/2,5)² del flujo de la clave y la
misma irradiancia donde cae: se elige el 3,9–6,5 % de las veces y, cuando
sale desde el papel, devuelve 15–25× la media. Fuegos artificiales. La
elección por flujo global es la que falla en todo renderizador cuando
una luz pequeña está cerca de una superficie; lo que la arregla es
elegir **por punto**, con la importancia de cada luz vista desde el
vértice que se sombrea. Es el caso degenerado del árbol de luces de K4
(lista plana en vez de jerarquía): K4 colgará la jerarquía de esta
misma medida.

**Decisión Fable.** Se hace en el motor (opción 1 de L6), no en los
datos (alejar el *pool* cambia la foto que ya aprobé) ni en las
miniaturas (una pinza en `thumbView` esconde el ruido a nosotros y no al
usuario). L6 publica sus miniaturas como salen; al fusionar E12 se
vuelven a renderizar los sets con chispas.

**Qué.** Importancia por punto sobre la lista plana de luces, con las
cotas de Conty Estevez y Kulla, "Importance Sampling of Many Lights with
Adaptive Tree Splitting" (HPG 2018), §4.3, sin jerarquía:
- Por cada vértice `x` de la estimación de siguiente evento, el peso de
  cada entrada es una cota superior barata de su aporte sin oclusión:
  esfera/punto, `lum(intensidad) × máscara(x) / max(d², r²)`; panel,
  `lum(radiancia) × área × orientación / max(d², área)`, con la cota de
  orientación de la referencia (ángulos `θ_o`, `θ_e`, `θ_u`), de modo que
  **ninguna luz que pueda iluminar `x` tiene probabilidad cero** (un
  panel que de canto, desde su centro, no mira a `x` pero sí desde su
  borde, cuenta); sol, `π E`; entorno, `4π² L̄`; emisor de malla, su
  flujo sobre `max(d², área)` desde su centroide. Los pesos se calculan
  en un búfer de pila (hasta 64 entradas; por encima, la CDF estática
  por flujo de hoy, la misma regla en todos los sitios: determinista).
- **Consistencia MIS**: la misma función de probabilidad, evaluada en el
  vértice del que salió el rayo BSDF, en `crossed`, `crossed_from`,
  `crossed_without_photons`, `escaped`, `escaped_environment` y
  `emitter_weight` (ganan el punto de origen; `crossed_from` con `offset`
  usa el vértice donde se muestreó el rayo, no el muro delgado). Los
  campos `pmf` por luz pasan a ser el peso base; nada queda con la
  probabilidad global en un sitio y la local en otro.
- La emisión de fotones de las cáusticas sigue eligiendo por flujo (no
  hay punto).
- Coste ≤ 3 % en las escenas de referencia (`engine:bench`); `f32`, sin
  `sin`/`exp` en el bucle, mismos píxeles con cualquier número de hilos.

**Depende de.** E5b-1 (cáusticas), E3.

**Criterio.** (1) Test de insesgo: la escena del horno blanco y una
escena con un panel y un foco a tres estrategias (solo NEE, solo BSDF,
MIS) convergen a la misma media con un error < 1 % a 4096 muestras por
píxel sobre un recorte de 8×8. (2) Test de regresión del diagnóstico:
un foco de 20 mm a 300 mm de un papel blanco más un panel de 1 m a
2,5 m; a 64 spp, la varianza por píxel (`Film::lum2`) en el parche del
papel bajo el foco cae a ≤ 1/4 de la de la elección por flujo, y en la
zona que ilumina el panel no sube más del 10 %; el test falla si se
vuelve a la elección por flujo (comprobación por mutación anotada en el
PR). (3) Un panel que desde su centro no mira al punto pero sí desde su
borde tiene probabilidad > 0 (test). (4) Con una sola luz, los *hashes*
no cambian; con varias cambian: lista de *hashes* movidos en el párrafo
del ROADMAP, repinados; paridad wasm. (5) Hoja `out/light-select-sheet.html`:
STRIP_EDGE, BLACK_ON_BLACK y WARM_COOL_CINEMA a 96 spp antes y después
(los `.rsb` del diagnóstico están en el *scratchpad* de L6), más el
ejemplo y el horno blanco; a ojo, sin chispas y la misma foto.
`ARCHITECTURE.md` (motor: elección de luz) y CHANGELOG.

**Hecho.**

- **Elección por punto** (`rt_core::light`, con la cita de Conty Estevez
  y Kulla, HPG 2018, §4.3, en el comentario del módulo; nada de otro
  renderizador). Pesos en `x`, todos en unidades de irradiancia (W/m²,
  distancias en metros; ver *Qué no encajó*): punto y foco
  `lum(I) · máscara(x) / max(d², r²)`; rectángulo y disco
  `lum(L) · A · cos θ' / max(d², A)` con la cota de orientación de la
  referencia (`θo` = 0, `θe` = π/2, `θu` del radio de la esfera que
  envuelve el panel visto desde `x`); malla emisora, lo mismo desde su
  centroide con el cono de normales de sus caras como `θo` (de dos caras
  o cerrada, `cos θ'` = 1 y cuenta una vez); sol `lum(E)`; entorno `π L̄`.
  La cota se escribe con productos escalares y raíces (`cos(a ± b)`):
  `f32`, sin `sin`/`exp`/`powf` en el bucle. `Lights::select(x)` suma los
  pesos y devuelve una `Selection` (el vértice, la suma, los ocho primeros
  pesos y si es por flujo); `sample_selected` reconstruye la distribución
  acumulada entrada a entrada, con las mismas operaciones que `build_cdf`
  y `pick`, hasta la luz que toma. De dos a `MAX_LOCAL_LIGHTS` = 64
  entradas; por encima, la CDF estática por flujo de antes en todos los
  sitios (`Lights::select_by_flux`); con una sola, también por flujo: la
  elección es cierta igual y no cuesta nada (un test la renderiza de los
  dos modos, bit a bit).
- **Consistencia MIS**: una sola función, `Lights::pmf(entrada,
  selección)`, da la probabilidad de la estimación de siguiente evento y la
  de los pesos MIS. El rayo BSDF lleva `Scattered { pdf, from }`, que
  presta la `Selection` del vértice donde se muestreó; `crossed`,
  `crossed_from`, `crossed_without_photons`, `escaped`,
  `escaped_environment` y `emitter_weight` lo reciben en lugar de la
  densidad suelta. Por paredes finas y recortes (`offset`), `from`
  sigue siendo ese vértice: los sucesos rectos no lo cambian. Los campos
  `pmf` por luz pasan a ser `base` (el peso sin distancia ni orientación)
  y `entry`.
- **Cáusticas**: la emisión de fotones sigue por flujo (su CDF propia, sin
  tocar). **Atrapasombras**: sigue por flujo, su muestra de luz y el MIS
  de su rayo BSDF (decisión Fable tras ver los datos, abajo): sus píxeles
  son bit a bit los de d1f356f.
- **Comprobaciones**: la elección por flujo a través del código
  nuevo renderiza STRIP_EDGE bit a bit igual que el binario de d1f356f; la
  misma escena con 1 y 4 hilos da el mismo PNG; con una sola luz la
  película por punto es la de flujo, bit a bit.
- **Tests** (cada uno con su mutación, que lo hace fallar):
  - `light_selection_is_unbiased_with_either_technique_and_with_both`
    (criterio 1; las estrategias son un mando de `cfg(test)`, `Techniques`):
    horno blanco MIS 1,00006, solo NEE 1,00006, solo BSDF 1 (exacto);
    suelo con panel, foco y mundo tenue MIS 1,49876, solo NEE 1,49861,
    solo BSDF 1,49950 (4096 spp, 8 × 8). Mutación: en `crossed_areas`,
    `self.pmf(light.entry, &self.select_by_flux(s.from.point))` (el lado
    BSDF con la probabilidad global) → MIS 1,719 frente a 1,499,
    falla; la misma en `escaped_environment` → MIS 1,476, falla. Las dos
    hacen fallar también `next_event_estimation_and_bsdf_rays_agree_on_every_probability`
    (cada luz, en `light::tests`: un rayo BSDF de la densidad de la muestra
    de luz recibe exactamente el ½ de la heurística de potencia).
  - `a_small_spot_close_to_its_paper_is_chosen_where_it_lands` (criterio 2:
    foco de 20 mm a 300 mm del papel, panel de 1 m a 2,5 m, 64 spp):
    varianza por píxel (`Film::lum2`) bajo el foco 0,0015 por punto frente
    a 1,653 por flujo (1/1100; se pedía ≤ 1/4); donde solo ilumina el
    panel, 0,00024 frente a 0,0043 (no sube: baja). Mutación: en
    `select`, `if true || !self.per_point || n == 0` (por flujo en todas
    partes) → las dos varianzas iguales, falla; también
    `a_light_close_to_the_point_is_chosen_there`.
  - `a_panel_seen_edge_on_keeps_a_chance` (criterio 3: un panel en cuyo
    plano, pasado su borde, está `x`; y a 1 mm por encima) y
    `the_orientation_bound_holds_for_every_point_of_the_panel` (400
    paneles y puntos al azar: la cota nunca baja del coseno desde ningún
    punto del panel). Mutación: `let sin_u = 0.0 * bound * inv_d;` (sin
    `θu`, el coseno del centro) → los dos fallan (probabilidad 0 en el
    plano; cota 0,944 < 0,962).
  - `one_light_renders_the_same_pixels_chosen_per_point_or_by_flux`
    (criterio 4: panel, emisor muestreado, foco, sol y el horno, la
    película por punto igual bit a bit a la de flujo). Mutación: el peso del
    foco por su cono interior, `let mask = if self.mask(x) >= 1.0 { 1.0 }
    else { 0.0 };` → falla. (El test de insesgo no la ve: con luces
    *glossy*, lo que la estimación de siguiente evento deja lo encuentra
    el rayo BSDF con peso 1; por eso este test.)
  - `the_orientation_bound_holds_for_every_face_of_a_one_sided_emitter`
    (casquete de una cara y puntos alrededor). Mutación: el peso de la
    malla con `(1.0, 0.0)` en lugar de su cono de normales → falla.
  - `beyond_sixty_four_lights_every_point_chooses_by_flux` (64 entradas por
    punto, 65 por flujo, en la muestra y en el MIS). Mutación:
    `(2..MAX_LOCAL_LIGHTS).contains(&entries.len())` → falla.
  - `the_shadow_catcher_keeps_choosing_its_light_by_flux` (su cobertura,
    bit a bit, con dos luces, por punto o por flujo). Mutación: `let
    selection = lights.select(x);` en el atrapasombras → falla.
  - `through_thin_walls_mis_takes_the_probabilities_of_the_vertex_the_ray_left`
    (una pared fina transparente a 140 mm bajo una esfera de luz de
    200 mm: su probabilidad es 0,166 en el suelo y 0,429 en la pared; MIS
    0,7238, solo BSDF 0,7197). Mutación: en la rama de los sucesos rectos,
    `sampled_at = selection;` (el origen pasa a la pared) → MIS 0,6853,
    falla.
  - Sin test que la vea, como debe ser: evaluar la probabilidad en el
    origen desplazado del rayo (`lights.select(next_origin)`) en lugar del
    punto de sombreado (una diferencia de 10⁻⁴ mm).
  - Las mutaciones se pasaron sobre el código final, en una copia del
    motor: cada una hace fallar sus tests (once en total), que pasan sin
    ella.
- **Coste** (≤ 3 %): medido con *valgrind* (instrucciones ejecutadas,
  deterministas e independientes de la carga de la máquina: la diferencia
  entre 6 y 2 spp a 128², un hilo, así que la preparación de la escena se
  cancela), binario de d1f356f frente al de E12, por muestra: ejemplo
  88,5 M → 93,4 M (+5,6 %; rayos +4,7 %), STRIP_EDGE 282,0 M →
  299,6 M (+6,2 %; rayos +3,3 %), BLACK_ON_BLACK 215,4 M → 227,8 M
  (+5,8 %; +1,0 %), WARM_COOL_CINEMA 245,8 M → 262,0 M (+6,6 %; +3,2 %),
  horno blanco 60,0 M → 61,4 M (+2,3 %, una entrada, por flujo). El
  tiempo de CPU (un hilo, 16 spp, el mínimo de tres en una máquina con
  carga ~40 en 4 núcleos: ±7 %, el horno da +7 % con el mismo trabajo)
  dice lo mismo: +5,6 %, +5,5 %, +2,6 %, +6,0 %. A igualdad de muestras el
  ruido baja (16 spp, dos semillas, RMS en sRGB): varianza ×0,57
  (STRIP_EDGE), ×0,25 (BLACK_ON_BLACK), ×0,69 (WARM_COOL_CINEMA), ×0,40
  (ejemplo); a igualdad de ruido, el tiempo ×0,61, ×0,27, ×0,74 y ×0,42.
  Ver *Qué no encajó*.
- **Hoja** `out/light-select-sheet.html`: STRIP_EDGE, BLACK_ON_BLACK y
  WARM_COOL_CINEMA a 96 spp antes (binario de d1f356f) y después, con
  *denoise* y la imagen sin filtrar debajo, el tiempo de cada una;
  STRIP_EDGE con una tercera columna, la referencia por flujo a 1024 spp;
  el ejemplo y el horno blanco. Probabilidad de elegir el *pool* en el
  papel bajo él (medida, 10⁵ elecciones): STRIP_EDGE 0,08 % por flujo →
  22,7 % por punto (el entorno, del 76 % al 22 %); BLACK_ON_BLACK 0,27 %
  → 48,3 %; WARM_COOL_CINEMA 0,08 % → 21,0 %.
- ***Hashes* movidos** (repinados una vez, con las unidades de
  irradiancia; los mismos en escalar, SSE2 y AVX2, en WASI escalar y
  `simd128` y en el `rt.wasm` real):
  - `PINNED_CENTRE` (`a_tile_of_the_example_has_a_pinned_hash_on_every_platform`):
    `0x7a5ae28b` → `0x8023c8cf`;
  - `PINNED_SMALL_SPHERE` (el mismo test): `0xb43bda52` → `0x8b220e08`;
  - `PINNED_EXAMPLE_4SPP` (`the_whole_example_at_four_samples_has_a_pinned_hash`,
    `asking_for_passes_changes_no_pixel_of_the_image`, la comprobación de
    la imagen sin filtrar de `the_denoised_example_has_a_pinned_hash`):
    `0x223515c3` → `0x8206111f`;
  - `PINNED_E5_HDRI_4SPP` (`the_e5_example_has_pinned_hashes_on_every_platform`):
    `0xbf8abd5b` → `0x065d16e0`;
  - `PINNED_E5_SKY_4SPP` (el mismo test): `0x2fcb098a` → `0x1c24c35c`;
  - `PINNED_E5C_SKY_4SPP` (`the_e5c_physical_sky_has_a_pinned_hash_on_every_platform`):
    `0x8bb09f6b` → `0x9f4af472`;
  - `PINNED_E5B_CAUSTICS_4SPP` (`the_e5b_caustics_have_a_pinned_hash_on_every_platform`
    y, en `rt-app`, `caustics_give_the_pinned_image_with_any_thread_count`):
    `0x55d60f2f` → `0x5419866e`;
  - `PINNED_DENOISED_EXAMPLE_4SPP` (`rt-post`,
    `the_denoised_example_has_a_pinned_hash`): `0xab15f290` → `0x9ef7c8a0`.

  No se mueven los doce de los pases de X2 (`PINNED_PASS_*`,
  `PINNED_E5_PASS_*`): no dependen de la luz. Los criterios de fases
  pendientes que citan `0x223515c3`, `0x55d60f2f` o `0xab15f290` (E9, E10,
  O1…) se escribieron antes de E12: se leen con los valores nuevos.

**Qué no encajó con el plan.**

- **Las unidades de los pesos.** El brief mezclaba flujo e irradiancia:
  punto, foco y panel en irradiancia, y sol `π E`, entorno `4π² L̄` y malla
  con su flujo `π L A` por cara, que frente a la irradiancia que dan pesan
  π, 4π y π–2π veces de más. Con los pesos del brief el *pool* de
  STRIP_EDGE se elegía el 6,4 % de las veces en su papel y la cúpula se
  llevaba el 78 % de las muestras de luz; en unidades de irradiancia, el
  22,7 % y el 22 %. Decisión Fable: unidades de irradiancia (sol `E`,
  entorno `π L̄`, malla `L · A · cos θ' / max(d², A)` desde su centroide,
  una cara). RMSE frente a la referencia de 1024 spp (STRIP_EDGE, con
  *denoise*): antes 0,0200, pesos del brief 0,0114, unidades de
  irradiancia 0,0113 (las dos en el suelo de ruido de la referencia): el
  RMSE no decide entre ellas; deciden la física y esas probabilidades.
- **El atrapasombras.** Su sombra es el cociente de la luz que llega y la
  que llegaría en **una** muestra, así que su valor converge a algo que
  depende de cómo se elige la luz, no solo de la escena. En la escena de
  `the_shadow_catcher_keeps_the_shadow_and_writes_alpha`, la cobertura de
  la sombra en (−170, 0) a 1024 spp: por flujo 0,356; por punto con los
  pesos del brief 0,207 (el test, que pide > 0,3, fallaba); por punto en
  irradiancia 0,429; la verdad, en un suelo visible con luz directa,
  0,286. Decisión Fable: E12 deja el atrapasombras por flujo (un test lo
  fija: `the_shadow_catcher_keeps_choosing_its_light_by_flux`); **un
  atrapasombras de cociente de sumas (acumular por píxel la luz que llega
  y la abierta, y dividir al resolver) es E13** y convergería a la verdad
  con cualquier elección.
- **Los números del diagnóstico.** El brief daba al *pool* un 3,9–6,5 %
  por flujo; medido en el papel bajo él, 0,08 % en STRIP_EDGE: el centro
  de la escena queda fuera del cono del foco, así que pesaba la veinteava
  parte de su flujo (la regla de L4 para un foco apuntado fuera).
- **El búfer de pila.** Escrito como pedía el brief (64 pesos por vértice
  en la pila), el perfil (*callgrind*) daba al `memset` de esos 256 bytes
  el 1,9 % de todas las instrucciones del ejemplo: la `Selection` guarda
  la suma y los ocho primeros pesos (32 bytes), y la elección rehace la
  distribución acumulada hasta la luz que toma, con las mismas operaciones
  (los mismos píxeles, bit a bit); pasado el octavo, los pesos se vuelven
  a calcular. El límite de 64 entradas se queda como regla.
- **El coste por muestra pasa del 3 %**: +5,6 a +6,6 % de instrucciones en
  las escenas de referencia con varias luces (arriba). El perfil
  (*callgrind*, ejemplo) lo reparte entre trabajo útil de más (las
  muestras de luz caen más a menudo en una luz que llega al punto: +17 %
  de rayos de sombra y +23 % de densidades BSDF para el MIS) y la propia
  cota (por panel y vértice, tres raíces y dos divisiones) con su
  fontanería. Se probaron y midieron seis versiones (+8,7 % la primera);
  la que queda no copia ni rellena nada del tamaño de la lista y elige por
  flujo, sin coste, con una sola entrada. Como el ruido baja más de lo
  que sube el coste, a igualdad de ruido sale entre 1,4 y 3,8 veces más
  rápido; el 3 % no se cumple: queda anotado.
- **No hay `engine:bench`** en `package.json`, y `rt-bench` mide el
  rendimiento de la BVH, no el integrador: el coste se midió con `rt` (ver
  arriba).
- **La cota de la referencia lleva también el coseno del receptor**
  (`|cos θ'i|`, con la normal del punto); el brief no lo pide y la API de
  la elección solo conoce el punto: queda para K4.
- **Las estrategias de los tests** (`Techniques`, solo en `cfg(test)`):
  *solo NEE* es válida sin caminos especulares hacia la luz; el test de
  paredes finas compara MIS con *solo BSDF*.

## E13 · Estimación en variedad (MNEE) para la luz a través de vidrio — **Opus** (tras E9)

**Por qué.** Los rayos de sombra se paran en una superficie refractante
(diseño de E5): un líquido dentro de una botella, o cualquier cosa
detrás de un cristal, solo recibe la luz de los focos por caminos que
refractan por azar o por el mapa de fotones de E5b-1 (que *Automático*
no enciende para un softbox). E9b lo salva con la regla de pared fina
(aproximación explícita, sesgo medido). Lo correcto es **estimación de
siguiente evento en variedad** (Hanika, Droske, Fascione, "Manifold Next
Event Estimation", EGSR 2015): desde el vértice, buscar por iteración
de Newton el camino de refracción que llega al punto de luz a través de
una o dos superficies lisas, y usarlo como conexión con su jacobiano.

**Qué.** MNEE en `rt-core` para hasta dos refracciones lisas (vidrio
fino y botella con líquido), con el *half-vector* como variable, 8
iteraciones máximo, `f32`, determinista; MIS con la continuación BSDF;
la regla de pared fina de E9b se retira cuando MNEE la cubre (test de
que el resultado converge al de referencia). Coste ≤ 1,3× en la botella
de E5.

**Criterio.** Botella de leche de E9b a 64 spp sin grano y dentro del
3 % de la referencia; cáusticas de un vaso de agua bajo un foco
pequeño con MNEE vs mapa de fotones; *hashes* repinados; paridad wasm.

## E9 · Materiales hacia el realismo: energía, medios dispersores, dispersión — **Opus** — hecha (a, b y c)

**Qué.** Tres partes, en este orden, cada una con su commit y sus
*hashes*; (c) solo si (a) y (b) están en verde.

**(a) Compensación de energía del GGX** (Kulla y Conty 2017, «Revisiting
Physically Based Shading at Imageworks»; Turquin 2019, «Practical
multiple scattering compensation for microfacet models»). Tabla propia
`E(μ, α)` y `E_avg(α)` de la reflectancia direccional del GGX con
Fresnel 1, integrada por nosotros (Monte Carlo con semilla fija, 32 × 32
o lo que la prueba de error pida, < 0,5 % frente a una integración de
referencia a más muestras; ni un número copiado), para conductores
(`F_avg` del color), dieléctricos (especular y refracción, Walter) y el
barniz. El lobo añadido es `(1 − E(μo)) (1 − E(μi)) / (π (1 − E_avg))`
escalado por el Fresnel medio, muestreado como coseno y con su PDF en el
MIS. Con rugosidad 0 la imagen no cambia (test de píxeles sobre el
ejemplo: *hash* `0x223515c3` intacto si el ejemplo no tiene rugosidad
> 0 donde cuente; si cambia, se fija el nuevo y se dice cuánto). Prueba
de furnace: una esfera de metal blanco rugoso en un entorno uniforme sale
blanca a ±1 % con cualquier rugosidad (hoy sale gris: medirlo y dejarlo
en el PR).

**(b) Medios dispersores dentro de sólidos.** Material con campos nuevos
(claves estables, al final del registro RSB `MATL` y del proyecto):
distancia libre media `scatter_mm` (0: ninguno), color de dispersión
(albedo del medio por canal) y anisotropía `g` (Henyey–Greenstein).
Dentro de un sólido con `scatter_mm > 0` el camino hace un paseo
aleatorio (distancia por `−ln(ξ)·mfp`, evento de dispersión HG, Beer por
canal con `σ_t` por canal elegido con *spectral MIS* de un canal por
camino, como Pixar 2016 «Practical and Controllable Subsurface
Scattering for Production Path Tracing», Chiang, Kulla y Fajardo:
escrito desde el artículo), estimación del siguiente evento en cada
evento del medio a través de la frontera dieléctrica (la transmitancia
recta de la frontera, sin refracción, como hace su artículo), y salida
por la frontera con el Fresnel de la superficie. Las dimensiones
aleatorias del medio son dimensiones *hash* más allá de la tabla Sobol
(como los recortes), para que la imagen de una escena sin medios no
cambie en ni un bit. Mapa de fotones: un medio es receptor; no se
lanzan fotones dentro (anotar). En el visor Rápido, una aproximación:
el color del medio como difuso translúcido (lo que three.js dé sin
dependencias nuevas); se dice en la ayuda. Recetas de catálogo nuevas
(se añade, no se renombra): plástico translúcido (HDPE blanco, PP
natural), acrílico esmerilado, cera, jabón de glicerina, leche, zumo
(naranja, manzana), crema. Interfaz: en el inspector de material, bajo
*Transmisión*: *Dispersión interna* (mm), *Color de dispersión*,
*Dirección* (−0,9 a 0,9, con ayuda «hacia delante / hacia atrás»).
Hoja de contactos `out/sss-sheet.html` con esferas y un frasco: con y
sin medio, 64 y 1024 muestras.

**(c) Dispersión cromática** (solo vidrio sólido): campo `abbe` (0:
ninguna; típico 30–70), IOR por longitud de onda con Cauchy a partir de
`ior` y `abbe`; una longitud de onda por camino muestreada al primer
vidrio dispersivo (*hero wavelength* con tres longitudes, una por canal,
Wilkie et al. 2014, o una sola con *spectral MIS* si sale más simple), y
el resto del camino en esa longitud de onda; los materiales sin `abbe`
no cambian. Receta: cristal de perfume con Abbe 40. Prueba: un prisma
bajo un foco pequeño separa los colores en el suelo (test de píxeles por
regiones).

**Depende de.** E5, E5b-1.

**Criterio.** Furnace de (a) a ±1 %; (b): una esfera con medio y albedo 1
en un entorno uniforme no crea ni pierde energía (±2 %); el ejemplo sin
medios conserva `0x223515c3` (o el nuevo de (a)); las cáusticas conservan
`0x55d60f2f` salvo que (a) toque el vidrio rugoso (decir cuánto);
determinismo con 1, 4 y 16 hilos y en wasm; `clippy -D warnings`;
tiempos antes y después en el PR (el medio cuesta lo que cuesta, se
mide); la hoja de contactos con el veredicto visual de Fable antes de
cerrar.

**Hecho (a) · compensación de energía del GGX** (commit `d736374`).

- **Tablas propias** (`rt_core::bsdf::energy`, datos en
  `bsdf/energy_table.rs`): `E(μ, α)` del GGX con Fresnel 1, el momento de
  Schlick `E5(μ, α) = ∫(1 − wo·h)⁵ G2/G1` (para que
  `E_s = f0 E + (f90 − f0) E5` sin otra tabla) y el albedo de potencia de
  la parte clara `E_t(μ, α, η)` entrando y saliendo; integradas por nuestro
  Monte Carlo con semilla fija (`0xe9ae9a`): por nodo, la semirrecta por
  VNDF (Heitz 2018) en una rejilla *jittered* de 64 × 64 con un flujo PCG
  propio. Nodos en `μ = (i/31)²`, `r = j/31` (`α = r²`) y 17 índices
  uniformes en `(ior − 1)/(ior + 1)` hasta 3; 16 bits por valor (~70 kB).
  `E_avg` es la integral de la propia tabla. Error frente a una
  integración con 16 veces las muestras, en puntos entre nodos: 0,11 % el
  peor (cota del test 0,5 % para `μ ≥ 0,05`; con 24 × 24 nodos no se
  cumplía). Un test regenera una muestra de nodos bit a bit
  (`REPACK_WRITE_TABLES=1` las reescribe enteras en segundos).
- **Reflexión** (metal, especular del dieléctrico opaco y barniz): el
  lóbulo añadido de Kulla y Conty (2017),
  `F_ms (1 − E(μo)) (1 − E(μi)) / (π (1 − E_avg))` con
  `F_ms = F_avg² E_avg / (1 − F_avg (1 − E_avg))` y el `F_avg` de Schlick
  `f0 + (f90 − f0)/21`; muestreado por el coseno, con su densidad en la
  mezcla del MIS. **Refracción** (la parte clara): dividida por su propio
  albedo de potencia `E_t(μo, α, η)` (Turquin 2019). Por debajo de
  `α = 0,002` no hay compensación: la rugosidad 0 conserva todos sus bits
  (test).
- **(a2) capa difusa bajo el especular** (petición de la dirección, regla 11, tras ver (a)):
  peso `(1 − E_s(μo)) (1 − E_s(μi)) / (1 − E_s,avg)` (Kulla y Conty), con
  `E_s` el albedo direccional del especular dieléctrico (su dispersión
  simple con Schlick más su lóbulo añadido; la curva de Schlick misma si es
  liso), y bajo el barniz la normalización conjunta de las dos capas (abajo).
- ***Furnace*** (esfera blanca en un mundo uniforme de radiancia 1, media
  de sus píxeles), antes → después, rugosidad 0,2 / 0,5 / 0,8 / 1,0:
  metal 0,998 / 0,895 / 0,574 / 0,356 → 1,000 / 1,001 / 0,999 / 0,999;
  vidrio claro (ior 1,5) 0,994 / 0,828 / 0,515 / 0,361 → 0,997 / 0,998 /
  1,004 / 0,995 (16 × 16 px × 256 spp en el test; 0,999 / 1,001 / 1,001 /
  1,000 a 32 × 32 × 1024). Plástico blanco (base 1, ior 1,5), rugosidad
  0 / 0,2 / 0,5 / 0,8 / 1,0: desnudo 0,918 / 0,918 / 0,914 / 0,900 / 0,891
  → 1,000 / 1,000 / 1,000 / 1,000 / 1,001; con barniz 1 liso 0,860…0,833 →
  0,998…0,997; con barniz 1 de rugosidad 0,3, 0,860…0,833 → 0,999…0,998.
  Los tests piden ±1 %.
- ***Hashes*** que se mueven (todo lóbulo rugoso cambia la mezcla de
  muestreo y la capa difusa gana lo que perdía), con la luminancia lineal
  media antes → después, para que L6 la vuelva a medir:

  | Imagen | Antes de E9 | Después de (a) + (a2) | Luminancia media |
  | --- | --- | --- | --- |
  | Ejemplo, 4 spp (`PINNED_EXAMPLE_4SPP`) | `0x223515c3` | `0x51ade97c` | +15,6 % |
  | E5, HDRI (`PINNED_E5_HDRI_4SPP`) | `0xbf8abd5b` | `0x284f75e1` | +13,6 % |
  | E5, cielo clásico (`PINNED_E5_SKY_4SPP`) | `0x2fcb098a` | `0x96f673b1` | — |
  | E5c, cielo físico (`PINNED_E5C_SKY_4SPP`) | `0x8bb09f6b` | `0x83410b6e` | +13,2 % |
  | E5b-1, cáusticas (`PINNED_E5B_CAUSTICS_4SPP`) | `0x55d60f2f` | `0x8bff5f8a` | +13,6 % |
  | Ejemplo con *denoise* (`PINNED_DENOISED_EXAMPLE_4SPP`) | `0xab15f290` | `0x7483f82e` | — |
  | Teselas del ejemplo (`PINNED_CENTRE`, `PINNED_SMALL_SPHERE`) | `0x7a5ae28b`, `0xb43bda52` | `0x023525f2`, `0x40ae1775` | — |

  Casi todo es la luz difusa que se perdía (y sus interreflexiones). Los
  seis *hashes* de pases de X2 no se mueven. Con solo (a), los cambios eran
  de +0,40 % (ejemplo), +0,51 % (E5) y +0,65 % (E5c).

**No encajó con el plan en (a), y por qué está bien así.**

- **Muestreo del vidrio rugoso.** Con el factor de Turquin, el muestreo
  antiguo de la parte clara (reflejar o refractar según el Fresnel
  macroscópico, como mucho 0,99) daba pesos de 25 a 60 a las microfacetas
  en reflexión total dentro de un sólido: destellos suficientes para leer
  1,046 a 256 spp. El vidrio rugoso (compensado) muestrea ahora primero la
  microfaceta y refleja con su propio Fresnel (Walter 2007, §5.3, la
  elección con un número *hash* de la muestra 2-D); el liso conserva el
  procedimiento de antes y sus bits.
- **(a2), dos desviaciones de la receta literal.** (1) Bajo el barniz,
  normalizar cada lóbulo por `1/(1 − E_c,avg)` se pasaba un +1,5 %: un
  lóbulo especular bajo el barniz no redistribuye la luz, así que solo
  lleva `(1 − E_c(μo))(1 − E_c(μi))`, sin normalizar. (2) La capa difusa
  bajo las dos capas necesita su normalización **conjunta**
  `1/∫(1 − E_s)(1 − E_c) 2μ dμ`: el producto de las dos normalizaciones
  por separado salía un +1,4 % brillante porque las dos transmisiones caen
  juntas en rasante. Se calcula por BSDF con Gauss–Legendre de 8 puntos
  (exacto para curvas de Schlick), solo en difusos con barniz. Las dos
  son lo que pide la conservación de energía, y el *furnace* con barniz lo
  comprueba a ±1 %.
- **La rugosidad 0 sí cambia en el plástico**, y debe: `E_s(μ)` con
  `α → 0` es `F(μ)`, así que la forma es la de antes, pero la
  normalización `1/(1 − E_s,avg)` es nueva: `1/(1 − F_avg)` = × 1,094 en
  el difuso con ior 1,5 (exactamente el 8,6 % que perdía; plástico blanco
  liso 0,918 → 1,000). El suelo (Lambert, `f0 = 0`) y las bases con ior 1
  conservan todos sus bits. El criterio de la fase («con rugosidad 0 la
  imagen no cambia») vale para el metal y el vidrio, no para el difuso.
- Los lóbulos **anisótropos** usan las tablas isótropas con el ancho
  `√(αx αy)` (aproximación); las **paredes finas** no se compensan; el
  lóbulo añadido del barniz no atenúa las capas de debajo (su `F_avg` es
  0,08: el término queda por debajo del 0,6 %); los fotones de E5b-1
  usan el mismo muestreo de la BSDF con el factor de Turquin del lado del
  fotón (no recíproco, como acepta el artículo; los *casters* tienen
  rugosidad ≤ 0,25, donde el factor es casi 1).
- Los criterios de U11 y E10 citan `0xab15f290` y `0x223515c3`: con E9a
  son `0x7483f82e` y `0x51ade97c` (no se toca su texto).

**Mutaciones de (a)** (cada una rompe a propósito una línea; entre
paréntesis, los tests que fallan): quitar el lóbulo añadido del especular
en `eval` (`rough_white_metal_reflects_everything_once_compensated`,
`rough_metal_and_glass_come_out_white_in_a_furnace`,
`rough_metal_never_gains_energy`); quitar su peso de la densidad de la
mezcla (`no_material_reflects_more_than_it_receives` y otros dos); `F_ms` →
`F_avg` (`smooth_surfaces_have_no_compensation_and_rough_ones_do`); quitar
el factor de Turquin (`rough_glass_never_gains_energy`, el *furnace*);
reflejar el vidrio rugoso con el Fresnel macroscópico (el *furnace* del
vidrio); `MIN_COMPENSATED_ALPHA` = 0 (`smooth_surfaces_…`); buscar en `μ` en
lugar de `√μ` (`energy_tables_are_what_the_generator_writes`,
`the_energy_tables_are_within_half_a_percent_of_a_finer_integration`);
quitar el lóbulo añadido del barniz (la primera vez no lo vio nadie: se
añadió `the_extra_lobes_are_kulla_and_contys_shape_times_their_fresnel`);
(a2) quitar la normalización de la capa difusa
(`white_plastic_comes_out_white_in_a_furnace`), quitar el lóbulo añadido
del albedo de la capa (`layers_pass_what_they_do_not_reflect`), normalizar
sin el paso del barniz o atenuar con `under` en lugar de `passes`, y la
media lisa a 0 (los dos anteriores). Sin test, y no es un sesgo: el peso
del lóbulo añadido en la estimación de reflectancia que elige el lóbulo a
muestrear (solo cambia la varianza).

**Hecho (b) · medios dispersores dentro de sólidos.**

- **Campos** (claves estables, al final): `MATL` pasa a 100 B con, en este
  orden, `bevel_mm` (byte 72, reservado para E6: se lee y se conserva, la
  interfaz escribe 0), `scatter_mm`, `scatter_color[3]`, `scatter_g` y
  `abbe` (que se escribe ya y renderizará E9c); los registros de 56, 60 y
  72 B se leen como antes. En el proyecto, `scatterMm`, `scatterColor` y
  `scatterG` de la familia GLASS; un proyecto anterior se abre con los
  mismos parámetros que tenía y sin medio.
- **El medio** (`rt_core::integrator::medium`): un sólido claro
  (transmisión, no pared fina, no metal, no emisor, `ior ≥ 1,0001`) con
  `scatter_mm > 0`; `σt = 1/scatter_mm`, `σs = albedo σt` y
  `σa = (1 − albedo) σt` por canal, más la absorción de `absorption_mm`
  y `base_color` (que hace `σt` distinto por canal); `g` recortado a ±0,9.
- **El paseo** (Chiang, Kutz y Burley, «Practical and Controllable
  Subsurface Scattering for Production Path Tracing», SIGGRAPH 2016 Talks,
  escrito desde la charla): distancias `−ln(ξ)/σt` de un canal *héroe*
  elegido una vez por paseo, con el MIS espectral de una muestra sobre los
  tres canales (Wilkie et al., EGSR 2014) llevado como cocientes
  renormalizados en cada paso (un paseo largo no desborda); fase de
  Henyey–Greenstein por su inversa; desde el evento 33, ruleta rusa sobre
  el peso del propio paseo (supervivencia `max(throughput)/max(throughput
  al entrar)`, entre 0,05 y 1: lo que el paseo ha perdido desde que entró;
  decisión de la dirección con las medidas de abajo).
  **Sin NEE dentro.** Un paseo que no dispersa cruza como el vidrio claro
  (la BSDF de la superficie lo toma). Uno que dispersó, al llegar a la
  frontera desde dentro, se refleja hacia dentro (espejo respecto de la
  normal geométrica) con la probabilidad del Fresnel de salida —1 más allá
  del ángulo crítico— o sale: el vértice de salida es un vértice de
  superficie con un lóbulo de transmisión lambertiano de albedo `η²`
  (`Bsdf::medium_exit`; la radiancia dentro de un sólido es `η²` la de
  fuera, y el camino que entró lleva el `1/η²`), donde el integrador
  muestrea una luz con su MIS y sigue por el coseno. La rugosidad de la
  frontera no cambia el lóbulo. **Tope**: 1024 pasos por camino (eventos y
  reflexiones en la frontera); pasado, el paseo va recto a la frontera
  conservando todo salvo la absorción y sale por el lóbulo sin reflejarse
  (si no, la reflexión total lo atraparía en un sólido curvo). Los medios
  no cuentan contra `RNDR.max_depth`. El vértice de salida no ve recortes
  ni el suelo, y el último tramo del paseo no recoge luces cruzadas.
- **Paredes finas alrededor de un medio** (decisión de la dirección; una
  **aproximación**): un rayo de sombra desde un vértice de salida, y solo
  desde uno, atraviesa una pared de vidrio liso (rugosidad ≤ 0,05, del
  todo clara, sin barniz ni medio propio) donde la luz que la cruzara
  refractando saldría a menos de 5 mm de su entrada por una cara a menos de
  15° de la primera, como si las dos refracciones se anularan: lleva el
  producto de las transmitancias de Fresnel de entrada y de salida y la
  absorción de la pared en ese tramo, y sigue en su dirección; una pared
  gruesa, rugosa o con barniz lo sigue parando. Para que no cuente dos veces, una muestra de la
  BSDF del vértice de salida que entra y sale de una pared que el rayo de
  sombra cruzaría (la misma prueba, sobre el rayo recto) es un suceso recto
  de ese vértice para el MIS (conserva su densidad y su distancia). Con
  cáusticas, lo que una luz de fotones manda a través de una pared es del
  mapa, como a través de cualquier *caster*. Sesgo medido: una losa de
  leche bajo una placa de vidrio de 3 mm iluminada por un panel, −2,0 %
  frente al trazador sin la regla a 2048 spp (con fotones, −1,7 %), con
  4,8 veces menos varianza a 32 spp. En el frasco de leche, el ruido de
  píxel (desviación frente a sus vecinos, relativa) baja de 0,112 (la
  conexión recta) a 0,081 a 64 spp; una esfera de leche sin vidrio da 0,070
  (era 0,131) y el suelo 0,03. La solución exacta (NEE de variedades) queda
  para E13.
- **Números aleatorios**: dimensiones *hash* más allá de la tabla Sobol
  (`sampler::medium_dim(rebote, paso)`, 8 por paso, desde `1 << 21`;
  `1 << 23` queda para E9c), así que una escena sin medios no cambia ni un
  bit: los ocho *hashes* de antes y los de pases siguen iguales.
- **Cáusticas**: un medio es receptor (`caustics::is_caster`); guarda
  fotones en su superficie y ninguno entra. El vértice de salida recoge
  los fotones del **exterior** de su superficie, hacia donde mira su
  lóbulo (lo encontró la hoja: ver abajo).
- **Rápido** (`src/render/materials.ts`): un difuso translúcido, el color
  con que vuelve la luz por la similitud de van de Hulst
  (`(1 − s)(1 − 0,139 s)/(1 + 1,17 s)`, `s = √(1 − albedo)`), y una
  transmisión que baja con lo denso que es el medio para el tamaño de la
  pieza; la ayuda de *Dispersión interna* dice que Rápido lo aproxima.
- **Recetas** (nueve, claves nuevas; 86 en total): `HDPE_WHITE` (mfp
  0,08 mm, albedo 0,996 / 0,995 / 0,99, rugosidad 0,35, ior 1,54),
  `PP_NATURAL` (0,6; 0,995 / 0,994 / 0,988; 0,3; 1,49), `PMMA_FROST` (4;
  0,999; g 0,3; 0,45; 1,49), `WAX` (0,35; 0,997 / 0,993 / 0,975; 0,4;
  1,44), `SOAP_GLYCERIN` (12; 0,995 / 0,99 / 0,98; g 0,4; ámbar con
  absorción a 60 mm; 0,12; 1,47), `MILK` (0,31; 0,9996 / 0,9993 / 0,9963;
  1,35) y `CREAM` (0,19; 0,99997 / 0,9995 / 0,9949; 0,25; 1,4) de los
  coeficientes reducidos medidos de Jensen et al. (SIGGRAPH 2001, leche
  entera y nata), `JUICE_ORANGE` (0,9; 0,997 / 0,94 / 0,55; 1,35) y
  `JUICE_APPLE` (40; 1; g 0,5; ámbar con absorción a 25 mm; 1,35); las de
  plástico en *Plásticos* y el resto en *Otros*; los líquidos no se
  desgastan. Las demás, a ojo.
- **Interfaz**: bajo *Paredes* del vidrio, *Dispersión interna* (mm),
  *Color de dispersión* y *Dirección* (−0,9 a 0,9, «hacia delante / hacia
  atrás»), con su ayuda en los dos idiomas; mutación del *store*
  deshacible como cualquier parámetro.
- **Pruebas** (todas con su mutación, abajo): el *furnace* del medio
  blanco (mfp 0,1 a 60 mm, g −0,4 a 0,4, frontera lisa y rugosa): entre
  0,998 y 1,008 (antes, con la conexión recta, 0,983–1,015); un medio que
  solo absorbe da Beer–Lambert en cada canal (el MIS espectral) a 2 %; un
  semiespacio gris de dispersión isótropa bajo una frontera de índice
  1,001 da el albedo plano de Chandrasekhar para luz normal
  (`1 − H(1) √(1 − a)`, su función H resuelta en el test): 0,4118 frente a
  0,4149 con albedo 0,9 y 0,7503 frente a 0,7527 con 0,99 (cota 2 %; es la
  referencia absoluta de la ruleta y del muestreo con albedo entre 0 y 1);
  un emisor pequeño visto a través de una losa de una centésima de mfp
  sigue nítido y conserva lo que el vidrio claro deja (0,918 frente a
  0,914): lo que no dispersa sale refractando, no por el lóbulo;
  un medio gris (albedo 0,9 y 0,97) en un mundo uniforme da lo mismo con el
  lóbulo que con la frontera exacta (0,2787 frente a 0,2776 y 0,4501
  frente a 0,4496, cota 2 %: ahí el lóbulo es exacto y solo cuenta cuánto
  refleja la frontera hacia dentro, que es lo que el *furnace* blanco no
  ve); la leche bajo un panel lateral: el lóbulo a 256 spp contra la frontera
  exacta (el paseo sale refractando por la superficie real; 4096 spp
  distintas) da 2,881 frente a 2,790 (+3,3 %, cota 6 %) y su peor píxel
  iluminado está al 0,971; la losa de leche bajo la placa de vidrio (la
  regla de las paredes, arriba); un medio detrás de una bola de vidrio
  recibe por fotones la misma luz que el trazador (−4,0 %, cota 10 %); la dispersión hacia delante deja pasar más luz por una losa
  que la isótropa y esta más que hacia atrás (0,820 / 0,643 / 0,511); un
  emisor que no es luz se encuentra tras un paseo; la fase es una densidad
  y sus muestras la siguen; un medio es su mfp, su albedo y su absorción;
  los medios son receptores, sin medio de Beer–Lambert y con sus propias
  dimensiones; la hoja de contactos tiene las nueve recetas y sus escenas
  son válidas; del lado de la interfaz, las recetas, los parámetros y sus
  cadenas, el registro de 100 B, los proyectos de antes, el Rápido, que
  `sss_sheet.rs` repite exactamente los números del catálogo y que el
  `rt.wasm` real da el *hash* fijado.
- **Paridad**: la escena de E9 (la de E5 con un medio de cera cálida, mfp
  4 mm y absorción en su esfera de vidrio rugoso) tiene su *hash*
  **`0xc6c9036e`** (`PINNED_E9_MEDIA_4SPP`, `rt --write-e9-example`,
  `tests/fixtures/e9.rsb`), igual en todas las rutas SIMD, en WASI escalar
  y `simd128`, con 1, 4 y 16 hilos, en el `rt.wasm` real
  (`tools/wasm-parity.mjs`, también en CI) y por el código de la página.
- **Coste** (la hoja, 240 × 180, cuatro hilos en una máquina compartida
  con carga ~40; los rayos por muestra de cámara no dependen de la carga),
  medio frente a claro, 64 / 256 spp: esferas 22,9 frente a 4,0 rayos
  (5,7 ×; tiempo 169,5 / 28,0 s = 6,1 × y 578,9 / 97,3 s = 5,9 ×); frasco
  de leche 9,3 frente a 3,7 (2,5 ×; 56,2 / 21,4 s = 2,6 × y 236,1 / 69,4 s
  = 3,4 ×); frasco de zumo 6,2 frente a 3,7 (1,7 ×; 39,3 / 22,1 s = 1,8 × y
  157,3 / 85,4 s = 1,8 ×); el de leche con fotones, 10,1 rayos (75,2 y
  270,3 s). Con la conexión recta eran 15 ×, 7,6 × y 5,8 × en tiempo a
  64 spp. Objetivo de la dirección para el frasco de leche, ≤ 6 ×: cumplido.
- **Hoja de contactos** `out/sss-sheet.html` (`rt --sss-sheet out`):
  las nueve recetas en esferas y el frasco de E5 lleno de leche y de zumo
  de naranja, con y sin medio, y el de leche con fotones, a 64 y 256
  muestras, con el tiempo y los rayos por muestra de cámara.

**Mutaciones de (b)**: albedo del lóbulo de salida `η²` → 1 (el
*furnace*: 0,47); salir siempre sin reflejarse hacia dentro, o el Fresnel
de salida sin reflexión total (los dos, invisibles al *furnace* blanco:
`an_absorbing_medium_in_a_uniform_world_is_what_the_exact_boundary_gives`, 0,460 y 0,442 frente a 0,278); la fase al revés (`the_phase_function_is_a_density…`,
`forward_scattering_sends_the_light_onwards`); las dimensiones del medio
dentro de la tabla Sobol (`media_are_receivers_with_their_own_random_numbers`);
un medio como *caster* (el mismo); Beer–Lambert además del paseo
(`a_medium_that_only_absorbs_is_beer_lambert_in_every_channel`); quitar la
división de la ruleta (`a_grey_half_space_reflects_chandrasekhars_plane_albedo`: 0,676 frente a 0,753 con albedo 0,99); un paseo que topa sin salir se pierde
(el *furnace*, mfp 0,1); canal héroe fijo (Beer–Lambert); distancias con
`2 σt` (Beer–Lambert, el *furnace*); el lóbulo sin `1/π` o su densidad del
lado equivocado (el *furnace*, la leche); la BSDF de la superficie en el
vértice de salida además de la decisión del paseo (el *furnace*); un paseo
sin eventos saliendo por el lóbulo (`a_sparse_medium_lets_what_does_not_scatter_through_straight`: 0,051 frente a 0,914); recoger los fotones del
lado de dentro (`a_medium_behind_glass_gathers_its_photons_where_its_walks_leave`);
sin el suceso recto del MIS, sin la regla de las paredes, o sin dejar al
mapa la luz de fotones que cruza una pared
(`a_medium_sees_the_lights_through_a_thin_glass_wall`). Sin test, y no es
un sesgo: quitar el MIS espectral (un solo canal héroe con `f/p_héroe` es
insesgado; el MIS solo baja la varianza). Del lado de la interfaz: el orden
de los campos del registro, `scatterG` sin recortar, la fórmula de van de
Hulst (el test la fija ahora: antes solo comprobaba los extremos), quitar
la claridad del Rápido, el desgaste de la leche, la ayuda de *Dirección* y
un número de las recetas de la hoja distinto del catálogo: todos fallan.

**No encajó con el plan en (b).**

- **El estimador del contrato** (NEE en cada evento a través de la
  frontera con su transmitancia recta) se hizo primero y la dirección lo
  rechazó tras ver la hoja: desde el lado de la cámara, una conexión recta
  a una luz a más del ángulo crítico de la normal local (47,8° con ior
  1,35; 41,8° a través de la pared de vidrio) no lleva nada, así que casi
  todos los paseos de delante no ven la luz y la traen los pocos que llegan
  al lado iluminado: en un píxel de leche bajo un panel lateral, mediana
  0,011, media 0,098, y el 1 % de las muestras más brillantes llevaba el
  23 % de la media. A 64 spp, 240 × 180 y cuatro hilos costaba 15 veces lo
  claro en las esferas, 7,6 en el frasco de leche y 5,8 en el de zumo.
  Medido después contra el camino exacto (el paseo sale refractando por
  la frontera real, sin lóbulo ni conexión), además era un 25 % oscuro en
  la esfera de leche; el lóbulo de salida queda un 3,5 % por encima. Se
  descartaron con él sus tres decisiones: llevar **radiancia** por cada
  cruce, `(1 − F(cos, η))/η²` lejos → cerca con reflexión total (la
  versión en flujo leía 0,88–0,95 en el *furnace*); en una frontera
  **rugosa**, el peso de una muestra de la BSDF en lugar de la fórmula
  lisa (que leía 0,89), y la **ruleta con `η²`** (`max(throughput)·η²`,
  para que el `1/η²` de entrar no matara la mitad de los paseos en el
  primer evento). El tope de 1024 se queda (256 perdían un 3 % a 300 mfp
  de ancho).
- **La ruleta**: el plan de la dirección era ruleta sobre el *throughput*; el
  camino entra en el sólido con `1/η²`, así que la primera ruleta (evento
  33) mataba alrededor de la mitad de los paseos que llegaban ahí. Medido
  (eficiencia `1/(varianza relativa × rayos)`, 12 × 12 px, dos mitades de
  128 spp): leche 2,71 sobre el *throughput*, 4,30 con `× η²`, 4,29 sobre
  el peso del propio paseo, 4,14 sin ruleta; HDPE 4,40, 5,65, 5,37 y 2,05.
  La dirección eligió el peso del propio paseo (la versión con principio de
  `× η²`).
- **La cita**: el contrato dice «Pixar 2016, Chiang, Kulla y Fajardo»; la
  charla de ese título es de Matt Jen-Yuan Chiang, Peter Kutz y Brent
  Burley (Walt Disney Animation Studios, SIGGRAPH 2016 Talks). Se cita
  así en el código.
- **El lóbulo de salida es la aproximación de producción de la charla**:
  ignora adónde refractaría la dirección de llegada y da a toda salida la
  misma distribución en coseno. Con luz uniforme es exacto (el *furnace*);
  bajo un panel lateral, +3,5 % frente al camino exacto.
- **Un líquido dentro de un frasco de vidrio**: el vidrio macizo para los
  rayos de sombra (E5), así que la NEE del vértice de salida no ve las
  luces a través de la pared, y solo las encuentran las continuaciones por
  el coseno que atraviesan el vidrio: el frasco de leche sigue con grano a
  64 spp con cualquier estimador. Con cáusticas, los fotones se la llevan
  (y ahí apareció el fallo de abajo); *Automático* solo enciende las
  cáusticas con luces de menos de 20° vistas desde los *casters*, así que
  con el *softbox* del frasco no se encienden. Decisión para la dirección.
- **La regla de las paredes, medida sobre la refracción.** La decisión de
  la dirección hablaba de los puntos de entrada y salida del rayo de sombra y de
  la absorción en el tramo recto. Medido así (5 mm a lo largo del rayo
  recto), en el frasco paraba la mitad de los rayos de sombra de las
  salidas (90 de 183 en un render instrumentado de 60 × 45 a 4 spp): una
  luz a más de 53° de la normal de una pared de 3 mm la cruza en más de
  5 mm. Medida sobre el camino que refracta (el de la luz de verdad), una
  pared de 3 mm deja pasar cualquier ángulo (el tramo dentro es como mucho
  de 4,0 mm con ior 1,5); el rayo sigue luego en su dirección. Con eso, el
  sesgo en la placa queda en −2,0 % y la varianza baja 4,8 veces (con la
  medida recta, −2,1 % y 2,3 veces).
- **«El frasco a 64 spp debe perder el grano»** no se cumple del todo: el
  ruido de píxel de la leche baja un 28 % (0,112 → 0,081) y queda al nivel
  de una esfera de leche sin vidrio (0,070), pero sigue por encima del
  suelo (0,03). Lo que queda es del propio medio: cada muestra sale por un
  punto distinto y su NEE elige una de tres luces y la cúpula, y el panel
  de contraluz, el más potente, no se ve desde las salidas de delante.
  Ese grano es de E12 (la elección de luz por punto) y de E13 (la NEE de
  variedades a través del vidrio, en lugar de esta regla).
- **Fallo encontrado con la hoja**: con cáusticas, el vértice de salida
  recogía los fotones con la normal de su lado (el de dentro) y no veía
  ninguno: un medio dentro de vidrio perdía toda la luz que le llega a
  través del vidrio (la leche del frasco salía un 19 % más oscura). Ahora
  los recoge del exterior de su superficie; test nuevo (un bloque de medio
  iluminado solo a través de una bola de vidrio: fotones y trazador
  coinciden; con el fallo reintroducido, falla).
- **La prueba de la leche y la varianza**: el plan pedía que una mutación
  que reintrodujera la conexión desde dentro fallara por varianza. En una
  esfera no se separan: con la luz a un lado, delante a 45° o a 70° y de
  lado con un panel grande, el peor píxel iluminado a 256 spp de la
  conexión recta está a 0,98 / 0,83 / 0,87 / 0,85 de su referencia y el
  del lóbulo a 0,87 / — / 0,88 / 0,91; con la luz detrás (un borde
  iluminado) fallan los dos (0,00 y 0,22). Su cola pesada se veía en el
  frasco. Por decisión de la dirección, la prueba compara con la frontera exacta
  (la conexión recta da 2,089 frente a 2,790, −25 %, y falla) y conserva
  el peor píxel ≥ 0,6; la cláusula de la varianza se quita.
- **Sin medios anidados** (un líquido dentro de otro medio), un sólido con
  ior 1 no tiene medio (para la BSDF es una pared fina), un `g` cerca de
  ±0,9 converge despacio (el *furnace* prueba hasta ±0,4) y el *furnace*
  del medio solo corre en *release* (medio millón de caminos por caso; CI
  lo corre en nativo y en WASI). Las cáusticas no entran en un medio.
- La hoja se hizo a 64 y 256 muestras, no a 64 y 1024 como dice el
  contrato (decisión de la dirección).

**Hecho (c) · dispersión cromática.**

- **Campo**: `abbe`, el último de `MATL` desde (b) (byte 96); en el
  proyecto, `abbe` de la familia GLASS (0 por defecto: ninguna). Un
  proyecto o un RSB anteriores se abren sin dispersión.
- **El índice por longitud de onda** (`rt_core::integrator::dispersion`):
  la ley de Cauchy de dos términos, `n(λ) = A + B/λ²`, que pasa por `ior`
  en la línea d del helio (587,6 nm) y da el número de Abbe
  `V = (n_d − 1)/(n_F − n_C)` (F 486,1 nm y C 656,3 nm, las líneas del
  hidrógeno): `B = (n_d − 1)/(V (1/λ_F² − 1/λ_C²))`, `A = n_d − B/λ_d²`.
  Solo en un sólido claro **sin medio** (un paseo sale por su frontera con
  `ior`, así que su superficie tampoco dispersa) y nunca en una pared fina.
- **Una longitud de onda por camino**: cada canal es una banda (rojo
  580–700, verde 490–580, azul 400–490 nm). Al primer vidrio dispersivo,
  el camino elige un canal con probabilidad ⅓ y una longitud de onda
  uniforme en su banda, con una dimensión *hash* propia
  (`sampler::DIM_DISPERSION`, `1 << 23`, más allá de las del medio), y
  desde ahí lleva solo ese canal, por 3, y refracta con esa longitud de
  onda en todo vidrio dispersivo (rugoso también: la BSDF entera, con su
  compensación de energía, se construye con ese índice). Los fotones de
  las cáusticas hacen lo mismo con su propio generador al primer *caster*
  dispersivo. Un camino que no encuentra vidrio dispersivo sigue blanco:
  una escena sin `abbe` no cambia ni un bit (todos los *hashes* fijados
  salvo el de E9, abajo, siguen iguales).
- **Rápido** (`src/render/materials.ts`): la `dispersion` de three.js con
  la definición de glTF (`KHR_materials_dispersion`, 20 / número de Abbe,
  hasta 2), solo en vidrio macizo sin medio; la ayuda dice que Rápido la
  aproxima.
- **Receta**: `CRYSTAL`, *Cristal de perfumería* (ior 1,56, Abbe 40, liso,
  sin absorción), en *Vidrio*; 87 recetas.
- **Interfaz**: *Número de Abbe* (0 a 100, paso 1) bajo *Dirección* del
  vidrio, con su ayuda en los dos idiomas; mutación del *store* como
  cualquier parámetro.
- **Pruebas**: el prisma del contrato (45°, 100 mm, a 300 mm del suelo,
  Abbe 25) bajo una luz de disco de 20 mm con un haz de 10° a 800 mm:
  con fotones, en el suelo el azul cae más lejos que el verde y este que
  el rojo (centroides 23,76 / 23,03 / 22,69 px de 40; por regiones, el
  cociente azul/rojo de la mitad lejana de la banda es 1,073 y el de la
  cercana 0,880) y sin `abbe` la banda es blanca bit a bit; el mismo
  prisma visto desde arriba sobre una tira emisora separa las imágenes de
  los canales (rojo 16,99, verde 13,65, azul 8,53 px; sin `abbe`, las
  tres iguales bit a bit); una esfera de cristal (Abbe 30) lisa y rugosa
  (0,3) en un mundo uniforme sale blanca en cada canal (0,992 / 1,005 /
  1,002 y 0,993 / 1,004 / 1,004; cota 1,5 %); la ley de Cauchy pasa por
  `ior` en d y da el Abbe pedido; la elección de banda conserva la media;
  qué materiales dispersan; del lado de la interfaz, la receta, el
  parámetro y sus cadenas, el Rápido (y que un material reutilizado para
  otra familia la olvida) y el `rt.wasm` real con el *hash* nuevo.
- **Paridad**: la escena de E9 lleva ahora, además del medio, una esfera de
  cristal de Abbe 40 (radio 40 mm, delante a la derecha): **`0xc6c9036e`
  → `0xf693c26b`** (`PINNED_E9_MEDIA_4SPP`, `tests/fixtures/e9.rsb` de
  10 804 B), igual en escalar, SSE2 y AVX2, en WASI escalar y `simd128`,
  con 1, 4 y 16 hilos, en el `rt.wasm` real y por el código de la página.
- **Coste**: un número aleatorio por camino; los rayos no cambian (la
  escena de E9 a 480 × 360 y 256 spp, dos hilos: 479,9 M rayos en 427,9 s
  con el cristal, 475,4 M en 428,4 s con Abbe 0). El precio es ruido de
  color: en una caja de 191 × 109 px alrededor de la esfera, el ruido de
  píxel relativo (frente a sus vecinos) pasa de 0,029 a 0,037 a 256 spp
  (0,071 a 64 spp).

- **Puertas** sobre el árbol final: `cargo fmt`, `clippy -D warnings`
  (todo el *workspace* con todos los *targets*, y `rt-app` para Windows),
  la compilación de `rt-wasm`, `cargo test --workspace` en *debug* (624
  pruebas) y en *release* (630), `rt-core` en WASI escalar y `simd128`
  (272 cada uno), `tools/wasm-parity.mjs` con la escena de E9
  (`0xf693c26b`) y el ejemplo (`0x51ade97c`), el *fixture* `e9.rsb`
  idéntico a lo que escribe `rt`, y `npm run check`, `build` y `vitest`
  (1830 pruebas).

**Mutaciones de (c)**, todas cazadas: el canal sin el factor 3 (el
*furnace* del cristal: 0,331 en rojo; la media de las bandas); volver a
elegir la banda en cada superficie (el *furnace* diverge y el suelo del
prisma invierte los colores); refractar con `ior` en lugar del índice de la
banda (el prisma visto a través, los tres canales a 15,6 px); no enmascarar
el *throughput* (el mismo); en los fotones, no enmascarar su potencia,
volver a elegir la banda o refractar con `ior` (el suelo del prisma); el
signo de `A` en Cauchy (su test y los dos prismas); las bandas al revés
(los dos prismas); dispersar también un medio
(`only_clear_solids_without_a_medium_disperse`). Solo con el *hash* de
E9: la longitud de onda del centro de la banda en lugar de una uniforme
(los centroides se mueven 0,1 px) y la dimensión de la longitud de onda
dentro de la tabla Sobol.

**No encajó con el plan en (c).**

- **Una longitud de onda, sin MIS espectral.** El contrato ofrecía la
  longitud de onda héroe con tres (Wilkie et al. 2014) o una sola con MIS
  espectral. Con canales que son bandas disjuntas, cada longitud de onda
  solo aporta a su canal y, en un vidrio liso, las tres longitudes de la
  héroe se separan en la primera refracción (Wilkie deja ahí las
  secundarias), así que en el caso que importa no hay nada que pesar: se
  elige el canal con probabilidad ⅓ y se lleva por 3. Lo que sí ganaría
  la héroe con MIS es en el cristal **rugoso**, donde las tres longitudes
  podrían seguir con pesos; no se hizo.
- **Lo que sigue sin dispersión**: los rayos de sombra no atraviesan el
  vidrio (E5) y la regla de las paredes de los medios usa `ior`; un sólido
  con medio no dispersa.
- **El ruido de color**: una luz vista a través de un cristal converge
  como su cáustica (cada muestra lleva un solo color); en la escena de E9,
  a 64 spp el cristal tiene grano de color visible y a 256 spp casi no.
- **El suelo del prisma**: con un prisma de 100 mm la banda es ancha y los
  colores solo se separan en sus bordes (rojo cerca, azul lejos, a la
  vista); los centroides de los canales se separan menos de un píxel de 40,
  por eso el test mide también por regiones.
- La escena de paridad de E9 cambia de *hash* en (c): se eligió una sola
  escena para el medio y la dispersión en lugar de una nueva.

**Veredicto del responsable** (sobre las hojas de (b) y (c)): E9 (a, b y c)
aceptada. A 256 spp la leche y el zumo se leen como leche y zumo, las nueve
recetas se distinguen, las franjas del borde del cristal con Abbe 40 son las
que corresponden a ese vidrio y en el suelo del prisma el rojo queda cerca y
el azul lejos, como debe. Se acepta una longitud de onda por camino sin MIS
espectral; la longitud de onda héroe con MIS queda anotada como opción si
algún día el cristal rugoso la necesita. Una sola escena de paridad para el
medio y la dispersión es lo correcto: no se hace una escena aparte para el
cristal. El grano de color a 64 spp alrededor del cristal y la convergencia
como de cáustica de la luz vista a través del cristal se aceptan como el
coste de la física. Se acepta que los rayos de sombra, la regla de las
paredes y los sólidos con medio sigan sin dispersión.

**Unión con la rama de sesión** (U12, O1, U13, P6/P6b, E12, N6, M3a, S2,
S4a). Lo que se decidió al resolver:

- **Medios y E12**: el vértice de salida de un paseo hace su NEE con la
  selección por punto (`Lights::select`) y su MIS con `sampled_weight`,
  como cualquier vértice; el suceso recto de una pared fina conserva, además
  de la densidad del vértice de salida, **su selección** (`Selection`), para
  que la luz que encuentra detrás pese con las probabilidades con que eligió
  luz el rayo de sombra que la cruzó. La longitud de onda de la dispersión no
  toca la selección (es un canal del *throughput*).
- **Medios y S4a**: las partículas no llevan medio dispersor (una gota, una
  burbuja o una mota se cruzan como vidrio claro o absorben); el rayo de
  sombra de un vértice de salida y la prueba de la pared ven las partículas
  como cualquier rayo de sombra (`trace_shadow`, con el material teñido de
  cada partícula).
- **Dimensiones aleatorias y O1**: la banda cromática de la lente
  (`DIM_LENS_BAND = 3 << 20`) caía dentro del bloque de los medios
  (`1 << 21` en adelante, 256 vértices); los paseos tienen ahora bloque
  propio hasta el vértice 127 (`MEDIUM_BOUNCES`; los de después comparten
  el último), que acaba justo donde empieza la banda (test).
- **`MATL`**: el bloque de texturas de M2a empieza en el byte 100, después de
  los campos de E9, que ahora se escriben siempre (sin relleno); los
  *fixtures* `o1.rsb` (11 644 B) y `ambient.rsb` (9 680 B) se regeneran.
- **Catálogo**: 92 recetas (77, las cinco de los sets de L6, nueve de E9b y
  el cristal de E9c); claves intactas.
- ***Hashes*** **re-fijados** (la compensación de energía de E9a y la
  selección por punto de E12 se suman): ejemplo `0x75ba4cb4`, sus teselas
  `0xe2515c9a` y `0x7b62574d`, E5 `0xfdf0c2ac` (cielo `0x47fa4eb7`), E5c
  `0xf6fbc84f`, E5b-1 `0x7135df4b`, O1 `0x087d1276`, S4a `0xeb60bea2`
  (partículas `0xe38b8480`, igual), E9 `0x5b5ea281`, ejemplo con *denoise*
  `0x2a430f92`; los de los pases, iguales. Con U11, U11b y E11 (segunda
  unión): E11 `0x3d8f85de` → `0xd01702ce` (su escena es el ejemplo con el
  filtro fino: le llega E9a) y el ejemplo con el *denoise* del visor (U11) a
  2 y 4 spp `0x17514303` → `0x7000ceb2` y `0x6db6039b` → `0x5318d4c5`;
  los demás no se mueven; las 88 miniaturas de los montajes se vuelven a
  renderizar. Con O3a (tercera unión, tras v0.1.6): O3a `0x49938f3b` →
  `0x21e43bb1` y su *fixture* `o3a.rsb` de 9 436 B; las dimensiones del
  color de la dispersión (`1 << 23`) quedan por encima de las de los filtros
  de la lente (`4 << 20` y `5 << 20`, test); los *fixtures* RSB
  crecen 12 B por el `RNDR` de 64 B (el de E9, 10 816 B). La sección de E9
  en `ARCHITECTURE.md` pasa a ser §5.2 sexies (E11 tomó la quinquies). Los números de los tests de (a),
  (b) y (c) (*furnace*, medios, prismas) no se mueven en cuatro cifras: sus
  escenas tienen una luz o solo el entorno.

## E10 · Muestreo adaptativo y terminar por ruido — **Opus** — hecha (el criterio de error, no: decisión **Fable** pendiente)

**Qué.** Reparto de muestras por píxel según la varianza (`Film::lum2`),
determinista: tras cada pasada entera (todas las teselas, todos los
hilos), el estimador de error por píxel (error relativo de la media,
`sqrt(var/n) / (media + ε)`, suavizado 3×3 para que no sea ruidoso)
decide qué píxeles reciben la pasada siguiente, en bloques de 8×8 para
que la BVH y la caché lo agradezcan; la decisión solo depende de los
datos de la imagen, así que es la misma con cualquier número de hilos y
teselas (test). Al principio, 16 muestras a todos; después, cada pasada
va a los bloques por encima del umbral del momento (el cuantil 50 % del
error, bajando), y un bloque que ya no se muestrea conserva su media (la
imagen sigue siendo insesgada por píxel). El *denoise* recibe `n` por
píxel (ya lo tiene en los pases) y pondera la varianza por él. Interfaz:
en *Calidad*, *Terminar por* gana **Ruido** (umbral 0,5–5 %, por defecto
1 %, con una estimación del tiempo que sale de la pasada anterior); el
medidor del visor dice «adaptativo · n mín–máx». Un *flag* `RNDR` nuevo
al final; sin él todo es como antes (*hashes* intactos).

**Depende de.** E5b-1, U11 (comparten el bucle del lanzador).

**Criterio.** Mismo tiempo, menos error: sobre la hoja de E5b-1 (frasco
de vidrio y clave sola), el relMSE del adaptativo a igual tiempo es ≤
0,6 × el uniforme (medido y en el PR); determinismo 1/4/16 hilos y
teselas de dos tamaños; con el *flag* apagado, `0x223515c3` intacto.

**Hecho.**

- **Motor** (`rt_core::adaptive`, §5.2 duodecies de `ARCHITECTURE.md`):
  rondas. La primera da 16 muestras a todos con el renderizador de
  baldosas de siempre; al acabar cada ronda la imagen entera decide la
  siguiente: error relativo de la media por píxel,
  `sqrt((E[l²] − E[l]²) / (n − 1)) / (max(media, 0) + ε)` de las sumas y
  `Film::lum2`, `ε` el 1 % del blanco de pantalla a la exposición de la
  escena, suavizado 3 × 3 dentro de la imagen, el mayor de cada bloque de
  8 × 8; candidatos, los bloques por encima del objetivo (`RNDR.noise_threshold`;
  sin él, cualquiera) y por debajo del tope de muestras; la ronda va a los
  candidatos en o por encima de la mediana de sus errores; sin candidatos,
  convergido. Una ronda dura 16 × `clamp(bloques / (4 × activos), 1, 16)`
  muestras, nunca más que las del bloque activo con menos. Un bloque sin
  ronda conserva su media: cada píxel es la media de sus muestras `0..n`
  en orden. Todo `f32` en un orden fijo. `RNDR` gana `adaptive` (bit 0) y
  `noise_threshold` (72 B, escritos solo cuando se piden: sin ellos la
  sección es la de E11 byte a byte). `render::render_block` (un rectángulo
  de una baldosa, con su máscara de bordes y el mapa de fotones que se le
  dé: en una pasada la muestra `j` de todos los bloques activos usa el mapa
  `iteración + hecho + j`), `Film::cut`; el *denoise* recibe el conteo de
  cada píxel (`DenoiseInput::with_counts`: sumas y `lum2` reescaladas a las
  muestras del que más tiene, la varianza dividida por su propio `n − 1`).
- **Anfitriones**: `rt` (`--adaptive`, `--noise P`, `--write-e10-example`,
  `--adaptive-noise`), el lanzador (finales y visor; trama de 68 bytes con
  `FLAG_ADAPTIVE`, el mínimo y el máximo de muestras, el ruido del bloque
  peor y los segundos que espera hasta el objetivo; las sumas reescaladas,
  así que `Frame::fitted` y la página las leen como siempre) y el pool de
  la web (`src/render/adaptive.ts`, el puerto bit a bit de la decisión;
  `Accumulator` por bloques, el mensaje `blocks` y `rt_render_block_rgba` en
  los *workers*, `runAdaptive` en `render/schedule.ts`). Tras la primera
  ronda los hilos (o *workers*) se reparten los bloques activos de todas
  las baldosas uno a uno: la imagen no depende de quién hizo qué.
  `rt_adaptive_decide` expone la decisión del motor para
  `tools/wasm-parity.mjs --adaptive` y su bloque de CI.
- **Interfaz**: *Calidad ▸ Terminar por* gana *Ruido* (0,5–5 %, 1 % por
  defecto, con su nota y el campo de *Muestras* como tope); la estimación
  sale de la última pasada del visor *Completo* que muestrea al mismo
  umbral (lo que lleva más lo que el motor dice que le falta, escalado a
  los píxeles de la salida), y sin ella dice de dónde saldrá; el medidor
  dice *Adaptativo · 16–212 muestras* con los números del motor; la vista
  en vivo, el ruido frente al objetivo y lo que el motor espera; la cola,
  su progreso por ese tiempo. Cadenas `es`/`en`, cromo acromático.
  Capturas `docs/ui/render-window-noise.png` y `docs/ui/meter-adaptive.png`
  (`tools/noise-check.mjs`, que comprueba también el segmento, el campo, la
  nota, el medidor y la estimación en los dos idiomas).
- **Tests**: el error por píxel y la decisión (media imagen ruidosa, un
  solo bloque ruidoso, el tope, el objetivo, convergencia); el reparto del
  trabajo cubre exactamente los bloques activos con baldosas de 8, 13, 32 y
  64; cada píxel es bit a bit la media uniforme de sus `n` muestras;
  `PINNED_E10_ADAPTIVE` = `0x264b4106` (la escena de E10, de 16 a 48
  muestras por píxel) igual con baldosas de 32, 24 (en orden inverso) y 13
  (barajadas), pasadas de 16, 5 y 3, por `rt` con 1, 4 y 16 hilos, por el
  lanzador (final y visor) con 1, 4 y 16 hilos, en WASI escalar y SIMD, por
  el `rt.wasm` real escalar y SIMD (CI) y por el código de la página;
  `PINNED_E10_DECISIONS` = `0xb492454a` (seis decisiones de una imagen
  sintética) por el motor y por el puerto; un render por tiempo para entre
  pasadas y uno por ruido acaba limpio (rt y lanzador); el *denoise* con
  conteos pesa cada píxel por los suyos; los fotogramas adaptativos del
  lanzador caben en la vista en vivo pasada a pasada (U14) y llevan sus
  números de ida y vuelta; RSB con y sin los campos (`rt-core` y
  `src/io/rsb.ts`, fixture `tests/fixtures/e10.rsb`); la página con
  *workers* falsos (*Render* por ruido, el visor adaptativo) y con el
  `rt.wasm` real. Con el *flag* apagado ningún *hash* fijado se movió:
  `0x223515c3` es hoy `PINNED_EXAMPLE_4SPP` = `0x75ba4cb4` (lo movieron E9
  y E12) y sigue. Dos tests eran más permisivos que la realidad y se
  arreglaron: el del lanzador por ruido fallaba (ruido 0,2036 sobre un
  objetivo de 0,2) porque al converger salía sin publicar la última
  decisión; el de la página con *workers* falsos daba `mín = máx` porque
  el ruido falso era igual en toda la imagen (ahora varía por zonas).

*La medida* (`rt --adaptive-noise <dir> --size 480x360 --max-seconds 20
--samples 4096 --rounds 3 --threads 4`, `crates/rt-cli/src/adaptive_noise.rs`):
las dos escenas de la hoja de E5b-1 (la receta *clave sola* sobre la pieza
de ejemplo y el frasco de vidrio a contraluz) a 480 × 360; la referencia,
dos renders uniformes de 4096 muestras (semillas 1000 y 2000; el primero,
349 s en la clave sola y 425 s en el frasco), cuyo propio relMSE (la mitad del de una contra otra: 3,6·10⁻⁶ en la
clave sola, 4,7·10⁻⁵ en el frasco) se resta; tres rondas (semillas 1–3) de
un render uniforme de 20 s, uno adaptativo de 20 s y uno adaptativo hasta
los mismos rayos que el uniforme, sin objetivo de ruido (las muestras solo
cambian de sitio), 4 hilos, en esta máquina de 4 núcleos con otros agentes
a la vez (carga media 8). relMSE de E5b-1 (valores a 8 como mucho,
`(x − r)² / (r² + 0,01)`), media de las tres rondas, menos el de la
referencia:

| Escena | Uniforme | Adaptativo, mismo tiempo | Adaptativo, mismos rayos | Muestras (unif. · adapt.) |
| --- | --- | --- | --- | --- |
| Clave sola | 1,451·10⁻⁴ | 1,220·10⁻⁴ (**0,841 ×**) | 1,069·10⁻⁴ (0,737 ×) | 143–175 · 16–272 |
| Frasco de vidrio | 1,706·10⁻³ | 1,415·10⁻³ (**0,829 ×**) | 1,125·10⁻³ (0,659 ×) | 159–175 · 16–224 |

A igual tiempo el adaptativo traza menos rayos (un 5 % menos en la clave
sola, un 16 % menos en el frasco: sus muestras van al vidrio, de caminos
más largos y más caros por rayo, y cada pasada espera a su último bloque);
a igual número de rayos tarda un 2 % y un 18 % más.

**No encajó.**

- **El criterio no se cumple**: 0,84 × y 0,83 × a igual tiempo (0,74 × y
  0,66 × a igual número de rayos), no ≤ 0,6 ×. No es el coste del
  mecanismo (con un hilo, el adaptativo hace un 2–4 % menos de rayos por
  segundo que el uniforme): es el reparto. La regla del contrato (la
  ronda a los bloques por encima de la mediana del error) lleva todos los
  bloques al mismo error relativo, y eso gana sobre todo lo que tarda el
  uniforme en limpiar los bloques más ruidosos; con las dos referencias,
  el reparto **óptimo** por bloques de 8 × 8 (muestras proporcionales a la
  desviación de cada bloque, a igual número de muestras y coste igual por
  muestra) daría 0,476 × en la clave sola y 0,383 × en el frasco: el
  0,6 × solo cabe muy cerca del óptimo y sin que las muestras del vidrio
  cuesten más. Medidas sin mejora fuera del ruido de la medida: ordenar
  por `error × √n` (lo que una muestra más quita) en vez de por error,
  rondas de longitud propia por bloque, el error medio del bloque en vez
  del mayor, `ε` del 10 %, objetivos del 1 y el 2 %. Se queda la regla del
  contrato; si se cambia el criterio, la regla o se acepta así lo decide
  el líder (**Fable**, regla 11). Los números de otra máquina sin carga
  pueden ser algo mejores a igual tiempo (las barreras por pasada cuestan
  más con los núcleos ocupados por otros); el de igual número de rayos no
  depende de la carga.
- **Decide por rondas, no tras cada pasada**: una decisión solo al final
  de una ronda entera (que dura una o más pasadas), así que cortarla en
  pasadas por tiempo, por el carril del *denoise* en directo o por el
  tamaño de pasada del anfitrión no cambia un píxel, y la ronda crece
  cuando quedan pocos bloques activos (si no, cada ronda de pocos bloques
  sería una barrera para todos los hilos).
- **Los pases exactos y el albedo salen de la primera ronda** (las 16
  muestras de todos): el albedo es la media de esas, no de las `n` de cada
  píxel; los pases de rayo central no dependen de las muestras.
- **El contrato no dice qué `ε` ni qué error del bloque**: `ε` es el 1 % del
  blanco de pantalla a la exposición de la escena (para que el negro no
  cuente como ruidoso) y el bloque toma el mayor de sus píxeles (el
  suavizado 3 × 3 ya quita el ruido del propio estimador).
- **La estimación de *Ruido* sale del visor, no de «la pasada anterior» de
  un render que aún no existe**: de la última pasada del visor *Completo*
  que muestrea al mismo umbral (solo entonces el visor muestrea
  adaptativamente: cuando sigue las muestras de la salida, a escala 1);
  durante el render, de lo que el motor espera. *Terminar por ruido* llega
  al lanzador como `finish=samples`: el tope son las muestras y el
  objetivo del RSB lo acaba antes.
- `engine/README.md` está en inglés, como el resto de ese archivo.

## Materiales y sets con efecto — decisión **Fable** (tras v0.1.5)

Petición del usuario: importar materiales con sus normales, UV y
texturas; crear y editar materiales con un sistema de nodos al uso; una
capa de realismo en nuestros materiales; y montajes de luz que no se vean
todos iguales. Cuatro cosas distintas, cuatro fases.

**Por qué los montajes se ven iguales (diagnóstico Fable).** Un montaje
hoy es solo la *forma* de la luz (fuentes, posición, tamaño, tono), con
el nivel fijado por el tipo de producto, sobre el mismo fondo plano
oscuro y el mismo suelo, y su miniatura es siempre un anillo mate con la
misma cámara y la misma exposición. Pero la foto de producto no la hace
la luz sola: la hacen la luz **y lo que se refleja** (tarjetas blancas y
negras que dibujan los cantos de un cromado o la tira limpia de una
botella), el **fondo** (un degradado con un charco de luz detrás del
producto, un barrido, un fondo luminoso), el **suelo** (negro brillante
con reflejo, espejo, blanco mate) y el **contraste de tono** (clave cálida
y contra fría). Un montaje que solo mueve paneles no puede sorprender.

**Decisión.** Un montaje pasa a ser un **set**: luces + tarjetas +
fondo + suelo + exposición + entorno (+ una cámara sugerida), con una
razón fotográfica escrita en la ayuda. Se añaden 16 sets diseñados
(estilo nuevo `SETS`, el primero de la lista) y los 16 rigs de tipo de
producto se rediseñan con los mismos criterios; los 72 montajes
anteriores se quedan (claves estables) y pasan al final de la lista, con
las miniaturas de todos re-renderizadas por el motor con el mismo
sistema, cada set sobre el objeto para el que está pensado. Los sets se
construyen con lo que ya existe (luces L4, primitivas U9 como tarjetas,
barrido y suelo, materiales del catálogo, fondo plano o imagen de
degradado, fuerza del entorno, exposición): nada nuevo en el motor.
Fuentes (principios, no tablas): la «familia de ángulos» y el campo
claro/oscuro de Hunter, Biver y Fuqua, *Light: Science & Magic*; las
proporciones clásicas de clave/relleno; la práctica habitual del *still
life* de estudio.

**Orden.** Ahora, en paralelo con la ola A y sin tocar el motor: **L6**
y **M2a**. Después, por este orden: **M3a** (en cuanto U11 libere la
máquina), **M2b** y **M3b** (motor, tras E9 y E6), **M4** (tras E9, E6 y
M2b). La máquina tiene 4 núcleos: cinco agentes a la vez es el tope, y
los que no tocan el motor no compilan Rust (usan `/home/user/bin/rt` y
el `rt.wasm` ya construido).

## L6 · Sets de estudio con criterio fotográfico — **Opus**, diseño **Fable** — hecha

**Qué.** `LightSetup` gana campos opcionales (los 72 montajes antiguos no
cambian): `backdrop` (`FLAT` color; `GRADIENT` dos colores, arriba y
abajo, como imagen de fondo generada; `SWEEP` fondo infinito de U9 con
material y color, que recibe luz y sombra), `pool` (un *spot* aimed al
fondo tras el producto: `az`, `el`, cono, `share`, kelvin: el charco de
luz), `floor` (`CATCHER` atrapasombras; `MATTE` suelo del motor con
color; `GLOSSY` y `MIRROR`: un plano primitivo bajo el producto con un
material del catálogo —acrílico negro brillante, acrílico blanco, espejo
negro—), `cards` (planos primitivos con materiales de catálogo nuevos
*Tarjeta blanca* 0,92 mate, *Tarjeta negra* 0,02, *Tarjeta plateada*
aluminio cepillado; `az`, `el`, `dist`, `size`, `sizeY`, giro; por
construcción fuera del encuadre: `|az| ≥ 55°` o `el ≥ 60°`, y un test
lo comprueba con la focal del tipo de producto), `exposureEv` (desvío
sobre el del tipo de producto), `envStrength`, `kelvin` por luz (ya
existe), `camera` sugerida (`el`, `focalMm`: no se aplica sola; un botón
*Usar la cámara del set*), `hero` (el objeto de la miniatura: `BOTTLE`,
`BOX`, `RING`, `CHROME`, `SHOE`, `SPHERES`) y `why` (`Label`: la razón
fotográfica, dos frases, en la ayuda de la miniatura). Aplicar un set
crea sus primitivas (tarjetas, barrido, suelo) marcadas como *del set*
(decoración: no cuentan para el tamaño de pieza, el Doctor ni *Encuadrar
el producto*) y aplicar otro las sustituye sin tocar las piezas del
usuario; *Restablecer al montaje* las quita. Una entrada de deshacer.

**Los 16 sets** (números de partida en tamaños de pieza; el agente los
afina sobre la hoja de contactos y Fable da el veredicto, regla 11):

1. `STRIP_EDGE` **Tira larga y canto negro** (botella, cosmética).
   Clave: tira 0,35 × 4,5 a `az −115, el 25, dist 3`, 5300 K, 55 %;
   relleno: panel 3 × 3 a `az 70, el 20, dist 3,5`, 25 %, `glossy
   false`; contra: tira 0,3 × 3 a `az 160, el 30`, 20 %. Tarjetas: negra
   2 × 5 a `az 60, el 15, dist 1,6` (dibuja el canto); blanca 2 × 4 a
   `az −60, el 10, dist 2`. Fondo `GRADIENT` 0,10→0,02 con `pool` a
   `az 180, el 10`, cono 25°, 15 %. Suelo `GLOSSY` negro. EV −0,3.
   Cámara `el 8, 85 mm`. Héroe `BOTTLE`. Por qué: una sola tira limpia
   recorre la botella de arriba abajo y el canto negro la separa del
   fondo; el reflejo en el suelo la asienta.
2. `DARK_FIELD` **Campo oscuro** (vidrio, perfume). Sin luz frontal: dos
   tiras 0,4 × 4 a `az ±135, el 15, dist 2,8`, 40 % cada una, justo
   fuera del encuadre; cenital débil 2 × 2 a `el 85`, 20 %, `glossy
   false`. Fondo `FLAT` 0,01; `envStrength 0`. Suelo `GLOSSY` negro.
   Tarjetas negras 3 × 4 a `az ±70, el 10, dist 1,8`. EV −0,5. Héroe
   `BOTTLE`. Por qué: el vidrio solo se ve por sus bordes; sobre negro,
   dos tiras detrás los dibujan en blanco (Hunter et al., *dark-field*).
3. `BRIGHT_FIELD` **Campo claro** (vidrio, transparentes). Fondo
   luminoso: panel 6 × 6 a `az 180, el 10, dist 3`, `camera true`,
   60 %; cenital 3 × 3 a `el 80`, 20 %; relleno 2 × 2 a `az 0, el 20`,
   20 %, `glossy false`. Tarjetas negras 2 × 5 a `az ±65, el 10, dist
   1,6`. Suelo `GLOSSY` blanco (acrílico). EV +0,3. Héroe `BOTTLE`. Por
   qué: sobre blanco el vidrio se dibuja con bordes negros, que ponen
   las tarjetas, no la luz.
4. `HIGH_KEY_WHITE` **Blanco infinito** (e-commerce). Fondo `SWEEP`
   blanco 0,9; cenital 5 × 4 a `el 75, az 0, dist 2,6`, 45 %; dos
   laterales 2 × 4 a `az ±95, el 20`, 20 % cada una; relleno frontal 3 ×
   3 a `az 0, el 25`, 15 %, `glossy false`. Suelo `GLOSSY` blanco, sombra
   suave. EV +0,5. Héroe `BOX`. Por qué: el fondo quemado a blanco y la
   sombra de contacto apenas visible es el estándar de tienda.
5. `JEWEL_BOX` **Caja de luz con negros** (joyería). Carpa de cuatro
   paneles 3 × 3 a `az ±60, ±120, el 30, dist 2,5`, 15 % cada uno, y
   cenital 3 × 3, 20 %; *spot* duro 0,05 a `az −40, el 55, dist 3`,
   10 %, cono 12° (chispa, cáusticas on); tarjetas negras 2 × 2 a `az 0,
   el 70, dist 1,5` (el oro necesita reflejos oscuros para leerse como
   oro) y 2 × 3 a `az −30, el 5`. Fondo `GRADIENT` 0,06→0,015. Suelo
   `GLOSSY` negro. EV 0. Cámara `100 mm`. Héroe `RING`. Por qué: luz
   envolvente para que la piedra brille, y negros colocados para que el
   metal tenga forma.
6. `CHROME_FAMILY` **Familia de ángulos** (reloj, cromados). Un panel
   grande con degradado de dos paneles: 4 × 4 a `az −35, el 45, dist 2,2`,
   50 %, y 2 × 4 superpuesto a `az −25, el 50, dist 2,0`, 20 %; tarjeta
   negra 4 × 4 a `az 50, el 35, dist 1,8` y plateada 2 × 3 a `az 120, el
   10`; contra tira 0,3 × 3 a `az 170, el 20`, 15 %; relleno 15 %
   `glossy false`. Fondo `GRADIENT` 0,12→0,03. Suelo `GLOSSY` negro.
   EV −0,2. Héroe `CHROME`. Por qué: un cromado solo muestra lo que
   refleja; se le pone delante un degradado grande y un negro limpio.
7. `RAKING_TEXTURE` **Rasante con relleno** (calzado, textil, piel).
   Clave tira 4 × 0,8 a `az −85, el 10, dist 3`, 4800 K, 65 %, `spread
   60`; relleno 4 × 3 a `az 55, el 30, dist 3,6`, 6200 K, 20 %, `glossy
   false`; contra 0,3 × 3 a `az 150, el 35`, 15 %. Fondo `SWEEP` gris
   0,25. Suelo `MATTE` 0,3, sombra. EV 0. Cámara `el 15, 50 mm`. Héroe
   `SHOE`. Por qué: la trama se lee con luz rasante, y la clave cálida
   contra el relleno frío separa volumen de superficie.
8. `BLACK_ON_BLACK` **Negro sobre negro** (electrónica). Dos tiras 0,3 ×
   4 a `az ±150, el 30, dist 2,6`, 35 % cada una; relleno frontal 2 × 2 a
   `az 0, el 20`, 8 %, `glossy false`; `pool` a `az 180, el 5`, cono 20°,
   22 %, 6500 K. Fondo `FLAT` 0,01. Suelo `GLOSSY` negro. `envStrength
   0,1`. EV −0,6. Héroe `BOX`. Por qué: un producto negro se dibuja por
   dos líneas de luz en sus cantos y un halo tenue detrás.
9. `WARM_WINDOW` **Ventana cálida** (alimentación, hogar). Clave 5 × 4 a
   `az −65, el 40, dist 2,4`, 4300 K, 70 %; relleno 3 × 3 a `az 40, el
   15, dist 3,5`, 6500 K, 15 %, `glossy false`; tarjeta negra 3 × 4 a
   `az 75, el 10, dist 1,8` (relleno negativo). Fondo `SWEEP` 0,35 ×
   (1, 0,9, 0,8). Suelo `MATTE` 0,35. EV 0. Héroe `SPHERES`. Por qué:
   una ventana lateral grande y un lado dejado en sombra es la luz de
   mesa de toda la vida.
10. `BACKLIT_LIQUID` **Contraluz líquido** (bebidas). Contra panel 2 × 3
    a `az 180, el 8, dist 2,2`, 55 %, `camera false`; dos tiras de canto
    a `az ±130, el 20`, 15 % cada una; relleno frontal 2 × 2, 10 %
    `glossy false`; tarjeta blanca 2 × 2 a `az 0, el 65, dist 1,4`.
    Fondo `GRADIENT` 0,08→0,02. Suelo `GLOSSY` negro. Cáusticas on.
    EV −0,2. Héroe `BOTTLE`. Por qué: el líquido se enciende cuando la
    luz lo atraviesa hacia la cámara.
11. `TEAL_ORANGE` **Cine cálido-frío**. Clave 3 × 3 a `az −45, el 35,
    dist 2,8`, 3800 K, 55 %; contra tira 0,3 × 3 a `az 140, el 25`, color
    (0,55, 0,8, 1), 25 %; relleno 10 % 5600 K; `pool` 8000 K a `az 180,
    el 10`, 10 %. Fondo `GRADIENT` (0,03, 0,06, 0,08)→0,01. Suelo
    `GLOSSY` negro. EV −0,3. Héroe `BOTTLE`. Por qué: dos temperaturas
    opuestas en clave y contra es el contraste de color que más se usa
    en cine.
12. `POP_COLOR` **Color pop**. Fondo `SWEEP` color (0,95, 0,55, 0,45);
    cenital 4 × 4 a `el 70`, 45 %; dos tiras 0,4 × 4 a `az ±110, el 20`,
    colores complementarios (0,4, 0,7, 1) y (1, 0,85, 0,5), 20 % cada
    una; relleno 15 % `glossy false`. Suelo = fondo, `MATTE`. EV +0,2.
    Héroe `BOX`. Por qué: el color de fondo saturado y dos contras de
    color son el lenguaje de la tienda en redes.
13. `GRADIENT_POOL` **Fondo degradado con foco** (catálogo). Clave 3 ×
    2,5 a `az −40, el 40, dist 2,8`, 50 %; relleno 3 × 3 a `az 60, el 20`,
    20 % `glossy false`; contra 0,3 × 3 a `az 165, el 30`, 15 %; `pool`
    a `az 180, el 15`, cono 30°, 15 %. Fondo `SWEEP` gris 0,45. Suelo
    `GLOSSY` gris claro. EV 0. Héroe `SPHERES`. Por qué: el charco de luz
    detrás separa el producto y da profundidad a un fondo neutro.
14. `MIRROR_FLOOR` **Suelo espejo** (perfume, cosmética). Suelo `MIRROR`
    (espejo negro); cenital 3 × 3 a `el 80`, 35 %; dos tiras bajas 0,4 ×
    3 a `az ±120, el 5, dist 2,5`, 25 % cada una (encienden el reflejo);
    relleno 15 % `glossy false`. Fondo `GRADIENT` 0,05→0,01. EV −0,3.
    Héroe `BOTTLE`. Por qué: el reflejo completo bajo el producto es el
    plano de perfumería por excelencia.
15. `FLAT_LAY` **Cenital** . Cámara sugerida `el 85, 50 mm`; cenital
    5 × 5 a `el 60, az −30, dist 2,5`, 60 %; relleno 3 × 3 a `az 150, el
    40`, 25 % `glossy false`; tarjeta blanca 3 × 3 a `az 180, el 20, dist
    1,6`. Fondo = suelo `MATTE` 0,8 (papel). EV +0,2. Héroe `BOX`. Por
    qué: la luz desde un lado alto y una sombra suave hacia el otro es
    el plano cenital de revista.
16. `SILHOUETTE_GLOW` **Silueta con halo** (dramático). `pool` fuerte a
    `az 180, el 15`, cono 35°, 55 %, 5600 K; relleno frontal 2 × 2 a `az
    0, el 25`, 12 %, `glossy false`; dos tiras 0,3 × 3 a `az ±140, el
    25`, 16 % cada una. Fondo `SWEEP` 0,2. Suelo `GLOSSY` negro.
    `envStrength 0`. EV −0,4. Héroe `BOTTLE`. Por qué: el halo detrás
    recorta la silueta y las tiras la rematan con dos filos de luz.

**Rigs de tipo de producto (los 16 de `studios.ts`).** Cada uno pasa a
ser un set con los mismos criterios: joyería ← 5; reloj y cromados ← 6;
perfume y cosmética ← 1 (con suelo espejo si el tipo lo pide); vidrio y
bebidas ← 10 (campo oscuro si el líquido es claro); electrónica ← 8;
calzado, textil y piel ← 7; alimentación y hogar ← 9; *packaging* ← 13;
el genérico ← 13. El agente mapea los 16 y lo deja escrito.

**Miniaturas.** `tools/setup-thumbs.mjs`: construye el RSB con el
mismo código de la aplicación (`core/rig.ts` → `io/rsb.ts`, en Node) y
renderiza con `rt` (`/home/user/bin/rt` en este entorno; en CI el
binario del job) a 256 × 256, 96 muestras, *denoise*, semilla fija, cada
set sobre su héroe (`BOTTLE` el frasco de ejemplo con vidrio y líquido;
`BOX` una caja con una banda de otro material; `RING` un toro de oro;
`CHROME` un toro cromado; `SHOE` una cápsula de piel; `SPHERES` tres
esferas mate, brillante y metal); los 72 antiguos se re-renderizan con el
mismo sistema (héroe por estilo). Determinista: una captura cambia solo
si cambia el set o el motor (un test fija el *hash* de una).

**Interfaz.** El estilo *Sets* primero, miniaturas grandes (el doble que
las actuales) con la razón fotográfica en la ayuda, *Usar la cámara del
set*, y la sección *Luz* del inspector enseña las tarjetas y el fondo
del set como filas propias (se pueden apagar). Cadena en `es` y `en`.

**Depende de.** L4, U9.

**Criterio.** Hoja `out/sets-sheet.html` con los 16 sets × 3 héroes a
512 px y 256 muestras, **con veredicto de Fable antes de cerrar**; los
72 montajes antiguos conservan sus claves y su resultado (test: el rig
resuelto de cada uno es el mismo que antes); las tarjetas de ningún set
entran en el encuadre con la focal del tipo (test); una entrada de
deshacer por set; `npm run qa` en verde.

**Hecho.** *Esquema.* `LightSetup` gana, todos opcionales, `backdrop`,
`pool`, `floor` (con `roughness`), `cards`, `exposureEv`, `envStrength`,
`camera`, `hero`, `why` y `caustics` (`data/types.ts`); `StudioPreset` gana
`set`; `LightStyle` gana `SETS`, el primero de `LIGHT_STYLES`. Los 16 sets
van primero en `LIGHT_SETUPS` y los 72 de antes detrás, con sus claves. Un
test compara el rig resuelto de los 71 montajes antiguos (menos `PRESET`)
contra los 16 tipos de producto con una instantánea tomada antes de tocar
nada (`tests/fixtures/old-setup-rigs.json`: forma y energías relativas, y
el nivel de cada tipo): siguen dando lo mismo, y su exposición también.

*Aplicar un set* (`core/sets.ts`, que `store.ts` consulta antes que el
reductor de luces): `studio/setSetup` con un set pone sus focos, su aspecto
(fondo `COLOR`, `GRADIENT` —fondo nuevo del entorno, dos colores que el
RSB lleva como imagen de fondo estirada y la vista previa pinta igual— o
el barrido; cúpula; exposición) y su decoración: el barrido de U9 ajustado
a la cámara (con fondo `SWEEP`, o `FLAT`/`GRADIENT` con charco), el suelo
(cara *suelo* del barrido en el material, o una lámina que se para antes
del charco, o un plano del tamaño del suelo del barrido sin él), las
tarjetas (planos de cara al pivote, subidos sin girar hasta apoyarse en el
suelo) y el charco (un foco direccional, `setPiece: 'POOL'`). Todo en una
acción: una entrada de deshacer. Las piezas llevan `SceneNode.setPiece` y
no son producto (`productParts`, pivote, tamaño), ni las mira el Doctor
(`ownParts`), ni las encuadra *Encuadrar* sin selección. Otro set las
sustituye; un montaje que no es set las quita y devuelve el aspecto del
tipo; *Restablecer montaje* las quita (regla del plan) y devuelve los
focos; *Crear estudio* las vuelve a ajustar; `studio/useSetCamera` (botón
*Usar la cámara del set*) pone la elevación y la focal sugeridas, encuadra
y reajusta barrido, suelo y charco; `studio/fitSet` viste el producto que
llega (ejemplo, importación) en la misma entrada de deshacer.

*Los 16 sets*, con los números del plan salvo lo que dicen la hoja de
contactos, los tests y el veredicto: claves `GLASS_DARK_FIELD` y
`WARM_COOL_CINEMA` (las del plan ya existían); tarjetas movidas solo donde
el test las veía en el encuadre (`STRIP_EDGE` negra az 60→70;
`BRIGHT_FIELD` negras ±65→±70; `JEWEL_BOX` cenital el 70→80, lateral
az −30 el 5 → az −70 dist 1,7; `CHROME_FAMILY` negra az 50 el 35 → az 75
el 20, plateada az 120→90; `BACKLIT_LIQUID` blanca el 65 dist 1,4 → el 80
dist 1,5; `FLAT_LAY` blanca el 20 dist 1,6 → el 45 dist 2,8); tiras
subidas por la regla de su reflejo (`STRIP_EDGE` contra el 30→50;
`GLASS_DARK_FIELD` ±135 el 15→55, dist 3; `CHROME_FAMILY` contra el 20→70;
`BLACK_ON_BLACK` ±150 el 30→70, dist 3; `BACKLIT_LIQUID` cantos el 20→30,
dist 3; `WARM_COOL_CINEMA` contra el 25→55; `GRADIENT_POOL` contra el
30→70; `SILHOUETTE_GLOW` ±140 el 25→55); `BRIGHT_FIELD` panel 6×6 a dist 3
→ 4,5×4,5 a dist 4, partes 0,9/0,06/0,04, EV +1,2, cúpula 1,2;
`HIGH_KEY_WHITE` EV +1,4, cúpula 2 y un baño del fondo (charco de cono 90,
parte 1,5); `BLACK_ON_BLACK` barrido 0,04, charco 30 %, cono 18°;
`GRADIENT_POOL` barrido 0,30, clave a dist 2,2, charco 70 % y cono 22°,
cúpula 0; `SILHOUETTE_GLOW` charco 45 %, cono 45°; `BACKLIT_LIQUID` lámina
con rugosidad 0,2. Donde el plan no daba
geometría (rellenos, alguna distancia) se puso un panel 3 × 3 a az 30–60,
el 20, dist 3–3,5 y las tiras a dist 3. Fondo de `BRIGHT_FIELD` `FLAT`
0,9; `FLAT_LAY` es un barrido de papel 0,8.

*Tipos de producto* (`studios.ts`, `PRESET_SETS`): GENERIC y PACKAGING ←
`GRADIENT_POOL`; JEWELLERY ← `JEWEL_BOX`; WATCH, AUTOMOTIVE y TOOL ←
`CHROME_FAMILY`; PERFUME y COSMETICS ← `STRIP_EDGE`; ELECTRONICS ←
`BLACK_ON_BLACK`; APPLIANCE y MEDICAL ← `HIGH_KEY_WHITE`; FURNITURE_IN ←
`WARM_WINDOW`; FOOTWEAR y TEXTILE ← `RAKING_TEXTURE`; EYEWEAR ←
`BRIGHT_FIELD`; FURNITURE_OUT conserva su sol. Cada uno toma el set entero
(veredicto): sus focos al nivel de irradiancia que tenía el tipo, el
desvío de exposición sumado a su `exposure`, y con su rig propio la
decoración y el aspecto; los presets de tipo de producto cambian (claves
iguales), los montajes de antes no.

*Materiales nuevos* (claves nuevas, nada renombrado): `CARD_WHITE` (0,92
mate), `CARD_BLACK` (0,02 mate), `ACRYLIC_BLACK` y `ACRYLIC_WHITE`
(acrílico con rugosidad 0,12) y `MIRROR_BLACK`; la tarjeta plateada es
`ALU_BRUSH`, que es exactamente eso.

*Miniaturas* (`tools/setup-thumbs.mjs`): las 88 renderizadas por `rt` a
256 × 256, 96 muestras, *denoise*, semilla 1 (y vueltas a codificar sin
pérdida: `rt` guarda el PNG sin comprimir, 197 kB cada una; quedan 2,5 MB
las 176), con la escena que construye
el código de la aplicación (`tests/setup-thumbs-dump.test.ts` en vitest;
héroes en `tests/set-heroes.ts`), `setup_<clave>.png` a 64 × 64 por
promedio, y `manifest.json` con el *hash* de cada RSB y de cada PNG: un
test reconstruye las 88 escenas y las compara, otro fija el *hash* de una
miniatura, y otros miden sobre las miniaturas lo que pidió el veredicto
(fondo ≥ 0,92 sin quemar la etiqueta; charco ≥ 2 veces el borde; halo que
cae sin meseta), con los umbrales en un solo sitio (`LOOK`,
`tests/thumb-metrics.ts`); `REPACKSHOT_SET_MEASURES=1 npx vitest run
tests/sets.test.ts -t measures` imprime las medidas de los 16 contra ellos,
para reajustar solo la exposición del set que cruce uno si cambia el motor. Hoja de contactos: `tools/sets-sheet.mjs` →
`out/sets-sheet.html` (sets × BOTTLE/BOX/CHROME y los 15 tipos que son
un set, antes y después). Interfaz: estilo *Sets* primero, miniaturas de los sets en dos
columnas y cuadradas (el doble de altas), la razón en la ayuda, *Usar la
cámara del set*, la lista *En el set* con interruptores; fondo
*Degradado* en *Entorno*; comprobado en el navegador con
`tools/sets-check.mjs`.

No encajó con el plan:
- Un charco sobre fondo `FLAT` o `GRADIENT` no tiene dónde caer (el fondo
  es una imagen): esos sets llevan barrido del color (`GRADIENT`: el de
  arriba).
- El charco no cae a `az`/`el` del pivote: con la cámara a 22° la pared del
  barrido, detrás de los focos de contra, casi no sale en el encuadre.
  Cae donde la cámara ve el fondo justo por encima del producto, y el foco
  (apuntado desde `az`/`el` a 0,75 del pivote) se pone cerca del papel con
  cono de 150°: el halo cae desde el centro, sin borde; el `cone` del set
  dice su anchura.
- Un suelo mate sobre un barrido es el barrido (un papel no tiene dos
  albedos): el gris del suelo de `RAKING_TEXTURE` (0,3 frente a 0,25) no se
  usa.
- Los números de partida de `HIGH_KEY_WHITE`, `BRIGHT_FIELD` y
  `GRADIENT_POOL` no llegaban a sus criterios medidos con *Fílmico* (que
  comprime las luces): ver arriba lo que hizo falta.
- *Restablecer montaje* quita la decoración (regla del plan); elegir el set
  otra vez la devuelve.
- Una escena vacía no recibe piezas: el ejemplo o el modelo importado las
  traen (`studio/fitSet`); cargar un proyecto o sustituir la escena por
  otra no las rehace solas.
- La hoja final es de 512 px a 96 muestras con *denoise*, no a 256 (la
  máquina es compartida y 256 no cambia nada del veredicto); sus pares de
  tipo de producto son los 15 que son un set sobre BOTTLE, y Estándar y
  Electrónica también sobre BOX.
- Las miniaturas de `STRIP_EDGE`, `BLACK_ON_BLACK` y `WARM_COOL_CINEMA`
  llevan puntos sueltos en el papel (*fireflies*). Su charco es un foco
  cerca del papel con poca potencia, y el motor elige la luz de cada
  muestra por su flujo: al charco le toca un 4–6 % de las veces, aunque
  donde cae ilumina como una luz entera. Con el charco apagado
  desaparecen; ni quitar el brillo a la clave o a la contra ni las
  cáusticas cambian nada. Va al motor (E12, selección de luz por punto) y
  esas miniaturas se vuelven a renderizar cuando entre; el charco no se
  mueve ni las miniaturas recortan la luz indirecta.
- Con la compensación de energía de E9a (los materiales rugosos ya no
  pierden luz) el papel de `GRADIENT_POOL` subió más que su charco y el
  criterio del test (charco ≥ 2× el fondo) quedó en 1,96: el charco pasa
  de 0,70 a 0,85 (0,75 daba 1,99, todavía rojo). Como ese set es también
  el del estudio PRESET y de PACKAGING/GENERIC, sus miniaturas y las de
  `PRESET` se rehicieron con las 88 (`tools/setup-thumbs.mjs`); el resto
  no cambió.
- *En el set* enseñaba la fila de fondo degradado de `STRIP_EDGE` tras
  *Restablecer montaje* (su degradado es un barrido, por el charco): la
  fila sale ahora solo para un fondo que el set pone detrás sin barrido
  (`setBackground`, con su test). Lo encontró `tools/sets-check.mjs`.
- La vista previa (*Rápido*) no distingue los focos con `glossy: false`
  (ya era así antes de L6): el relleno de `STRIP_EDGE` deja su brillo en
  el suelo acrílico de la vista previa (`docs/ui/sets-catalogue.png`, abajo
  a la derecha) y el render no. Los suelos brillantes de los sets lo hacen
  más visible; no se ha tocado.
- `tests/chunks.test.ts` tomaba como *chunk* de `io/import.ts` el primero
  cuyo nombre empezaba por `import-`; `import-options-<hash>.js` también
  empieza así y cuál sale antes depende del *hash*: con el de esta fase
  salía el otro y el test fallaba sin que el *bundle* cambiara. Ahora lo
  busca por su nombre exacto.

## M2a · Texturas: importación, mapeado, etiquetas y vista previa — **Opus** — hecha

**Qué.** La parte sin motor de M2 (el modelo ya tiene `textures`, los
importadores ya conservan las texturas y las UV: hoy no se ven en
ningún sitio). (1) **Importar**: glTF/GLB, FBX, OBJ+MTL, USD, Collada y
3MF traen sus materiales con color base, rugosidad, metal, normal, alfa
y emisión (mapas e intensidades), sus UV (y un segundo juego si lo hay)
y sus normales por vértice, a instancias de material con sus mapas, y
los mapas viajan en el proyecto embebidos (PNG/JPEG tal cual; límite de
tamaño con aviso en la hoja de importación). (2) **Ranuras de textura**
en el inspector de material: color, rugosidad, metal, normal, alfa, con
*Proyección* (UV, caja, plana, cilíndrica, esférica), escala (mm o
tamaños de pieza), giro, desplazamiento, repetición, e intensidad del
mapa de normales; vista previa de la imagen y *Cargar…*, *Quitar*. (3)
**Etiquetas**: una imagen con alfa colocada con clic y arrastre sobre
una zona de la pieza (proyección plana desde la normal del punto
clicado, con tamaño, giro y acabado propio: rugosidad, barniz y relieve
del papel), varias por material, en orden; *Mover etiqueta* con el
gizmo. (4) **Vista previa Rápido** (three.js): todos los mapas y
proyecciones se ven (caja, cilíndrica y esférica con un *shader* propio
de proyección triplanar en `preview.ts`; etiquetas con un segundo mapa
alfa). (5) **Contrato RSB para M2b** (escrito en `ARCHITECTURE.md` §5.2,
el motor lo lee en M2b): sección `IMGS` (imágenes: ancho, alto, canales,
sRGB o lineal, 8 bits, mipmaps calculados en el motor) y en `MATL`
campos finales (tras los de E6 y E9): índice de imagen y mapeado por
ranura, y una subsección de etiquetas. (6) `UI.md` y `SPEC.md` §3.3.

**Depende de.** U9, E5. No toca `engine/`.

**Criterio.** Un GLB con mapas (color, normal, rugosidad-metal,
emisión) se importa y se ve en Rápido con los mismos mapas que en un
visor glTF de referencia (comparación de captura, tolerancia); un cubo
con proyección caja recibe la textura sin estirar en las seis caras
(test del *shader* por captura); el proyecto guarda y abre las imágenes
embebidas en los mismos bytes; una etiqueta puesta con clic y arrastre
sobre el frasco de ejemplo queda donde se puso (captura
`docs/ui/label-placed.png`).

**Hecho.** Modelo en `src/core/textures.ts`: seis ranuras (color,
rugosidad, metal, normal, alfa, emisión) con imagen, mapeado propio o
común, canal, invertir, intensidad, mapa de alturas, recorte y umbral,
tinte; el mapeado (UV con dos juegos, caja, plana, cilíndrica, esférica;
eje, **tamaño en mm** —una textura de imagen es la foto de algo con tamaño
propio, el material se comparte entre piezas y viaja en la biblioteca, el
motor trabaja en mm; la primera imagen lo pone al tamaño de la pieza—,
giro, desplazamiento, repetición, bordes) y las etiquetas (origen, normal
y eje en el espacio de la pieza, ancho, giro, alcance, rugosidad, barniz,
relieve), con las acciones `texture/*` (deshacibles, un arrastre una
entrada, sin entrada si nada cambia) y la matemática de las proyecciones y
de las etiquetas como referencia que fijan los tests (caja sin espejos ni
estiramiento en las seis caras, giro antihorario con v arriba, cilíndrica
centrada delante, colocación desde un punto y una normal a través de la
matriz del mundo, también con escala desigual). Imágenes en el registro
como su PNG o JPEG, con id por contenido (SHA-256) y límites (16 MB y 8192
px por imagen, 64 MB por proyecto). **Importación**: glTF desde su JSON
(`io/gltf-materials.ts`: PBR, emisión con `KHR_materials_emissive_strength`,
`alphaMode`/`alphaCutoff`, transmisión, IOR y barniz, `KHR_texture_transform`
convertido exacto a v arriba y comprobado contra el `setUvTransform` de
three, muestreadores; el cargador recibe el archivo sin texturas); OBJ con
sus `.mtl` (`io/mtl.ts`, `io/obj-materials.ts`, con sus opciones); FBX,
Collada, 3MF, USD y 3DM con los mapas de sus cargadores
(`collectTextures`); los archivos **elegidos o soltados con el modelo**
(imágenes, `.mtl`, `.bin`) se le dan como compañeros y un
`LoadingManager` los encuentra por nombre; UV con segundo juego en toda la
tubería (soldadura, cortes, GLB del proyecto `TEXCOORD_1`), normales del
archivo conservadas. La hoja de importación tiene su sección *Texturas*
(cuántas, cuánto pesan, cada una que no y por qué, mapas sin ranura) y el
presupuesto del proyecto se aplica al pulsar *Importar*. **Proyecto**: las
imágenes en el bloque `images`, mismos bytes y mismos ids al abrir en otra
sesión y al guardar otra vez; las que faltan quitan sus ranuras con
`MISSING_IMAGES`; los proyectos y bibliotecas anteriores se leen con
`normalizeTextures`. **Inspector**: sección *Texturas*
(`ui/panels/insp-textures.ts`) con las ranuras, el mapeado y las
etiquetas; herramienta de etiqueta en el visor
(`ui/panels/viewport-labels.ts`): pulsación y arrastre, *Mover etiqueta*.
**Rápido**: `render/texture-shader.ts` (GLSL en el `MeshPhysicalMaterial`
con `onBeforeCompile`: proyecciones, caja triplanar por |n|⁴, cilíndrica y
esférica sin costura por el gradiente de Tarini, normal en marco de
derivadas de Schüler, alturas y borde de etiqueta por el relieve de
Mikkelsen, etiquetas sobre color, rugosidad, metal y barniz) y
`render/texture-preview.ts` (caché por imagen, mipmaps, anisotropía del
dispositivo). **Contrato RSB para M2b** escrito en `ARCHITECTURE.md` §5.2
(`IMGS`; bloque de texturas de `MATL` desde el byte 100, tras los campos de
E6 y E9; UV en `MESH`) e implementado en `io/rsb.ts` detrás de
`SceneView.textures`; apagado, los bytes de cualquier escena son los de
antes (test), y los píxeles los decodifica `io/texture-pixels.ts`. Tests:
`textures`, `textures-import`, `textures-project`, `textures-rsb`,
`texture-shader`, `textures-ui` (62 casos, cada uno roto a propósito:
46 mutaciones, todas fallan); `tools/textures-check.mjs` en Chromium: el GLB
de los cuatro mapas, un Collada con su imagen al lado, la caja con
proyección caja, la etiqueta en el frasco, el cromo acromático en los dos
temas. Capturas `docs/ui/textures-fast.png` (junto a
`docs/ui/textures-reference.png`, el mismo archivo con el `GLTFLoader` y
`MeshStandardMaterial` de three.js, el visor sobre el que están hechos
casi todos: mismos cuadrantes, flechas derechas, crestas del mapa de
normales, anillo de emisión y esquina recortada; la cara de arriba se ve
algo más blanda por el ángulo de la cámara, no por el filtrado: con
anisotropía 8 y 16 los píxeles son idénticos, con 1 cambian),
`docs/ui/box-projection.png`, `docs/ui/label-placed.png`,
`docs/ui/textures-inspector.png`.

No encajó con el plan: (1) la comparación con un visor glTF de referencia
es a ojo, no por tolerancia de píxeles (las cámaras y los entornos no son
los mismos). (2) *Mover etiqueta* no usa el *gizmo* de *Mover*: arrastra la
etiqueta por la superficie bajo el cursor (una etiqueta vive en la
superficie; un *gizmo* 3D la sacaría de ella). (3) El inspector edita solo
el mapeado común; el mapeado propio de una ranura viene de los archivos y
se puede devolver al común (*Usar el común*); el *store* ya admite editarlo
(`texture/setMapping` con `slot`). (4) Las esferas de los materiales no
muestran las texturas (su renderizador es aparte). (5) La emisión existe
solo por su ranura: un glTF con `emissiveFactor` y sin textura no emite,
como antes (la familia `SIMPLE` no tiene campo de emisión). (6) En Rápido,
un recorte de alfa y las etiquetas no recortan las sombras del mapa de
sombras de three; dibuja seis etiquetas por material (cada una es un
*sampler*), el motor todas. (7) three aplica su transformación de textura
como escala tras giro y nosotros giro tras escala: igual con repetición
uniforme o sin giro; en FBX, Collada y USD con giro y repetición desigual
es una aproximación (glTF se convierte exacto). (8) Imágenes WebP o KTX2 de
un glTF se dejan fuera con su aviso; las de los cargadores de three que no
son PNG ni JPEG (TGA de FBX, y las de un USDZ, cuyos *blobs* el cargador ya
ha liberado) se pasan a PNG en el navegador; en Node no hay con qué y esos
formatos no traen texturas (sí glTF y OBJ). (9) Encender el escritor de
texturas queda para M2b: propuesto `rt_features` (bit 0) en `rt.wasm` y en
`/api/info`, y `decodeTexturePixels` antes de escribir la escena; sin
FBX con textura en los *fixtures*, el camino de los cargadores de three se
prueba en el navegador con un Collada y su imagen (el mismo código).

## M2b · Texturas y etiquetas en el motor — **Opus** (tras E6 y E9) — hecha

**Qué.** `rt-core` lee `IMGS` y el mapeado de `MATL`: muestreo bilineal
con mipmaps por diferenciales de rayo (Igehy 1999, escrito desde el
artículo; en los rebotes, el ancho del cono del camino), proyecciones
caja (mezcla por normal), plana, cilíndrica, esférica y UV; mapa de
normales (espacio tangente, con tangentes por UV o por proyección),
relieve compuesto con el bisel de E6 y el terminador; alfa como recorte
(ya existe la ruta); etiquetas como capa sobre el sustrato (alfa
suaviza; acabado propio de la capa). Todo determinista en wasm y
nativo. Cuesta lo que cuesta: medirlo. Con la opacidad por punto del alfa,
la malla técnica de E6 (un tafetán abierto, sin agujeros) puede tenerlos.

**Criterio.** Paridad wasm y *hashes* nuevos fijados; una esfera con
textura de cuadros y una caja con proyección caja renderizadas por `rt`
coinciden con la vista previa Rápido en posición de la textura
(comparación por regiones); la etiqueta del criterio de M2a renderiza
en su sitio en Completo.

**Hecho.** Módulo nuevo `rt_core::texture` (ARCHITECTURE §5.2 decies):
`image` (la imagen de `IMGS` como bytes en su codificación, sus *mipmaps* al
leer la escena —caja en lineal, pesos fraccionarios en lados impares, de
vuelta a bytes sRGB por la entrada más cercana de la tabla—, la lectura del
`TEX` de M3a en cualquier nivel, trilineal y el nivel de detalle `log2` del eje
mayor de la huella), `mapping` (las cinco proyecciones de `core/textures.ts`
en `f32` con sus gradientes de superficie exactos, y las etiquetas) y `shade`
(`TextureSetup` por instancia, la huella: diferenciales de Igehy de la cámara
estenopeica en el primer impacto y el ancho del cono del camino después, a
`FOOTPRINT_SCALE` = ¼ de píxel; las seis ranuras, el mapa de normales en el
marco de `∇u`, `∇v` como el de Schüler de *Rápido*, cada eje de la caja en el
suyo, el de alturas por diferencias centradas de un téxel, las etiquetas en
orden con su acabado y el relieve de su borde). **RSB**: `IMGS`, el bloque de
`MATL` desde el byte 100 y las UV de `MESH`, en el lector y en el escritor de
`rt-core` (los bytes del TypeScript: `tests/fixtures/m2b.rsb` ida y vuelta), con
sus validaciones; las imágenes viajan con las mallas en una actualización; un
fichero sin datos de textura se lee como antes. **Integrador**: el material con
texturas en cada impacto de cámara o de BSDF, tras el bisel y el dibujo de E6;
la emisión de una imagen se suma (un emisor la toma en su radiancia); el
recorte y la opacidad por punto los ven la cámara y los rayos de sombra (una
instancia con alfa es atravesable); el pase de albedo con texturas; un emisor
con imagen no se muestrea como luz (`light.rs`, una condición). Cambios pequeños en
`walk` y `shadow_from_exit` (dos líneas cada uno: el material de un recorte o
de una pared fina que cruza un rayo de sombra, con sus texturas, nivel 0).
**La palabra del motor**: `rt_core::FEATURES` (bit 0, `FEATURE_TEXTURES`),
`rt_features` en `rt.wasm`, `features` en `/api/info`; el *pool*
(`Pool.features`, del mensaje `ready` del *worker*) y `NativeEngine` ponen
`textures: true` en las vistas de *Completo* y de *Render*
(`render/engine.ts` `readsTextures`), y `main.ts` decodifica las imágenes antes
de escribir la escena (al cambiar los materiales, rehace la del visor cuando
llegan píxeles nuevos; antes de cada render; *Exportar escena del motor* las
lleva). La nota del inspector deja el *próximamente*. **Ejemplo y fijados**:
`rt_core::example::m2b_scene` (`rt --write-m2b-example`): suelo con cuadros por
proyección plana (minificados: sus *mipmaps*), caja girada con cuadros y mapa
de normales por caja y etiqueta con borde, bola con cuadros esféricos y
rugosidad y metal de unas bandas, frasco con bandas cilíndricas en espejo y una
etiqueta envuelta, tarjeta con agujeros recortados, aro de emisión por el
segundo juego de UV y mapa de alturas, y un emisor teñido por una imagen. Fijados
**nuevos** (ninguno se movió): `PINNED_M2B_TEXTURES_4SPP` **`0x5d94b21c`**
(todas las ISA, WASI, `rt-cli` y `rt-app` con 1, 4 y 16 hilos, el `rt.wasm` real
en CI y por el código de la página) y sus seis pases `PINNED_M2B_PASS_*` (albedo
`0x478bfcc8`, normal `0xc1491d6a`, profundidad `0x30474c2a`, ids `0xb4c6eb60`,
círculo de confusión `0x6ad58dc5`), con su bloque de paridad en `engine.yml`.
**Tests** (cada uno falla sin lo que prueba): 18 de `rt-core` en
`texture/tests.rs` (las proyecciones y las etiquetas contra
`tests/fixtures/texture-mapping.json`, que `tests/texture-mapping.test.ts` fija
contra `core/textures.ts`: 810 casos de proyección y 48 de etiqueta; los
gradientes contra diferencias finitas; *mipmaps*, lecturas, bordes y v arriba;
el nivel de detalle y la huella de la cámara; el marco del mapa de normales con
UV, UV giradas, plana y caja; el mapa de alturas; color, rugosidad, metal, alfa
y emisión, y el emisor que deja de ser luz; el recorte y la cobertura, también
para los rayos de sombra; las etiquetas en orden y su borde; la ida y vuelta
RSB, los ficheros viejos y los bloques malos, las actualizaciones; un bloque
vacío y las UV no cambian un píxel; las mismas cifras en cada ruta SIMD), el
fijado y los pases, los hilos en `rt-cli` y `rt-app`, `features` en
`/api/info`; en TypeScript `tests/textures-engine.test.ts` (el interruptor con
un motor que lee texturas y con uno de antes, los bytes de `m2b.rsb`, el
`rt.wasm` real: `rt_features`, el mensaje `ready` del propio *worker* del
*pool* con sus `features`, el fijado por el código de la página, una escena del
proyecto con y sin texturas) y la **comparación por regiones**
`tests/textures-full-browser.test.ts`: *Rápido* en Chromium y el `rt.wasm` con
el escritor de la página pintan la misma escena a 240 × 160 (24 muestras) y se
clasifica cada píxel por su tono. Esfera con cuadros por sus UV y caja girada
30° con proyección caja: de 1722 píxeles lejos de los bordes de casilla en los
dos, coinciden **el 100 %**; con la imagen del motor movida una casilla, **el
0 %**. La etiqueta del frasco del criterio de M2a: intersección sobre unión
**0,989** (364 píxeles). Cada test se comprobó a mano contra su fallo: 25
mutaciones del motor (cada proyección, la v, los bordes, los *mipmaps*, el
nivel de detalle, la huella, el marco y el signo del relieve, el recorte, la
capa de las etiquetas y su borde, la emisión y el emisor como luz, las sombras,
el material del integrador, el albedo, el lector RSB y sus actualizaciones) y 8
de la página (el interruptor, el *pool*, el *worker*, el escritor, las
referencias de proyección y de etiqueta) ponen cada una su test en rojo.
**Coste** (`rt` nativo, AVX2, máquina compartida,
rondas alternadas; la escena M2b, con texturas en todo, el suelo incluido,
contra la misma sin `IMGS`, sin bloques y sin UV):

| Medida | Con texturas | Sin texturas | Diferencia |
| --- | --- | --- | --- |
| 1 hilo, 320 × 240, 16 muestras, 6 rondas (mediana) | 2,48 s (1,64 Mrayos/s) | 2,08 s (2,00 Mrayos/s) | +19 % de tiempo, +22 % por rayo |
| 4 hilos, 640 × 480, 64 muestras, 5 rondas (mediana) | 13,69 s (4,76 Mrayos/s) | 11,77 s (5,65 Mrayos/s) | +16 % de tiempo, +19 % por rayo |
| La escena sin texturas, motor de antes (`09d8196`) y de M2b, 1 hilo, 6 rondas | 2,13 s (M2b) | 2,11 s (antes) | +1 %, ruido; el mismo PNG byte a byte |

No encajó con el plan: (1) La huella es **un cuarto de píxel** y no uno: el
trazador ya integra el píxel con sus muestras, y con la huella entera la
textura saldría el doble de blanda que en *Rápido*; con un cuarto, la nitidez
es la de su muestra trilineal y anisótropa (a costa de algo de ruido con pocas
muestras en lo minificado). (2) Los diferenciales de la cámara son los de su
estenopo también con lente fina, O1 u O2 (en el plano de foco cambian igual;
fuera, la lente ya emborrona), y el cono de los rebotes no tiene término de
curvatura ni de rugosidad (más fino de lo ideal; el camino lo promedia). El
filtrado es isótropo (el eje mayor; el cuarto de píxel absorbe hasta 4:1). (3)
El mapa de alturas y el borde del papel derivan por diferencias de un téxel del
nivel leído, no de un píxel de pantalla como *Rápido*: de cerca, el borde de
una etiqueta es una cresta más fina que la de *Rápido*. (4) Una etiqueta **quita
transmisión** (el papel es opaco: sobre vidrio no se ve a través); *Rápido* no
lo hace. Sobre un emisor, una etiqueta tapa su luz pero no refleja (un emisor
no tiene BSDF). (5) Un emisor cuya imagen cambia su luz **no se muestrea como
luz** (sin sesgo, con más ruido en lo que ilumina); los fotones de las
cáusticas ven los materiales sin texturas, como los dibujos de E6. (6) El pase
de normales es el del bisel, sin el mapa de normales ni el relieve (como con
los dibujos de E6); el de albedo sí lleva las texturas. (7) El lector es
estricto con el bloque de texturas (un código fuera de rango o un índice de
imagen que no está hacen el RSB inválido, como `LENS`); el contrato no decía
nada. (8) La malla técnica de E6: la opacidad por punto existe (el alfa de una
imagen recorta, y los rayos de sombra lo ven), pero la tela procedural no da
aún agujeros propios: cuánto abrir el tafetán es una receta y un criterio
visual (regla 11), anotado para el responsable; con una imagen de alfa ya se
puede. (9) **Tamaño**: sigue en mm, como en M2a; si debe seguir al del sólido
es la decisión pendiente de `TRIAGE.md` 5.1 (no se toma aquí). (10) Los
materiales de nodos siguen con la media de sus salidas hasta M3b; una ranura
de imagen propia de uno de ellos se pinta encima, como en *Rápido*. (11) La
comparación por regiones necesita Chromium y `rt.wasm`: se salta en el trabajo
del motor de CI; su mitad de Node (`textures-engine.test.ts`) va en el paso
*Passes through the page's own code* con el `rt.wasm` real. (12) Cada
*worker* guarda su copia de las imágenes y de sus *mipmaps* (un tercio más),
como de las mallas.

## M3a · Editor de materiales por nodos: modelo, editor y vista previa — **Opus** (tras U11) — hecha

**Qué.** Un **grafo de material** como el de KeyShot o Blender,
reducido a lo que nuestro motor puede evaluar: nodos *Salida de
material* (las entradas del material: color base, metal, rugosidad,
anisotropía, barniz, transmisión, IOR, absorción, dispersión interna
(E9), emisión, opacidad, normal, relieve, bisel), *Textura de imagen*,
*Mapeado* (proyecciones de M2a), *Ruido* (Perlin/simplex de E6, con
escala y octavas), *Degradado*, *Cuadros*, *Rayas*, *Rampa de color*,
*Mezcla*, *Matemática* (suma, producto, potencia, mínimo, máximo,
suavizado, valor absoluto), *Fresnel / peso de capa*, *Curvatura*
(aristas, de E7), *Valor*, *Color*, *Separar/Combinar RGB*, *Invertir*,
*Mapa de normales*, *Relieve*. Modelo en `src/core/material-graph.ts`
(DAG tipado: tomas de tipo color, float, vector, normal; conversiones
implícitas documentadas), serializado en el proyecto (esquema con
versión), deshacible nodo a nodo y conexión a conexión por el *store*.
**Compilación a programa**: el grafo se compila a un programa lineal
(*bytecode*: registros `f32` y `vec3`, instrucciones con códigos
estables, lecturas de imagen) que es el contrato con el motor (M3b);
`ARCHITECTURE.md` lo documenta instrucción a instrucción; límite de
tamaño y un test que un grafo de 30 nodos compila en < 1 ms. **Editor**:
una ventana *Editor de material* (como la de render), lienzo con zoom y
desplazamiento, nodos arrastrables, tomas con tipos y colores
acromáticos por tipo (forma, no color), conexiones por arrastre con
validación de tipo, menú *Añadir nodo* con búsqueda, vista previa
pequeña en cada nodo (evaluación en CPU sobre una esfera 64 × 64 en un
*worker*, con el mismo intérprete que la vista previa), *Simple ↔ Nodos*
(un material de parámetros se convierte en su grafo mínimo; volver a
*Simple* solo si el grafo es el mínimo, si no, pregunta). **Vista
previa Rápido**: un intérprete del programa en TypeScript evalúa el
grafo en una textura de 512² por proyección (UV o triplanar) en un
*worker* y la entrega a three.js como mapas; lo que no cabe en mapas
(Fresnel, curvatura) se aproxima o se omite, y se dice. Atajos, tour,
cadena `es`/`en`.

**Depende de.** M2a, E6 (ruido), U11 (máquina).

**Criterio.** Diez grafos de ejemplo (`src/data/material-graphs.ts`:
plástico con etiqueta, metal cepillado con arañazos por ruido, mármol,
cuero, madera con dos ruidos, vidrio con suciedad por Fresnel, cuadros,
pintura metalizada con copos (ruido fino en la normal), cerámica con
esmalte (barniz por rampa), rayas) compilan y se ven en Rápido; un grafo
guardado abre idéntico; deshacer y rehacer de 50 ediciones devuelve el
grafo original (test); el intérprete TS y el de referencia del contrato
(un pequeño evaluador en Rust de prueba en M3b) dan los mismos valores
en 1000 puntos aleatorios (test cruzado cuando M3b llegue).

**Hecho.** **Modelo** en `src/core/material-graph.ts`: un material en modo
*Nodos* lleva `graph` (versión 1), un DAG de nodos del catálogo
`src/data/material-nodes.ts` (19 tipos, claves estables, `es`/`en`) con
tomas de cuatro tipos y las conversiones implícitas de la tabla (una normal
solo sale de una normal); acciones `graph/*` (añadir, quitar, mover,
duplicar, conectar, desconectar, parámetro, valor, grafo entero, Simple ↔
Nodos), deshacibles, una entrada cada una, ninguna si nada cambia o la
conexión se rechaza; *Simple → Nodos* da el grafo mínimo (la salida con
los valores del material) sin tocar sus parámetros, y *Nodos → Simple* es
exacto si el grafo es mínimo con valores que una familia guarda, si no
pregunta y se queda con los de la salida; el grafo en el proyecto
(`normalizeGraph`) y en la biblioteca (sin imágenes), sus imágenes en el
bloque `images`. **Ruido** en `src/core/noise.ts`: Perlin 2002 y símplex
(Gustavson 2005) con un *hash* de esquina (primos de Teschner, Knuth,
`lowbias32` de Wellons) en vez de la tabla, y suma en octavas, en f32.
**Compilador** (`src/core/material-program.ts`): programa lineal de
registros f32 y vec3 empaquetados por última lectura, instrucciones de seis
palabras con códigos estables, constantes, tabla de imágenes, quince
salidas, relieve por tres evaluaciones de la altura, límites con su
motivo, forma en bytes; **intérprete de referencia**
(`src/core/material-interp.ts`) en f32 sobre `core/f32math.ts` (las mismas
funciones elementales que `rt_core::fmath`); todo escrito instrucción a
instrucción en `ARCHITECTURE.md` §5.2 quater junto con el ruido, el
muestreo de imagen y los puntos de la prueba cruzada. **Editor**
(`src/ui/panels/material-editor.ts`, `graph-canvas.ts`,
`src/ui/graph-commands.ts`; `UI.md` §2.10): ventana flotante sin atenuar el
visor, movible, redimensionable, con sitio y tamaño recordados; lienzo con
zoom y desplazamiento, tarjetas arrastrables con su esfera de 64 × 64
(calculada en un *worker*, `render/graph-worker.ts`), tomas con forma por
tipo, conexión por arrastre con validación y su motivo, mover una conexión
de entrada, *Añadir nodo* con búsqueda, selección por clic y recuadro,
menús contextuales, panel del nodo (parámetros, imagen, rampa, entradas),
*Ejemplos*, atajos, `Simple · Nodos` y *Nodos…* en el inspector, *Editar
con nodos…* en el menú de la pieza, la paleta y un paso del recorrido.
**Rápido** (`src/core/material-preview.ts`, `render/graph-preview.ts`,
`render/graph-client.ts`): mapas de 512² (antes 128²) evaluados por bandas
en varios *workers*, sobre el cuadrado UV, la superficie de la proyección
(exacto: test) o un corte frontal dibujado como caja, que entran por las
ranuras de M2a como `DataTexture`; Fresnel a 60°, curvatura 0 y las salidas
sin ranura con su media, dicho en el inspector y el editor. *Completo*
recibe la media de cada salida (`flattenGraph`) y lo dice. **Diez
ejemplos** en `src/data/material-graphs.ts`. Tests:
`material-graph`, `material-program`, `material-preview`,
`material-nodes-ui` (50 casos; 43 mutaciones reintroducidas, todas fallan);
`tools/material-nodes-check.mjs` en Chromium (abrir, añadir con búsqueda,
conexión rechazada y hecha, el visor cambia, deshacer, teclas, ejemplo,
cromo acromático en los dos temas). Capturas `docs/ui/material-nodes.png`
y `docs/ui/material-nodes-preview.png`.

No encajó con el plan: (1) **la etiqueta** del plástico con etiqueta es un
nodo *Textura de imagen* con una imagen dibujada por el código
(`core/material-examples.ts`) y mapeado cilíndrico (en el frasco de
ejemplo cae bajo su propia pieza *Etiqueta* de papel, que cubre el frente;
en cualquier otra pieza se ve); las etiquetas de M2a
siguen siendo del material (se colocan en el visor) y en los dos modos se
ponen sobre lo que da el grafo, como las ranuras de M2a, que multiplican
sus salidas. (2) **La caja** en un programa toma la cara a la que más mira
la normal (un punto no puede mezclar tres evaluaciones); *Rápido* sí mezcla
por |n|⁴ como M2a, y lo dice. (3) **Lo 3D en Rápido** es un corte por el
frente de la pieza dibujado como caja (un mapa 2D no puede ser un ruido
3D): las vetas en anillo de la madera se ven bien por los lados de una
pieza vertical, no arriba; las tres caras con tres cortes quedan para
cuando haga falta (más *samplers*). (4) La **absorción** de la salida es un
parámetro del material (distancia, como el vidrio), no una entrada por
punto; el **bisel** de la salida es un peso del radio de bisel del
material, que sigue siendo uno (lo mira el Doctor). (5) **Curvatura**: la
referencia da 0 (la mide el motor en M3b, de E7 o del bisel); el ruido de
E6 aún no existía y se escribió aquí, de las fuentes públicas, como
contrato para Rust. (6) Lo que lee los parámetros del material (el Doctor,
las esferas del catálogo) ve en *Nodos* los de su familia o la media del
grafo: las miniaturas usan la media; el Doctor, los parámetros. (7) Hay
**tres ventanas** (render, Ajustes, editor de material): `UI.md` §4.3 y la línea
del `README` se actualizan; el editor no es modal. (8) Los colores de este paso son los de
`MATERIAL_GRAPHS`, de criterio propio: un vistazo **Fable** a los diez
ejemplos (sobre todo mármol y madera) queda pendiente.

**Veredicto del responsable** (14-10, con `docs/ui/material-nodes.png` y
`material-nodes-preview.png`). El mármol del ejemplo está bien (vetas grises
finas sobre blanco, escala creíble sobre el frasco): se queda. La madera no se
juzga aquí: cuando E6 entre con su madera procedural (vetas, nudos a 45°),
el ejemplo de madera de `MATERIAL_GRAPHS` tiene que dar el mismo aspecto que
la familia *Madera* del catálogo con sus mismos mandos, y eso lo mira M3b al
conectar el motor. Lo demás de «no encajó» (1–7, 9): aceptado como está; el
contrato `PROG` del RSB se escribe en M3b sobre el programa lineal de §5.2
quater, no antes. Los trailers de los *commits* de esta fase se reescribieron
al fusionar (misma autoría, la línea requerida por la sesión).

## M3b · El motor evalúa grafos — **Opus** (tras M2b y M3a) — hecha

**Qué.** `rt-core` ejecuta el programa de M3a en cada impacto (un
intérprete sin asignación en el bucle, registros en pila fija, `f32`,
determinista; lecturas de imagen por M2b; ruido de E6; curvatura de E7
o, si no ha llegado, una aproximación por el bisel). El material
resuelto en el impacto alimenta el BSDF de E9. Coste medido en el PR.

**Criterio.** Los diez grafos de M3a renderizados con `rt` coinciden con
la vista previa Rápido en posición y tono (regiones); test cruzado
TS/Rust de M3a en verde; paridad wasm.

**Hecho.** Módulo nuevo `rt_core::program` (ARCHITECTURE §5.2 undecies): el
contrato de §5.2 quater en Rust (`program.rs`: los códigos estables, las formas
de las instrucciones, los límites, la lectura de los bytes de `encodeProgram`
con todas sus comprobaciones —cada operando escrito antes de leerse, ningún
destino igual a un operando, índices, constantes finitas, rampas de 1 a 64
paradas— y la escritura), el intérprete (`program/interp.rs`: archivos de
registros en pila de tamaño fijo, 256 `f32` y 256 `vec3`, ni una asignación en
la ejecución —test—, `f32` sin FMA con las funciones de `fmath`, cada
instrucción como la referencia de TypeScript), el ruido de M3a
(`program/noise.rs`: Perlin y símplex con el *hash* de esquina y la suma en
octavas, con el redondeo de `Math.round` y las semillas de `ToUint32` de
JavaScript), lo que hace un programa en un impacto (`program/shade.rs`) y un
escritor de programas a mano para el motor (`program/build.rs`). **El punto**:
P, N, UV0, UV1, I, T, B y el cambio de las UV por T y B, en el espacio de la
pieza (la malla; la transformación de la instancia lleva el punto, los vectores
y la normal); N es la sombreada (con el bisel), vuelta al exterior de la pieza,
y la normal del programa vuelve al mundo y al lado del rayo, nunca de espaldas
al que mira (como M2b). **El material**: el `MATL` (que la página llena con la
media de cada salida, su familia, su absorción y sus paredes finas) con cada
salida del punto llevada a su rango (lo que no es un número deja el del
fichero); la dispersión interna no se lee. **Imágenes**: la lectura de M2b en
el nivel de detalle de la huella del rayo; las lecturas de una imagen por el
mismo `MAP` (o por un mismo juego de UV, o pasos desde él) toman el nivel de la
primera, así que las tres alturas de un relieve se leen en un nivel; unas
coordenadas calculadas de otra forma, en el nivel 0; los rayos de sombra, en
el 0. **Curvatura** (`EDGE`, `CAVITY`): de las aristas vivas del bisel de E6
(E7 no ha llegado): `smoothstep(1 − d/r) · min(tan(θ/2), 1)` de la arista más
fuerte a menos de `r` mm, convexa o cóncava. **Bisel**: la salida es un peso
del radio del material: constante, lo escala para toda la pieza; calculado, el
programa corre dos veces (en el punto sin biselar para el peso, y en el punto
biselado por él para lo demás). **Emisión**: un emisor (`MATL` de tipo 2) manda
`emisión × intensidad` del punto; otro material la suma a lo que refleja; un
emisor cuya emisión no es una constante del programa no se muestrea como luz
(`light.rs`), y la página lo escribe como no emisor (refleja y suma su
emisión). **Recortes**: una opacidad que no es la constante 1 hace la instancia
atravesable; la cámara, los rayos de sombra (también desde las salidas de un
medio y por el cruce recto de S4b) y el pase de albedo leen el programa.
**Integrador**: bisel → programa → texturas de M2b encima (multiplican lo que
da el programa, como a un material plano); un material con programa no lleva
el dibujo de E6. **RSB**: sección `PROG` (`u32 material` y los bytes del
programa, una por material, tras todas las demás; la primera de un material
cuenta; una versión más nueva se salta y el material queda con su `MATL`; un
programa inválido, de un material que no está o con una imagen que no es de
`IMGS` en su espacio de color hace el RSB inválido), en el lector y en el
escritor de `rt-core` y en `src/io/rsb.ts`; un fichero sin `PROG` se lee y se
escribe como antes. **La palabra del motor**: `FEATURE_PROGRAMS` (bit 1 de
`rt_core::FEATURES`, `rt_features`, `features` de `/api/info`); la página
(`render/engine.ts` `readsPrograms`, que pide también el bit 0: un programa lee
`IMGS` y las UV) pone `programs: true` en las vistas de *Completo* y de
*Render* del *pool* y del lanzador, y *Exportar escena del motor* las lleva;
`projectScene` escribe entonces cada material de nodos como su programa sobre
su media (con las UV de las mallas y las imágenes de los programas); a un motor
de antes, la media de cada salida (`flattenGraph`), como hasta ahora. La nota
del inspector y del editor (`ge.full.note`) dice lo que hacen *Completo* y
*Render*. **Ejemplo y fijados**: `rt_core::example::m3b_scene`
(`rt --write-m3b-example`, `tests/fixtures/m3b.rsb`): siete programas a mano
sobre la escena de M2b (mármol de ruido y rampa en el suelo; cuadros gastados
por `EDGE` con un bisel de peso 0,5; cuero con relieve por tres evaluaciones;
una etiqueta por `TEX` de una imagen con un peso de bisel calculado; una
tarjeta de rayas recortada con copos de `NOISEC` y `NMAP`; un emisor a
cuadros; un vidrio fino con suciedad por `FACING` y `FRESNEL`). Fijados
**nuevos** (ninguno anterior se movió): `PINNED_M3B_PROGRAMS_4SPP`
**`0x0d6e20ba`** (todas las ISA, WASI, `rt-cli` y `rt-app` con 1, 4 y 16 hilos,
el `rt.wasm` real en CI y por el código de la página), sus seis pases
`PINNED_M3B_PASS_*` (albedo `0xa0543b58`, normal `0xc28ef77c`, profundidad
`0x8f3d03ed`, ids de pieza y de material `0xa67fd1e5`, círculo de confusión
`0x6ad58dc5`) con su bloque de paridad en `engine.yml`, y los valores de los
siete programas en 1000 puntos (`PINNED_M3B_PROGRAM_VALUES`, que la página
reproduce: la prueba cruzada al revés). Captura `docs/ui/m3b-graphs.png`: los
diez ejemplos en *Completo*, con su media (izquierda, lo de antes) y con su
programa (derecha).

**Prueba cruzada** (`tests/material-program-cross.test.ts` escribe y fija
`tests/fixtures/material-programs.json`; `rt-core` `program/tests.rs` lo
corre): 172 casos —los diez ejemplos en los 1000 puntos de `contractPoints`
(con los fijados de M3a), 102 de cada instrucción sola en cada modo,
proyección, eje y borde en 200 puntos, y 60 de cada función con 0, −0, ±1,
medios, enteros, lo diminuto y lo enorme, ±∞ y NaN—: **los mismos bits en
todos** (tolerancia 0: los dos lados hacen las mismas operaciones `f32` en el
mismo orden con las mismas funciones elementales, sin FMA; un cambio de 0,25 a
0,24 en `FSMIN` pone 10 casos en rojo), con cada NaN contado como el NaN
silencioso `0x7FC00000` (`tests/program-hash.ts`, y lo mismo en Rust): el
signo y la carga de un NaN no los fija IEEE 754 ni WebAssembly, y en WASI un
caso (`FSMAX` con ±∞) dio un NaN del otro signo corriendo entre todos los tests
de `rt-core` y el de la referencia corriendo solo; el motor nunca lee esos bits
(una salida NaN deja el valor del fichero). Los 44 casos con algún NaN
cambiaron de *hash*; los diez ejemplos, no (son los fijados de M3a).

**Comparación por regiones** (`tests/programs-full-browser.test.ts`, con
`tests/browser/programs-scene.ts`): *Rápido* en Chromium (cada grafo horneado
por los *workers* de la app, una vista previa nueva por escena) y el `rt.wasm`
real por el escritor de la página, 200 × 150 a 32 muestras, cada grafo en una
pieza donde los mapas de *Rápido* son el grafo (una placa de frente cuya cara
es el plano y = 0 de la pieza, un cilindro para la etiqueta), en un mundo
blanco plano (el metal cepillado, bajo el estudio). Cada imagen se clasifica
por los tercios de su luminancia; *coinciden* es la parte de los píxeles
asentados (oscuros o claros, lejos de los bordes) en la misma clase en las dos;
el *control* renderiza el motor con el dibujo movido bajo la misma superficie
(las coordenadas de la pieza desplazadas o giradas, o media banda de UV); el
tono es el color medio de la pieza en las dos (valores de pantalla).

| Grafo | Comparado | Coinciden (píxeles asentados) | Control | Correlación (control) | Tono *Rápido* / *Completo* (distancia) |
| --- | --- | --- | --- | --- | --- |
| Material plano (referencia) | tono | — | — | — | 220 220 220 / 195 195 195 (25) |
| Plástico con etiqueta | sitio y tono | 100 % (2821) | 75 % | 0,996 (0,08) | 119 134 175 / 120 132 161 (14) |
| Metal cepillado | tono | 98 % (2938) | 98 % | 0,45 (0,43) | 166 165 165 / 128 128 129 (38) |
| Mármol | sitio y tono | 100 % (4707) | 29 % | 0,998 (−0,16) | 215 214 213 / 190 190 189 (25) |
| Cuero | sitio y tono | 100 % (3864) | 63 % | 0,997 (0,14) | 119 89 69 / 123 101 84 (15) |
| Madera con dos ruidos | sitio y tono | 100 % (602) | 39 % | 0,991 (0,02) | 174 144 111 / 158 137 112 (16) |
| Vidrio con suciedad | tono | 98 % (1273) | 99 % | 0,60 (0,68) | 100 100 100 / 130 131 130 (30) |
| Cuadros | sitio y tono | 100 % (4024) | 0 % | 0,996 (−0,97) | 154 154 155 / 146 146 146 (9) |
| Pintura con copos | sitio | 0 % (157) | 45 % | **−0,91** (−0,005) | 206 145 144 / 100 43 43 (106) |
| Cerámica esmaltada | sitio y tono | 100 % (5865) | 0 % | 0,999 (−0,91) | 173 191 180 / 155 170 162 (21) |
| Rayas | sitio y tono | 100 % (1695) | 0 % | 0,998 (−0,98) | 149 151 160 / 141 143 150 (10) |

Siete grafos coinciden en sitio (100 % de los píxeles asentados, correlación
0,99 o más, el control se hunde) y en tono (a 9–25 de *Rápido*, dentro de la
diferencia de los dos renderizadores con un material plano, 25: *Rápido* sale
más claro con cualquier material). El metal cepillado y el vidrio se comparan
por el tono (ver «no encajó» 6 y 7); los copos, por el sitio (8). Con los
programas apagados en el escritor (el motor con la media), los ocho tests de
sitio fallan.

**Tests** (cada uno falla sin lo que prueba): en `rt-core`, 7 de
`program/tests.rs` (la prueba cruzada y sus puntos, los fijados de M3a y del
ruido, los valores de los programas del ejemplo, la lectura y 15 formas de un
programa malo o de otra versión, una ejecución sin asignar ni depender de la anterior), 12 de
`program/scene_tests.rs` (los valores punto a punto en el espacio de la pieza;
las UV, la tangente, el cambio de las UV y la vista; la normal en el mundo, con
la instancia girada y por detrás; el recorte para la cámara y las sombras; la
emisión que se suma y el emisor que deja de ser luz; el peso del bisel
constante y calculado; la curvatura en el cubo y en el pliegue, también por un
programa; el nivel de detalle, el de un relieve y el de cada juego de UV; cada
valor a su rango; `PROG` de ida y vuelta, los ficheros viejos, la versión
nueva, los inválidos, la primera que cuenta y las actualizaciones; el dibujo
de E6 que cede y una escena sin programas que no cambia), uno en
`integrator/tests.rs` (los rayos de sombra desde las salidas de un medio por un
recorte de programa), el fijado y los pases, los hilos en `rt-cli` y `rt-app`,
`features` en `/api/info` y en `rt.wasm`; en TypeScript, la prueba cruzada (3: el fichero, los valores y que están
todos los códigos),
`tests/programs-engine.test.ts` (15: el interruptor con un motor que los corre,
uno de M2b y uno de antes, en el *pool* y en el lanzador, en *Render* y en el
visor; `PROG` al final sobre la media; las mismas cifras sin materiales de
nodos; el emisor que varía; la imagen de la etiqueta en sRGB; los bytes de
`m3b.rsb`; los valores del motor por el intérprete de la página; el `rt.wasm`
real: el fijado por el código de la página y un material de nodos que cambia
la imagen), la nota en `material-nodes-ui` y la comparación por regiones (11).
**Mutaciones**: 33 del motor (cada instrucción y el ruido, el nivel de detalle
y sus grupos, el espacio de la pieza, la tangente, las UV, la normal y su lado,
los recortes y las tres rutas de sombra, la emisión y el emisor como luz, el
peso del bisel constante y calculado, la curvatura convexa y cóncava, `EDGE`,
el lector `PROG`, el dibujo de E6, el albedo, la validación, los rangos, cada
juego de UV): 31 ponen su test en rojo; las otras dos eran equivalentes (la
radiancia del emisor ya es la emisión del programa; el giro de la normal de
sombra que el contexto vuelve a hacer, quitado del código). 12 de la página (el
interruptor y sus dos bits, el escritor, el material de `PROG`, el emisor que
varía, el espacio de color, las vistas del *pool* y del lanzador en *Render* y
en el visor, la nota): las 12 en rojo. La primera ronda dejó vivas 10 del
motor (8 de verdad) y 4 de la página: de ahí los tests nuevos.

**Coste** (`rt` nativo, AVX2, máquina compartida, rondas alternadas, medido
antes de fusionar v0.1.11; las diez piezas de los ejemplos —nueve cajas de
100 × 60 × 100 mm y el cilindro de la etiqueta— cada una con su grafo, el
estudio por defecto, escrita por la página con los programas y sin ellos, con
su media):

| Medida | Con programas | Con la media | Diferencia |
| --- | --- | --- | --- |
| 1 hilo, 320 × 240, 16 muestras, 6 rondas (mediana) | 1,91 s (1,85 Mrayos/s) | 1,30 s (2,73 Mrayos/s) | +47 % de tiempo, +47 % por rayo |
| 4 hilos, 640 × 480, 64 muestras, 5 rondas (mediana) | 7,27 s (7,76 Mrayos/s) | 5,17 s (10,96 Mrayos/s) | +41 % de tiempo, +41 % por rayo |
| La escena con la media, motor de antes (`3497ab5`) y de M3b, 1 hilo, 6 rondas | 1,30 s (M3b) | 1,27 s (antes) | +2 %, ruido; el mismo PNG byte a byte |

Todas las piezas llevan un programa (de 6 a 41 instrucciones: cuadros 6,
cerámica 9, rayas y copos 10, etiqueta 11, mármol 13, vidrio 18, madera 24,
cuero 34, metal cepillado 41; los ruidos de varias octavas son lo caro). Una
escena sin materiales de nodos no hace nada nuevo.

No encajó con el plan: (1) **`PROG`** no es la propuesta de §5.2 quater (una
sección con los programas de la escena y el índice de cada uno en `MATL`): es
una sección por material con su índice delante, al final del fichero; `MATL`
no cambia (un lector de antes ni lo nota, y el material de un programa que el
motor no lee sigue siendo su media), y una actualización lleva los programas
con los materiales. (2) **El ruido** es el de M3a (su contrato, escrito para
esto), no el de E6 (`pattern/noise.rs`, que es otro): la prueba cruzada lo pide
bit a bit. (3) **Curvatura**: de las aristas vivas del bisel (E7 no está); una
malla suave sin aristas vivas da 0, y el radio de `EDGE` es en mm de la pieza.
(4) **La dispersión interna** del grafo no se lee: el medio de E9 es del
volumen (recorrido libre, color, dirección), no de un punto; tampoco llega al
motor la de un material plano. La absorción y las paredes finas son las del
`MATL` (la página escribe las de la salida en los dos sitios). (5) **Un emisor
cuya emisión varía** no es luz muestreada: ilumina por los caminos que lo
encuentran (sin sesgo, con más ruido), como el de imagen de M2b; la página lo
escribe como no emisor (su media no emite) para que el motor de antes no
pinte una luz uniforme que no está. (6) **El metal cepillado**: su dibujo está
en la rugosidad y el relieve, que el mundo blanco no enseña; bajo el estudio
las luces de three.js y las trazadas difieren (correlación 0,45, tono a 38):
se compara por el tono. (7) **El vidrio con suciedad**: *Rápido* no tiene mapa
de transmisión (la transmisión es la media del grafo), y el polvo es sobre
todo menos transmisión: en *Rápido* casi no se ve y en *Completo* sí. Por el
tono. (8) **Los copos de la pintura metalizada**: el sitio coincide (correlación
−0,91: el mismo dibujo, el tono al revés), pero el `NORMAL_MAP` de M3a toma el
azul como `2b − 1` sin la intensidad, y el color de un ruido pone la mitad de
las normales hacia dentro de la superficie (el 49 % de los puntos de la placa);
el motor las dobla hasta el borde del lado que mira, como los mapas de normales
de M2b (salen oscuras), y three.js las ilumina con el mundo (salen claras).
**Decisión para Fable** (regla 11/12, el contrato es de M3a): que
`NORMAL_MAP` mezcle hacia la normal del mapa por la intensidad y la deje fuera
(como el de Blender), o que el ejemplo pase el ruido por un rango con el azul
cerca de 1, o que el motor refleje una normal de programa de espaldas en vez de
doblarla; las dos primeras cambian *Rápido* y *Completo* a la vez. Con el
ejemplo de hoy, los copos se ven más oscuros en *Completo* que en *Rápido*.
(9) **Nivel de detalle**: el de la huella de M2b para las lecturas por un
`MAP` o por un juego de UV (y sus pasos); unas coordenadas calculadas de otra
forma se leen en el nivel 0 (*Rápido* las filtra en sus mapas), y los rayos de
sombra también. (10) **Lo que no ve el programa**: las partículas (no tienen
material de nodos), los fotones de las cáusticas (ven el `MATL`, la media,
como ven los dibujos y las texturas) y el pase de normales (el del bisel, sin
la normal del programa, como M2b). (11) **Tono**: *Rápido* sale unas 25
unidades más claro en blancos con cualquier material (la referencia plana de
la tabla): es la diferencia de los dos renderizadores, no de los programas.
(12) **Observación sobre *Rápido*** (no tocada): una vista previa reutilizada
de una escena a otra en la prueba enseñaba los mapas del grafo anterior hasta
rehornear; con una vista previa por escena no pasa. No lo he reproducido en la
app; queda anotado para quien mire `render/graph-preview.ts`. (13) **La madera**
(lo que el veredicto de M3a dejó a M3b): `docs/ui/m3b-wood.png`, las dos en el
motor: a la izquierda la familia *Madera* del catálogo (roble, la veta de E6:
anillos finos y rectos, poros), a la derecha el ejemplo *Madera con dos
ruidos* (anillos anchos y ondulados alrededor del eje vertical de la pieza,
sin poros): no se parecen. Que se parezcan es una receta y un criterio visual
(**Fable**). **Nodos *Madera* y *Tela*** no se añaden (decisión pendiente,
TRIAGE 1.6). El intérprete los haría fáciles en el motor: una instrucción
`PATTERN` con las constantes de `PATN` (familia, colores, escala, los 16
parámetros, variante y semilla) que llame a `pattern.rs` en el punto de la
pieza por el `Host` (que ya da la curvatura; los nudos se colocan por
instancia como hoy) y dé color, rugosidad y altura (el relieve, con las tres
evaluaciones); lo grande es *Rápido* y la prueba cruzada: TypeScript no tiene
las recetas de E6 (pinta la madera con su color medio y los nudos), así que
haría falta portarlas a `f32` en TypeScript (fase L). (14) La comparación por
regiones necesita Chromium y `rt.wasm`: se salta en el trabajo del motor de
CI; su mitad de Node (`programs-engine.test.ts`) va en *Passes through the
page's own code* con el `rt.wasm` real. (15) La sombra desde la salida de un
medio por una superficie atravesable corre el programa dos veces (una para el
material de la pared y otra en el cruce recto de S4b), como las texturas.

## M4 · Capa de realismo en el catálogo de materiales — **Opus**, veredicto **Fable** (tras E9, E6 y M2b)

**Qué.** (1) **Motor**: Fresnel de conductor «*artist-friendly*» de
Gulbrandsen (2014) con reflectancia y *edge tint* (nuestros metales
hoy son F0 por color: les falta el tono del borde), los metales del
catálogo con pares (reflectancia, borde) sacados de la literatura
pública de índices de refracción (valores de tablas públicas de n, k
integrados por nosotros a RGB); rugosidad perceptual (`α = r²`) si no lo
es ya; *specular tint* para dieléctricos. (2) **Catálogo**: pasada sobre
todas las recetas con criterio físico y fotográfico: albedos reales
(el blanco del HDPE no es 1), IOR por tipo de vidrio y plástico, barniz
donde lo hay de verdad (plásticos brillantes, cerámica esmaltada,
madera barnizada), anisotropía en lo cepillado, **micro-bisel por
defecto** (0,2–0,5 mm según material) en todo lo duro, medio dispersor
(E9) en lo translúcido, **micro-variación** de rugosidad y de normal por
ruido fino (E6) a una escala que no se ve como textura pero quita el
«plástico de ordenador», y *imperfecciones sutiles* opcionales (E7
cuando llegue). Pendiente de E6 (veredicto de la tela): **el barniz ignora
el *bump* del dibujo** (hoy el relieve de la tela y de la madera inclina la
normal de toda la BSDF, barniz incluido; el barniz de verdad es plano sobre
el tejido o la veta): con eso el carbono puede volver a su relieve entero
(ahora 0,05) y la madera barnizada gana un reflejo limpio sobre sus poros. (3) Hoja `out/materials-sheet.html`: cada material
antes y después, sobre esfera y sobre el frasco, con el set `STRIP_EDGE`;
**veredicto de Fable** material a material antes de cerrar (regla 11).

**Criterio.** Ningún material cambia de clave; los proyectos antiguos
abren con las recetas nuevas (es lo que se quiere) salvo las instancias
editadas, que conservan sus valores; la hoja con el veredicto.

## Óptica: simulación de lentes — decisión **Fable** (tras v0.1.5)

`STUDIO-TOOLS.md` §1 y `docs/research/optics.md` dejaban seis
decisiones abiertas (§7). Se toman así:

1. **Carácter por defecto**: *Clínica* (pupila redonda, lente bien
   corregida). La foto de producto quiere una lente que no se note; el
   carácter se elige a propósito. De las 16 prescripciones se enseñan
   todas; las `verified` sin aviso, las `caveat` y `experimental` con una
   nota en la ayuda, y las `own-design` marcadas como diseño propio.
2. **Remolino**: las dos cosas. Sale solo de la Petzval trazada con sus
   semiaperturas reales, y en la lente fina hay un mando artístico
   marcado *no físico*.
3. **Aberración cromática**: el esquema híbrido de tres bandas (cada
   muestra de cámara elige R, G o B estratificado, traza la lente con el
   índice de esa banda y pesa solo su canal). Nada espectral.
4. **Ajuste de polinomios**: no se ajusta ningún polinomio de grado alto.
   El perfil rápido son tablas muestreadas en `f32` (distorsión e
   iluminación relativa por altura de imagen, puntos cardinales) sacadas
   de un trazado de pocos rayos al cargar la lente.
5. **Fantasmas del *flare***: no en esta primera entrega. Los *coatings*
   entran solo como transmisión por superficie (T-stop y tinte). Los
   fantasmas y la estrella de difracción quedan para O3.
6. **Nombres**: neutros, los del catálogo A6.

Y una regla de coste: la cámara trazada no puede pasar del 25 % del
tiempo de render del ejemplo a 1024 muestras con la doble Gauss (medido
y en el PR); si pasa, se bate por lotes (§6.1 del informe) antes de
cerrar.

## O1 · Lente fina mejorada y selector de bokeh — **Opus** — hecha

**Qué.** `STUDIO-TOOLS.md` §1 modo 1, en `rt-core` y en la interfaz.
Motor: sección RSB nueva opcional `LENS` después de `CAMR` (`CAMR` no
cambia: un RSB sin `LENS` renderiza bit a bit como hoy): forma del
diafragma (círculo; polígono de 3 a 18 láminas con redondez 0–1 y giro;
imagen de máscara monocroma con muestreo por CDF 2D), perfil de pupila
(uniforme, centro brillante, anillo brillante, apodizada: los pesos de
`src/data/bokeh.ts` `PUPIL_PROFILES`), obstrucción central (relación ε),
ojo de gato aproximado (intersección con un segundo disco desplazado en
proporción a la altura de imagen, con un mando de intensidad),
anamórfico (compresión horizontal de la pupila y desestiramiento de la
imagen, 1,33× y 2×), **descentramiento e inclinación** (*tilt-shift*:
desplazamiento del sensor en mm y plano de enfoque inclinado por
Scheimpflug, con el punto de enfoque en el centro), aberración cromática
por bandas (decisión 3: una banda por muestra, desplazamiento radial del
origen en pupila por banda, peso en su canal) y remolino como mando
artístico (giro y alargamiento de la pupila con la altura de imagen).
Las dimensiones aleatorias nuevas (banda, máscara) son dimensiones
*hash* más allá de la tabla Sobol, como los recortes: una escena sin
`LENS` no cambia ni un bit. El pase `coc` sigue siendo el de la lente
fina (anotarlo). **Interfaz**: en la sección *Cámara*, *Bokeh* con las
miniaturas de los 20 tipos de `src/data/bokeh.json` que se hacen con el
modo 1 (los que exigen lente trazada esperan a O2 y lo dicen), cada
miniatura **renderizada por el propio motor** (un núcleo de desenfoque:
puntos de luz desenfocados sobre negro, `tools/bokeh-thumbs.mjs` con
`rt`, determinista, hash fijado); *Láminas*, *Redondez*, *Giro*,
*Perfil*, *Obstrucción*, *Anamórfico*, *Inclinación* y *Desplazamiento*,
*Aberración cromática* y *Remolino* (estos dos marcados *no físico*) en
una subsección *Óptica avanzada*; el visor Rápido no dibuja profundidad
de campo (ya lo dice) y no cambia. Proyecto: campos opcionales de la
cámara; cámaras anteriores abren igual.

**Depende de.** A6, E5.

**Criterio.** El ejemplo sin `LENS` conserva `0x223515c3`; hoja
`out/bokeh-sheet.html`: la escena de puntos de luz con cada tipo, a 256
muestras, **con veredicto de Fable**; test: con 6 láminas la pupila
muestreada cae dentro del hexágono y fuera del círculo inscrito en la
proporción esperada (±1 %); el *tilt* mueve el plano de enfoque como
dice Scheimpflug (test geométrico con tres puntos); la máscara con
muestreo por CDF da la misma media que el muestreo por rechazo (±1 %);
determinismo 1/4/16 hilos y wasm.

**Hecho.**

- **Motor** (`rt-core/src/optics`, sección RSB nueva `LENS`, opcional,
  justo después de `CAMR`; `CAMR` no cambia). `Camera.lens:
  Option<Lens>`; `Camera::sample_ray` devuelve el rayo y un **peso de
  color** que la baldosa multiplica (`render::camera_sample_weighted`). La
  **pupila** se muestrea con su densidad exacta y sin rechazo
  (`optics::pupil`): disco por el mapa concéntrico con el radio remapeado
  por la inversa de la CDF del perfil en `s = ρ²` (raíces estables de una
  cuadrática; la apodizada con `fmath::exp`/`ln`), abanico de triángulos
  desde el centro para 3 a 18 láminas (rectas: N triángulos iguales; curvas:
  arcos de radio `apotema / redondez` tangentes a la arista en su mitad, 24
  cuerdas por lámina, la geometría de `tools/assets/aperture-masks.mjs`) con
  el perfil del calibre de la forma, y rejilla con CDF marginal y condicional
  para una máscara (sustituye al diafragma; gira con él) o una textura
  (multiplica la forma, dibujada con borde suavizado), con el perfil y la
  obstrucción dentro. La estratificación de Sobol llega a la pupila y el
  brillo no cambia. **Ojo de gato**: segundo disco de radio 1 desplazado
  `cats_eye × h` hacia el eje (h = 1 en `field_mm`, la esquina del
  encuadre); fuera de él la muestra pesa negro pero traza su rayo (la
  cobertura de un fondo transparente no cambia): es el viñeteo óptico que lo
  acompaña. **Anamórfico**: x de la pupila entre la compresión; la imagen,
  desestirada. **Descentramiento** en el rayo principal y **inclinación** por
  la regla de la bisagra (normal del plano de enfoque `f·forward + u·sin α·b`,
  por el punto de enfoque del eje; con el sensor a `f u / (u cos α − f)` se
  cumple también Scheimpflug), con la pupila en el plano de la lente girado.
  **Aberración cromática** (decisión 3) y **remolino** como ajustes
  artísticos. La única dimensión nueva, la banda, es `DIM_LENS_BAND =
  3 << 20` usada por `PixelSampler::strata`: cada tres muestras seguidas de
  un píxel son las tres bandas (el desfase, *hash* del píxel) y **comparten un
  punto de la pupila**, el índice `(i + desfase) / 3` de la secuencia de
  Sobol de la lente, así que cada banda recorre sus propios puntos en orden y
  los colores del interior de un disco coinciden (tras la hoja: antes cada
  banda tenía su punto y el interior salía salpicado de color). Una `LENS` neutra
  renderiza bit a bit como la lente fina; sin `LENS` no cambia ni un bit:
  ejemplo `0x223515c3`, E5 `0xbf8abd5b`, cielo de E5 `0x2fcb098a`, E5c
  `0x8bb09f6b`, cáusticas `0x55d60f2f` y *denoise* `0xab15f290` intactos.
  Escena de paridad `example::o1_scene` (todos los mandos a la vez y una
  textura de anillos de 48²; `rt --write-o1-example`, `tests/fixtures/o1.rsb`):
  `PINNED_O1_LENS_4SPP = 0x1439a1a8 (re-fijado tras E12)` en escalar, SSE2 y AVX2, en WASI
  (escalar y `simd128`), en el `rt_wasm.wasm` real (también con los pases
  intercalados; en CI), por el código de la página (`tests/optics.test.ts`)
  y con 1, 4 y 16 hilos (`rt-cli/tests`). El pase `coc` sigue siendo el de la
  lente fina redonda y sin inclinar (anotado en `passes.rs` y en
  ARCHITECTURE §5.2 ter); `render::centre_ray` respeta el descentramiento.
- **Interfaz.** `CameraState.optics` (opcional, `src/core/optics.ts`;
  cámaras anteriores sin él, la lente fina de siempre: el RSB de un proyecto
  de U2 sale byte a byte igual, test). *Cámara ▸ Bokeh*
  (`src/ui/panels/insp-lens.ts`): rejilla con los 20 tipos, 16 con su
  miniatura renderizada por el motor y los 4 que no hace el modo 1
  apagados con lo que esperan (lente trazada, O2; óptica de ondas,
  próximamente); variantes con su miniatura; mover un mando a mano dice *A
  medida*; *Disco sencillo*. *Óptica avanzada*: *Láminas* (0 diafragma
  redondo), *Redondez*, *Giro*, *Perfil* e *Intensidad*, *Obstrucción*, *Ojo
  de gato*, *Anamórfico*, *Inclinación* y su *Eje*, *Desplazamiento* H y V,
  y bajo **NO FÍSICO** *Aberración cromática* y *Remolino*. Todo por el
  *store*, una entrada de deshacer por gesto. Las imágenes de pupila las lee
  `src/io/aperture.ts` sin *canvas* (descodificador PNG propio, exacto en
  cualquier navegador) y las promedia 2 × 2 a 256²; `main.ts` las pide al
  cambiar el estado y reinicia el trazador cuando llegan (mientras, el
  diafragma de láminas). El visor Rápido no dibuja profundidad de campo,
  pero sí el **descentramiento** (la matriz de proyección: el encuadre del
  visor sigue siendo el del render). `tools/optics-check.mjs` lo recorre en
  el Chromium local (seis comprobaciones) y deja
  `docs/ui/camera-bokeh.png` y `docs/ui/camera-optics.png`.
- **Miniaturas** (`tools/bokeh-thumbs.mjs` con `rt`, escena de
  `tools/bokeh-scene.mjs`: un 85 mm a f/1,6 enfocado a 600 mm y doce luces de
  100 mm a 6 m en rejilla de 4 × 3, un quinto del disco de desenfoque,
  fondo negro, curva sRGB, 1024 muestras): 30 PNG en `public/thumbs/bokeh/`
  (16 tipos y sus variantes, 416 kB) con `index.json` (parámetros, *hash*
  del RSB y de los píxeles); `--check` las renderiza otra vez y compara. Un
  test exige que la escena de la herramienta escriba la misma `LENS` que la
  página para cada tipo, que las miniaturas estén al día con
  `bokeh.json` (*hash* del RSB), y con el `rt.wasm` real fija el *hash* de
  la del polígono curvo a 4 muestras (`0xfa8496aa`).
- **Hoja** `out/bokeh-sheet.html` (`node tools/bokeh-thumbs.mjs --sheet`):
  los 30 núcleos a 480 × 360 y 256 muestras con luces de un quinto del disco
  (el aspecto «convolucionado»), con su receta, y debajo, como pidió el
  veredicto, una fila de **núcleo puro** con luces de 32 mm (un quinceavo
  del disco, la radiancia escalada por la razón de áreas) a 512 muestras
  para las texturas (anillos de cebolla, polvo, rayas, malla), los flecos
  cromáticos y el disco de referencia. Las texturas **no se leen** en esa
  fila, ni subiendo la amplitud (los anillos de cebolla a 1 en vez de 0,45,
  probado: sale igual): sus detalles son menores que la fuente y casi del
  tamaño de un píxel (un periodo de los anillos, unos 4 px en un disco de
  90 px; la malla, unos 3 px; la fuente de un quinceavo, 6 px), y cada
  píxel acierta la luz en 1 de cada 225 muestras. Por eso **la amplitud se
  queda** (`onionAmplitude` 0,45, sin cambios) y la hoja añade una tercera
  fila de **primeros planos** (`CLOSE_UP` de `tools/bokeh-scene.mjs`): una
  sola luz que llena el encuadre (un 300 mm a f/5,6, la misma pupila de
  entrada; un disco de unos 320 px) de un cuarentavo del disco, a 1024
  muestras: los anillos (unos 14 px por periodo) se adivinan a través del
  grano; las rayas y la malla, apenas. Limpiarlo pediría del orden de
  50 000 muestras por píxel. **Veredicto**: la amplitud (0,45) y las
  recetas se quedan; el polvo, las rayas y la malla solo se leen en
  primeros planos de bokeh grande, como pasa con los filtros reales. Los **flecos cromáticos**, estratificados (arriba), se
  volvieron a renderizar a 256 muestras. **Veredicto del líder**: el juego de
  núcleos se acepta tal cual; se conservan las constantes del remolino
  (`SWIRL_COMPRESS` 0,35, `SWIRL_STRETCH` 0,25, `SWIRL_TURN` 0,6 rad) y de la
  aberración cromática; la sobreexposición del óvalo anamórfico es física y
  se queda (lo dice la ayuda del mando: el bokeh ovalado concentra más luz
  al mismo diafragma).
- **Tests** (cada uno comprobado reintroduciendo el error): 18 en
  `optics::tests` de rt-core: 6 láminas dentro del hexágono y fuera del
  círculo inscrito en la proporción esperada, `1 − π cos² 30° / (3 sen 60°)`
  ± 1 % (sin la raíz del radio, falla); láminas curvas dentro de sus arcos
  (extremos en el circunscrito, falla); los ocho perfiles con su media de
  `s` ± 0,5 % (signo de la raíz o 2σ² cambiados, fallan); obstrucción
  (olvidada, falla); Scheimpflug y bisagra con tres puntos, con cuatro
  inclinaciones y ejes (la normal con cos, la pupila girada al revés —
  sus puntos fuera del plano de la lente—, fallan); hacia el suelo con inclinación positiva (eje invertido, falla);
  descentramiento sin cambiar el plano (ignorado, falla) y lente neutra bit
  a bit (otro orden de operaciones, falla); anamórfico (multiplicar en vez de
  dividir, falla); ojo de gato con el área de dos discos ± 1 % (el doble de
  desplazamiento, falla); máscara por CDF con la media del rechazo ± 1 % en
  centroide y `E[r²]` (espejada, falla); textura dentro del diafragma y
  máscara que lo sustituye punto a punto; tres bandas por cada tres muestras
  (sin estratificar, falla), las tres bandas de un grupo con un solo punto de
  la pupila (sin compartirlo, falla) y bandas que suman blanco en una escena neutra
  sin obstrucción, exacto a 3 muestras y sin dominante a 256 (peso 2,9,
  falla); misma película en cada ruta SIMD y en cualquier orden de
  baldosas; `LENS` de ida y vuelta (sin relleno, falla); valores fuera de
  rango rechazados (dos láminas aceptadas, falla); *hash* de O1 (otra
  dimensión de banda, falla). `rt-cli`: 1/4/16 hilos con la lente.
  `tests/optics.test.ts` (14): óptica neutra sin `LENS` (una neutra que la
  escribe, falla), tipos que conservan inclinación y desplazamiento (un tipo
  que la borra, falla), normalización de un fichero, `o1.rsb` de ida y
  vuelta byte a byte con `rt`, campo del encuadre de salida y no de la
  imagen del visor (falla), máscara, textura y anillos con su amplitud
  (amplitud ignorada, falla), descodificador PNG y media 2 × 2 píxel a píxel
  (Paeth cambiado o sin redondeo, fallan), la herramienta y la página con la
  misma `LENS` (otro campo en la herramienta, falla), miniaturas al día (un
  valor de `bokeh.json` cambiado, falla), proyectos de U2 sin óptica y
  byte a byte iguales, óptica normalizada al abrir (sin normalizar, falla),
  y con el `rt.wasm` real el *hash* de O1 y el de la miniatura.

**No encajó con el plan.** (1) La **dimensión de máscara** no hizo
falta: la máscara se muestrea con las dos dimensiones de lente (fila con la
primera, columna con la segunda, la posición dentro del texel con lo que
sobra de cada una), que conserva la estratificación mejor que dos números
*hash*; la única dimensión nueva es la de la banda. (2) **La aberración
cromática** es, como pide la decisión 3, una banda por muestra con
desplazamiento radial de su origen en la pupila; para que lo enfocado siga
nítido el plano de enfoque es el mismo en las tres bandas, así que los
flecos (borde verde y núcleo magenta) salen igual delante y detrás del foco:
la inversión de color entre delante y detrás llega con la lente trazada (O2).
Los coeficientes (`CA_SCALE`, `CA_SHIFT`) y los del remolino
(`SWIRL_*`) son propuestas para el veredicto. (3) **El ojo de gato
oscurece** las esquinas (la muestra recortada pesa negro): es el viñeteo
óptico que lo acompaña en una lente real; si se prefiere sin él, haría falta
un muestreo de la intersección que no es exacto para polígonos ni máscaras.
(4) La **amplitud** `onionAmplitude` escala solo la textura de anillos de
cebolla (`1 − a + a·t`); las demás texturas (polvo, rayas, malla) se aplican
tal cual: con amplitud 0 no se verían. (5) Las **rayas del anamórfico**
(`streaks`) son del pase de *flare* y se guardan sin dibujarse; el *split
diopter* de STUDIO-TOOLS §1 no estaba en la fase. (6) Para que la hoja salga a
256 muestras sin ruido de sal y pimienta, cada luz mide un quinto del disco de
desenfoque: el núcleo sale convolucionado con ese disco (esquinas de los
polígonos algo redondeadas, texturas finas suavizadas). (7) El visor Rápido
muestra el **descentramiento** (cambia el encuadre, y el visor es el
render); la inclinación, como la profundidad de campo, solo en Completo.
(8) **Coste**, medido con la máquina muy cargada por otros agentes: la
muestra de cámara de la lente con todos los mandos (`example::busy_lens`:
textura, remolino, aberración cromática, ojo de gato, anamórfico,
inclinación y desplazamiento) cuesta de 0,4 a 0,6 µs más que la de la lente
fina (banco de 786 000 muestras de cámara, tres vueltas: 0,48–0,85 µs
frente a 0,88–1,07 µs), contra unos 26 µs por muestra del ejemplo a
512 × 384 con 8 hilos: del orden del 2 %. El tiempo de pared del ejemplo
con y sin lente (tres pares alternos: 34,0–58,1 s sin ella, 41,1–72,8 s
con ella) no separa esa diferencia del ruido de la carga; la lente cambia
además el encuadre (desplazamiento e inclinación) y con él los rayos que
se trazan (35,2 M frente a 33,6 M).

## O2 · Lente trazada — **Opus** (tras O1), veredicto **Fable** — hecha

**Qué.** `STUDIO-TOOLS.md` §1 modo 2, desde el artículo de Kolb,
Mitchell y Hanrahan (1995) y `docs/research/optics.md` §3, §5 y §6:
trazado secuencial desde el sensor por las superficies de una
prescripción de `src/data/lenses.json` (esfera, plano, asférica,
cilíndrica, espejo, diafragma) con la intersección estable de §6.5
(`t = c r² / (B + sqrt(B² − c² r²))`), solo `+ − × ÷ sqrt` (nada de
`sin`, `exp` o `powf` en el trazado: determinismo entre plataformas),
escalado uniforme a la focal pedida, iris con láminas, *coatings* como
transmisión por superficie (decisión 5: T-stop y tinte, sin
fantasmas), modos de enfoque `unit`, `internal` y `floating` según la
prescripción, límites de pupila de salida precalculados por altura de
imagen (unión de las tres bandas), aberración cromática por bandas
(decisión 3), y lo que sale solo (distorsión, viñeteo, ojo de gato,
burbuja y cremoso por aberración esférica, coma, curvatura de campo,
respiración de foco). RSB: `LENS` crece con la prescripción (campos
opcionales al final; el RSB de O1 sigue leyéndose). **Salidas físicas
al inspector, calculadas por el motor y nunca inventadas** (regla 10):
focal efectiva, tiraje, f/, T-stop, curva de distorsión e iluminación
relativa por altura de imagen; `rt_wasm` las exporta y el lanzador las
sirve (`/api/lens/info`); la interfaz las muestra en la sección
*Cámara* ▸ *Lente*. **Editor de lente**: selector por *carácter*,
familia, focal, f/, láminas, *coating*, foco, *tilt-shift*; *Avanzado*:
los mandos artísticos de §5 marcados *no físico* (cantidad de
aberración cromática, distorsión, viñeteo, remolino, carácter de la
esférica, respiración); **corte de la lente en SVG** dibujado desde la
prescripción; *Guardar lente como…* a la biblioteca propia (U4). Los
tipos de bokeh que exigen lente trazada se activan en el selector de O1.
**Perfil rápido** (decisión 4): al cargar la lente el motor saca puntos
cardinales, distorsión e iluminación relativa (tablas `f32`), y el visor
Rápido aplica distorsión y viñeteo como aproximación (dicho en la
ayuda). Cambiar de lente nunca toca la resolución de salida.

**Depende de.** O1, A6.

**Criterio.** Focal y tiraje paraxiales de las 16 lentes dentro del
0,05 % de `reported` (test, como `tests/lenses.test.ts` pero en Rust);
rayos axiales de la doble Gauss salen paralelos a < 2e-4 de pendiente;
f32 contra f64 de referencia (test con `f64` solo en la prueba) por
debajo de 1e-4 mm; paridad wasm y determinismo 1/4/16 hilos; coste de
la cámara trazada ≤ 25 % del render del ejemplo con la doble Gauss a
1024 muestras (medido); hoja `out/lens-sheet.html`: el frasco con las
16 lentes a f/ máximo y a f/8, y la escena de puntos de luz con las que
dan ojo de gato, burbuja, cremoso y remolino, **con veredicto de
Fable**; capturas `docs/ui/lens-editor.png` y `docs/ui/lens-section.png`.

**Hecho.**

- **Motor** (`rt-core/src/optics/traced.rs` y `paraxial.rs`). La
  prescripción va al final de `LENS`, tras los huecos de los filtros de
  O3a (que entonces se escriben siempre); una `LENS` sin ella es la de O1
  byte a byte. Superficies esfera, plano, asférica par, cilindro (eje x o
  y), espejo (la secuencia desplegada del catadióptrico) y el diafragma;
  la intersección estable de §6.5, normal sin raíz, Newton en las
  asféricas, Snell vectorial, solo `+ − × ÷ sqrt`. Al leer la escena (y
  cada vez que cambian focal, f/, foco o sensor; si solo se mueve la
  cámara se reutiliza) la lente se **escala** a la focal paraxial pedida,
  toma los índices de las **tres bandas** (Cauchy de dos términos desde
  `nd` y `vd`; la aberración cromática no física multiplica la dispersión)
  y la **transmisión** de cada superficie aire–vidrio por su tratamiento
  (T-stop y tinte, sin fantasmas), y se **enfoca**: unidad, interno
  (bisección sobre los huecos), flotante (los huecos siguen al aumento) y,
  nuevo, **anamórfico** (`FOCUS_ANAMORPHIC`: el adaptador delante de un
  objetivo que enfoca como una unidad; su hueco más ancho, entre los
  cilindros, recorre hasta el 60 % para llevar el meridiano comprimido al
  mismo foco; la imagen se desestira por la compresión que traza a ese
  foco: 2,00 a infinito, 1,96 a 3 m, 1,72 a la distancia del frasco). La
  cámara se sitúa en la pupila de entrada paraxial a infinito (la
  perspectiva de la lente fina); el diafragma da el f/ pedido, nunca más
  abierto que la lente, y se abre hasta el f/ más rápido declarado aunque
  la fuente dé su diámetro para otro (el triplete, f/4 en la patente y
  f/3,7 de catálogo). Las semiaperturas que la fuente no da salen de un
  rayo marginal y uno principal paraxiales y se **ensanchan con rayos
  reales** del encuadre en los dos meridianos (en un gran angular el
  principal paraxial se quedaba corto y recortaba las esquinas: la doble
  Gauss rápida pasaba de 0,79 a 0,88 de luz en la esquina de un 50 mm a
  f/1,4). Límites de la pupila de salida en 32 alturas (rejilla de
  24 × 24 en el vértice trasero, tres bandas, una celda de margen) y la
  irradiancia en 40 × 40 para el normalizador y la iluminación relativa.
  Cada muestra: una banda (decisión 3; las tres de un grupo comparten el
  punto de la pupila), un punto del rectángulo, el trazado con rimas e
  iris y el peso `A cos⁴θ / Z²` sobre el del eje por el tinte; una muestra
  que la lente para pesa negro y conserva su propio rayo sin recortar para
  la cobertura (antes se trazaba otra vez el rayo principal). Atajos
  exactos del iris (dentro del círculo inscrito pasa, fuera del
  circunscrito no; un test compara 160 000 puntos con el borde exacto en
  cinco iris) y cocientes de índice precalculados: los mismos bits. Los
  ajustes **no físicos** (distorsión, viñeteo, esférica como lámina en el
  diafragma, respiración, remolino, aberración cromática) se aplican
  encima; los rayos centrales de los pases usan el mismo punto del sensor
  que las muestras.
- **Lo que el motor dice** (`LensInfo`, `rt_scene_lens_info` de `rt_wasm`,
  `POST /api/lens/info` del lanzador): focal a infinito y al foco, la
  **escala de imagen** cerca del eje (con la respiración: a foco cercano
  la lente encuadra menos), tiraje, f/ en uso y el más rápido, T-stop,
  transmisión por banda, longitud, pupila de entrada, elementos y grupos,
  la compresión de un anamórfico, la **distorsión** contra esa escala y la
  **iluminación relativa** en 17 alturas del encuadre de salida, y el
  **corte** (cada superficie como se traza, enfocada, con su semiapertura;
  el iris en uso y el sensor).
- *Hash* fijado de la escena O2 (`example::o2_scene`: el ejemplo a f/2,8
  por la doble Gauss del catálogo con siete láminas curvas y las luces de
  fondo de O1, `tests/fixtures/o2.rsb`, 10 008 bytes):
  `PINNED_O2_TRACED_4SPP` = `0x8f7d0ef8` (era `0xe2e8e3ab`; lo movió la
  mezcla con E9, como a O1 y O3a; E6 no lo movió) en escalar, SSE2 y AVX2,
  en WASI, en el `rt_wasm.wasm` real (en CI, tras E6), por el código de la
  página y con 1, 4 y 16 hilos. Ningún otro *hash* se movió.
- **El catálogo como lo traza el motor** (`rt-cli/src/lens_catalogue.rs`,
  `rt --write-lens-catalogue`, `tests/fixtures/lens-catalogue.json`): la
  misma composición que la página (el adaptador delante de la doble Gauss,
  escalado para despejar su frente, su hueco de enfoque); la página
  escribe los mismos bytes para las 16 lentes (test).
- **Interfaz.** `CameraOptics.traced` (`src/core/traced-lens.ts`: la clave
  del catálogo y lo que se cambió; las ópticas anteriores no lo tienen y
  no cambian ni un byte). *Cámara ▸ **Lente*** (`insp-traced.ts`, el
  editor de lente): *Lente fina · Lente trazada*; *Carácter* en chips y
  *Míos*; *Lente*; la fuente (patente o libro y lo comprobado); *Objetivo
  detrás* (adaptador), *Tratamiento*, el hueco variable de la lente blanda
  y *Normal*, *Láminas* y el recorrido del diafragma; los números, las dos
  curvas y el **corte en SVG** del motor (`ui/components/lens-section.ts`);
  *Avanzado* bajo **NO FÍSICO**; **Guardar lente como…** a la biblioteca
  propia (nuevo tipo `lens`, con su validación al importar). Los tres
  tipos de bokeh de la lente trazada se eligen ya, con su miniatura
  renderizada por `rt` con su lente (`tools/bokeh-thumbs.mjs`). Con una
  lente trazada, *Óptica avanzada* apaga el perfil, el ojo de gato, la
  compresión y la inclinación de la lente fina con una nota, y la
  compresión de la lente fina ya no estira la imagen de una lente trazada
  (el motor tampoco la aplica). El visor Rápido aplica la escala, la
  distorsión y el viñeteo del motor (`render/lens-profile.ts`) y el
  medidor dice *Lente trazada: distorsión y viñeteo aproximados, el render
  la traza*. `tools/lens-check.mjs` (Chromium local, 13 comprobaciones)
  deja `docs/ui/lens-editor.png` y `docs/ui/lens-section.png`.
- **El clic a través del perfil** (el 1.8 del triaje). El visor Rápido
  dibuja la distorsión como un pase de pantalla y `pick` lanzaba el rayo
  sin distorsionar: con un gran angular o el ojo de pez, enfocar con clic,
  seleccionar, la caja y el *gizmo* no caían en lo que había bajo el cursor.
  Ahora el mapa de la pantalla a la imagen sin distorsionar está una sola
  vez en `render/lens-profile.ts`, en TypeScript y en GLSL uno junto al otro
  con los mismos números (`profileSource`, `PROFILE_GLSL`,
  `profileUniforms`): por él dibujan el pase de pantalla, el contorno de la
  selección (la máscara se lee por el mapa: la línea rodea la pieza como se
  dibuja) y los superpuestos (*gizmo*, glifos, trayectorias; en *Completo*,
  las caras seleccionadas), y lo invierten el pico (enfocar con clic y
  seleccionar), el *gizmo*, los glifos, `objectAt` (por `profileShown`, el
  mapa al revés por bisección), la selección por caja
  (`Projection.shown`) y el pase de ids de las caras. Sin perfil (lente
  fina, o antes de que el motor diga sus números) es la identidad. La tabla
  se lee ahora entre sus entradas (el pase leía la más cercana: un escalón,
  un anillo, en cada una), y el perfil es el de la cámara por la que se
  mira (al mirar a través de otra cámara o de una luz, L4, se aplicaba el de
  la activa). La lógica de *Enfocar con clic* que deshace el `end` de la
  órbita (`main.ts`, `core/view-objects.ts`) es de B1 y no se ha tocado.
- **Hoja** `out/lens-sheet.html` (`rt --lens-sheet out/lens-sheet`,
  `node tools/lens-sheet.mjs --reuse`), 400 × 300: por lente el frasco
  abierto y a f/8 (96 muestras), los puntos de luz abiertos y con la lente
  fina al mismo f/ (480 muestras, con primeros planos de la luz del centro
  y de la esquina), un gráfico de luces enfocadas en rejilla rectilínea a
  su propio campo (96 muestras), el corte, los números, las curvas y el
  coste; arriba la lente fina de referencia y la tabla del coste
  (`rt --lens-cost`, `out/lens-sheet/cost.json`).
- **Lotes** (la regla de coste del encargo, §6.1 del informe). En la
  primera entrega la cámara trazada era el 29,1 % del render del ejemplo
  con la doble Gauss a 1024 muestras (0,71 µs por muestra de cámara), por
  encima del 25 %: ahora la baldosa traza por la lente, fila a fila, las
  muestras de los píxeles que toman una sola en **lotes de ocho**
  (`optics::traced::batch`: las ocho a la vez, superficie a superficie, en
  forma de estructura de *arrays*, cada carril con las mismas operaciones y
  en el mismo orden que una sola, así que los mismos bits; los píxeles de
  borde de E11 y una lente con asféricas, uno a uno), con la base de la
  cámara una vez por lote. El trazado solo pasa de 0,60 a 0,14 µs por
  muestra; ningún *hash* se mueve (`PINNED_O2_TRACED_4SPP` sigue en
  `0x8f7d0ef8`, en cada ruta SIMD, en el `rt_wasm.wasm` real y con 1, 4 y
  16 hilos).
- **Coste** (`rt --lens-cost`, un hilo, la más rápida de tres vueltas de
  cada medida, `out/lens-sheet/cost.json`):

  | Escena | Cámara | Muestra de cámara | Parte del render | Render |
  | --- | --- | --- | --- | --- |
  | Ejemplo, 64 × 48, 1024 spp | Doble Gauss, antes de los lotes | 0,71 µs | **29,1 %** | 7,7 s |
  | Ejemplo, 64 × 48, 1024 spp | Doble Gauss, en lotes | 0,25 µs (0,71 una a una) | **13,7 %** | 5,7 s |
  | Ejemplo, 64 × 48, 1024 spp | Lente fina | 0,19 µs | 10,6 % | 5,6 s |
  | Frasco, 96 × 72, 256 spp | Doble Gauss, en lotes | 0,26 µs (0,68 una a una) | 12,9 % | 3,6 s |
  | Frasco, 96 × 72, 256 spp | Lente fina | 0,19 µs | 10,1 % | 3,4 s |

  Lo que la lente trazada añade sobre la cámara de la lente fina es ya el
  3 % del render del ejemplo. Con la máquina cargada las vueltas sueltas
  varían (de 12,4 a 23,5 % en tres medidas de una vuelta); la más rápida de
  tres es la que cuenta. Por lente, en lotes (una vuelta en la escena de
  puntos), la muestra de cámara va de 0,21 µs (cuatro elementos con
  doblete trasero) y 0,22 µs (menisco) a 0,43 µs (ojo de pez, 17
  superficies) y 0,51 µs (asimétrico rápido); la de la lente fina, 0,16 µs.
- **Tests** (cada uno comprobado reintroduciendo el error donde arregla
  uno). rt-core `optics::traced_tests`: focal y tiraje paraxiales de las 15
  lentes que forman imagen en la tolerancia del informe; rayos axiales de
  la doble Gauss paralelos a < 2e-4; f32 contra f64 < 1e-4 mm; cada lente
  a 50 mm con su corte, semiaperturas, iris dentro del diafragma (sin
  abrir el diafragma al f/ declarado, falla con el triplete) y perfil;
  foco unidad, interno y flotante; distorsión de la doble Gauss < 2,5 % a
  infinito, 3 m y 0,5 m (contra la focal al foco daba +15,7 %, falla);
  distorsión −1 que da barril (con el signo de antes, cojín, falla) y
  rayos centrales que siguen a las muestras con ella (el rayo central de
  antes, a 0,045 rad, falla); la doble Gauss rápida con 0,85 de luz en la
  esquina (sin ensanchar las rimas, 0,79, falla); la compresión de la
  lente fina que no cambia el rayo de una lente trazada (falla sin el
  arreglo); los atajos del iris. rt-cli: el catálogo y su fichero al día,
  el foco anamórfico con los dos meridianos al foco a 1,5 y 4 m (sin mover
  el hueco, el horizontal enfoca a otra distancia, falla) y la compresión
  2 a infinito; las celdas de la hoja y el campo de su gráfico; la línea
  de órdenes; 1/4/16 hilos. rt-app: `POST /api/lens/info`. Los **lotes**:
  cada carril de un lote con los bits de la muestra sola en las 15 lentes
  que forman imagen, con y sin ajustes y remolino, lotes de 1, 3 y 8
  (rt-core), los cilindros del adaptador (rt-cli) y las filas de la
  baldosa, también con filtros y una fila que no es múltiplo de ocho,
  contra `camera_sample_filtered` píxel a píxel (rt-core).
  `tests/traced-lens.test.ts` (14): la lente de un proyecto, los tipos de
  bokeh que la ponen, la composición (tratamiento, hueco variable,
  adaptador y su hueco de enfoque, en otro objetivo su enfoque), el perfil
  del visor con la escala del motor y no su focal, la información del
  motor (y la que no lo es), `o2.rsb` byte a byte, la prescripción de la
  página igual a la de `rt` para las 16 lentes, los ajustes, la compresión
  del adaptador y no la de la lente fina, con el `rt.wasm` real el *hash*
  de O2 y las 16 lentes preparadas con su escala, su corte y la compresión
  del adaptador, la biblioteca de lentes (ida y vuelta por el fichero, una
  clave desconocida rechazada), el corte en SVG y el mapa del perfil (la
  identidad sin perfil, las entradas de la tabla, sin escalones entre ellas
  —con la entrada más cercana, falla— y de ida y vuelta).
  `tests/optics.test.ts`: los tipos de la lente trazada ponen su lente y sus
  miniaturas están al día con la escena de la herramienta.
  `tests/box-select.test.ts`: piezas y caras donde las pone `shown`.
  `tests/lens-pick-browser.test.ts` (Chromium con SwiftShader, la vista
  previa real): una pared de placas en tres colores a 24 mm a través de un
  barril de −20 % y del ojo de pez del catálogo como lo dice el `rt.wasm`
  real; se lee el lienzo y se pica cada píxel de color seguro (unos 32 000):
  ninguno da otra pieza que la dibujada, y unos 5 000 muestran otra que la
  imagen sin distorsionar (con el rayo de antes, 4 022 fallos); la lente
  fina, sin números y la vista a través de otra cámara, la identidad (con
  el perfil de la cámara activa, 5 010 píxeles movidos); el contorno a dos
  píxeles del borde dibujado de la pieza (sin el mapa, el 13 %); la caja
  alrededor de la pieza dibujada la toma (sin `shown`, no); el pase de ids
  encuentra sus caras (sin el mapa, ninguna); y el *gizmo* da su asa en el
  95 % de los píxeles que pinta, como sin perfil (dibujado recto o picado
  sin el mapa, del 70 al 79 %).

**No encajó con el plan.** (1) **Coste**: en la primera entrega la cámara
trazada pasaba del 25 % (29,1 %); la regla del encargo pedía lotes antes de
cerrar y se hicieron (arriba): 13,7 %. Los lotes son de ocho muestras en
*arrays* que el compilador vectoriza solo (lo que medía §6.1), no con los
tipos del módulo `simd`, que no tienen raíz cuadrada; los mismos bits en
cada plataforma porque cada carril hace las operaciones IEEE de una
muestra sola. La medida toma la más rápida de tres vueltas porque una sola
vuelta, con la máquina compartida, varía mucho. (2) **Ruido**: con una banda por
muestra (decisión 3) cada canal recibe un tercio de las muestras, y el
rectángulo alrededor de la pupila de salida pierde del 33 al 40 % de ellas
(el diafragma redondo dentro de su caja más una celda de margen): a igualdad
de muestras el bokeh tiene unas cinco veces la varianza del de la lente
fina, y la hoja renderiza los puntos a 480 muestras para que se lean.
Muestrear las celdas que pasan (una rejilla de máscara por altura en vez
del rectángulo) quitaría casi todo lo segundo; queda propuesto. (3) La
**inclinación** no se traza (la lente trazada no tiene plano de lente
girado): se apaga con una nota (*próximamente*); el descentramiento sí
funciona. La máscara y las texturas de pupila son de la lente fina. (4) El
**editor de lente** (O5 en la tabla, para Sonnet) venía en el encargo de O2
y está hecho aquí; la focal, el f/ y el foco son los campos de la cámara de
siempre, y el descentramiento sigue en *Óptica avanzada*. (5) Una **lente
propia** guarda la clave del catálogo (estable) y sus ajustes, no una copia
de las superficies, como el proyecto. (6) **Anamórfico**: la imagen
conserva la proyección de O1 (el campo del objetivo, con la mitad del ancho
del sensor), la compresión cambia con el foco, el perfil del visor es el
del meridiano vertical y los límites de la pupila suponen simetría de
rotación (los del objetivo, que el adaptador recorta por dentro). (7) La
**distorsión** se mide ahora contra la escala de imagen cerca del eje: la
medida de antes, contra la focal al foco, leía como distorsión la
respiración a foco cercano. La **distorsión no física** tenía el signo al
revés de lo que decía su documentación (negativa daba cojín) y los rayos
centrales de los pases no la seguían: arreglados con su test. (8) Las
focales de los gráficos de la hoja (las del campo de la fuente; 50 mm o
135 mm en las tele cuando no dice ninguno; el ojo de pez a 18 mm) son
elección mía para la hoja. (9) La miniatura de *Respiración de foco* es la
del teleobjetivo a f/5,6: la respiración no se ve en un núcleo quieto. (10)
Una muestra parada da ahora la cobertura de su propio rayo sin recortar en
vez de la del rayo principal (el color no cambia ni un bit; el alfa de un
fondo transparente, levemente). (11) **Decisiones para el veredicto**
(regla 11), pendientes: la hoja, lente a lente (qué dan ojo de gato,
burbuja, cremoso y remolino, y si las prescripciones y los diafragmas
supuestos, los `stopBasis: assumed`, se quedan); el ruido de las bandas y
la propuesta del muestreo por celdas de (2); las constantes del adaptador
(`ADAPTER_GAP_MM` 5, `ADAPTER_CLEARANCE` 2,2, `ADAPTER_FOCUS_TRAVEL` 0,6);
y las focales de los gráficos de la hoja de (8). (12) **El clic a través
del perfil** llegó tras la entrega, del triaje (1.8). El mapa vale en los dos
modos: en *Completo* la imagen es la del motor y el perfil la aproxima con
sus propias tablas, como en *Rápido*. Los superpuestos se dibujan a un
objetivo y de ahí al lienzo por el mapa: con SwiftShader a 800 × 600 el
*gizmo* cuesta del orden de 30 a 60 ms más por fotograma con una lente
trazada (en una GPU, despreciable), y sus líneas, de grosor fijo en
píxeles, se adelgazan donde el perfil encoge la imagen. El pase de pantalla
sostiene el borde de la imagen donde la fuente cae fuera de ella (un barril
fuerte en las esquinas de un gran angular): el pico lanza por ese borde,
lo que se ve; dibujar un campo más ancho para no estirar el borde queda
propuesto.

## O2b · Ventana de la lente al pasar el ratón — **Sonnet** — hecha

**Qué.** La petición 1.4 del reporte de errores del usuario (`TRIAGE.md`:
«al hacer hover por encima de la lente, ha de mostrar una ventana con los
elementos»), tras O2: dejar el puntero (o el foco del teclado) sobre una
lente de la lista *Lente* o sobre un chip de *carácter* abre a su lado una
ventana pequeña con el **corte** de esa lente (el elemento, el diafragma, el
plano de imagen), su **nombre**, su **fuente** (la patente o el libro, como la
sección) y sus **números** (focal, diafragma, elementos y grupos, longitud),
todos los que el **motor** dice para esa lente. Para una lente que no está en
la cámara no hay `LensInfo`: se le pregunta al motor por la lente señalada
(`rt_scene_lens_info` del `rt.wasm` de la página, o `/api/lens/info` del
lanzador), sin bloquear nada, con una caché por lente y por lo que los números
dependen de (focal, distancia de enfoque, f/, encuadre, ajustes de la lente);
mientras llega lo dice, y sin motor (la versión web sin `rt.wasm`) dice que el
motor no está cargado y deja solo el nombre y la fuente (regla 10).

**Depende de.** O2.

**Criterio.** Pruebas que fallan sin la función: el reposo abre la ventana con
los datos de la lente señalada (con un puerto de lente falso que cuenta sus
preguntas), la caché (pasar dos veces por la misma lente pregunta una vez al
motor), los estados *preguntando* y *sin motor*, y el cierre al sacar el
puntero, con Esc y al elegir; el foco del teclado la abre. Una comprobación en
el navegador (`tools/lens-hover-check.mjs`, como `tools/lens-check.mjs`) que
pasa por dos lentes en la interfaz de verdad con el `rt.wasm` real y deja
`docs/ui/lens-hover.png` (y `lens-hover-dark.png`). Cadenas en `es` y `en`;
el cromo acromático; ni el catálogo de lentes, ni las prescripciones, ni la
óptica del motor cambian (regla 11).

**Hecho.**

- **La lógica, sin DOM** (`src/ui/lens-peek.ts`): `peekCamera` (la cámara tal
  cual, con la lente señalada puesta como la dejaría elegirla: sus propios
  ajustes, ninguno de la persona; la lente puesta se pregunta con los suyos),
  `lensPeekCache` (una caché por puerto, hasta 48 respuestas; la clave es lo
  que lee el motor: los `optics` de la cámara con su lente, la focal, el f/, el
  enfoque, el encuadre y la proyección; una pregunta en vuelo se comparte; se
  guarda lo que el motor dijo y su negativa, no «sin motor» ni un fallo, para
  que una lente se vuelva a preguntar cuando llegue el motor),
  `createPeekController` (el reposo de 300 ms con temporizadores inyectables:
  cruzar la lista no abre nada, salir o pasar a otra entrada cierra, y una
  ventana cerrada con Esc o al elegir no se reabre hasta que el puntero o el
  foco vuelven) y `peekCard` (lo que dice una tarjeta: solo lo del motor; sin
  respuesta, *Preguntando al motor…*; sin motor, el nombre y la fuente y *El
  motor no está cargado…*; negada, *El motor no forma imagen…*). La fuente de
  una lente en una línea (`lensSourceLine`) y el medio sensor del corte
  (`sensorHalf`) salen de `insp-traced.ts` y los comparte con la sección.
- **La ventana** (`src/ui/components/lens-peek.ts`): un `role="tooltip"` junto
  a la lista y a la altura de la entrada (junto al inspector, para los chips),
  por el lado con sitio, siempre dentro de la ventana del navegador (un
  máximo de tamaño; en una pantalla baja recorta); dibuja con `lensSectionSvg`
  de `components/lens-section.ts`, el único dibujo de una lente; **no toma el
  foco ni el puntero** (`pointer-events: none`, no hay nada que se pueda
  enfocar), se vincula a la entrada con `aria-describedby`, se cierra con Esc
  (que no hace nada más) y cuando se pulsa la entrada. Un chip abre la ventana
  de las lentes de su carácter (hasta cuatro, en dos columnas, con el nombre
  del carácter); cada tarjeta llega cuando llega su respuesta. El foco abre
  solo si es del teclado (`:focus-visible`: el foco que da un clic no abre
  nada); el toque, nada.
- **La lista *Lente* es la de la interfaz** (`src/ui/components/pick-menu.ts`):
  el mismo marco y la misma flecha que un `select`, que abre el menú de
  `widgets.ts` (flechas, Intro, Esc; la lente puesta, marcada y con el foco).
- **Cableado** (`src/ui/panels/insp-traced.ts`): los chips se hacen una vez (ya
  no se rehacen al pulsarlos: el foco se queda en el chip) y cada uno, y cada
  entrada de la lista abierta, abre su ventana; la sección *Lo que calcula el
  motor* pregunta por la caché, así que la lente puesta es una sola pregunta
  para la sección y para la ventana. Cadenas nuevas: `camera.lensPeekNoEngine`
  y `camera.lensPeekLabel` (el resto, las de la sección).
- **Pruebas.** `tests/lens-peek.test.ts` (20, Node): la cámara por la que se
  pregunta, la caché (una pregunta por lente, la compartida, la que cambia con
  la focal, el foco, el f/, el encuadre, los ajustes, la negativa que se guarda,
  «sin motor» y el fallo que no, el límite), el controlador con temporizadores
  a mano, las tarjetas (con datos distintos por lente, *preguntando*, sin motor,
  negada, en español), la colocación dentro de la ventana y, con el `rt.wasm`
  real, los números de cuatro lentes que no están en la cámara contra los del
  motor. `tests/lens-peek-browser.test.ts` (14, Chromium): la sección de verdad
  con un puerto falso que cuenta, retiene, niega o falta: abre junto a la lista
  y junto al chip tras el reposo, no antes, con el nombre, la fuente, el dibujo
  y los números de esa lente; una pregunta por lente; la que se espera, la sin
  motor y la negada; salir, Esc (también con la lista abierta) y elegir
  cierran; el teclado la abre y la mueve de lente en lente; no toma foco ni
  puntero; dentro de una pantalla pequeña; en español.
  `tools/lens-hover-check.mjs` con la aplicación construida y el `rt.wasm` real:
  los números de la ventana son los de la sección al poner esa lente (6 · 4 la
  doble Gauss, 5 · 3 la simétrica de cinco), volver a pasar no pide nada al
  módulo (contado envolviendo `rt_scene_load`), y las capturas
  `docs/ui/lens-hover.png`, `lens-hover-dark.png` y `lens-hover-chip.png`.
  `tools/lens-check.mjs` elige la lente en la lista nueva. Comprobado a mano
  que las pruebas fallan sin la función, quitando de una en una: engancharla a
  las entradas, la caché (y, aparte, su memoria), el reposo de 300 ms, Esc,
  el cierre al salir, el foco del teclado, la tarjeta *preguntando* (dicha como
  sin motor), el «sin motor» que enseña un número, la ventana que toma el
  puntero y la cámara equivocada (la de la lente puesta para todas); cerrar al
  elegir va por tres caminos (la lista que se cierra, la entrada que se pulsa
  y la lista que se redibuja) y falla al quitar los tres.

**No encajó con el plan.** (1) **La lista no podía ser un `select`**: el
navegador dibuja las entradas de un desplegable nativo y la página no recibe
nada hasta que se elige una (ni `mouseover` ni foco), así que «pasar por
encima de una entrada del desplegable» no existe; la lista *Lente* pasa a ser
la de la interfaz (`pick-menu.ts`). Cambia cómo se ve el menú abierto (el de
la interfaz, no el del sistema) y no tiene búsqueda por la inicial; el cerrado
es igual. (2) **Un chip es un carácter, no una lente**: el encargo decía «la
ventana con el corte de esa lente»; un chip tiene entre una y cuatro lentes,
así que su ventana enseña todas las del carácter, cada una con su tarjeta (con
una sola, es igual que la de una entrada). *Míos* no abre ventana y las filas
de lentes propias tampoco (su lente sale de un ajuste guardado: queda para
quien edite lentes, 1.5). (3) Los números son los tres del encargo más la
*longitud* (lo que más separa una lente de otra, con la focal ya escalada a la
de la cámara) y, en el adaptador anamórfico, la compresión. (4) **El motor y
la ortográfica**: con una cámara ortográfica el motor no traza la lente y el
puerto contesta que no hay lente; la ventana dice entonces que el motor no
está cargado, como ya hace la sección con su aviso (decir otra cosa quedaría
para ese aviso). (5) **El escritorio** pregunta por `/api/lens/info` con el
mismo puerto (`services.lens`) que la sección, que no se tocó: lo comprobado
es el módulo de la página con el `rt.wasm` real; no se probó contra el
lanzador. (6) En pantallas muy bajas la ventana de un carácter con cuatro
lentes (unos 550 px) se recorta en vez de moverse o encogerse; con menos de
1 100 px de ancho el inspector se pliega y la ventana pasa sobre su columna.
(7) El reposo es de 300 ms siempre, sin un «calentamiento» que lo acorte entre
entradas vecinas: salir cierra y entrar espera de nuevo.

## O3a · Filtros de efecto en la lente: difusión negra, blanca y dorada, brillo, red, estrella, rayas — **Opus** (tras O1, antes de O2), veredicto **Fable** — hecha

Petición del usuario (14-10): en la lente, filtros «de estilo» (difusión
negra, dorada…), no recetas de color. Son los filtros físicos que se
roscan delante del objetivo: una lámina que **dispersa** parte de la luz
que entra, y lo que cambia entre ellos es cuánta, con qué forma angular
y con qué color. Se hacen en el motor, en el espacio de rayos, para que
interactúen bien con el bokeh, el desenfoque y las luces fuera de
cuadro, y con un equivalente de imagen para la vista previa.

**Decisiones.**
1. **Modelo físico, en la pupila.** Un rayo de cámara, con probabilidad
   `s` (el grado del filtro), se desvía un ángulo sacado de la
   **PSF angular** del filtro; si no, sigue recto. Energía: `(1 − s)·I +
   s·a·T·(I ⊗ K)`: `a` es lo que absorben las partículas (1 en los
   blancos y dorados; < 1 en los negros: el halo sale pero las sombras
   suben menos, por eso un filtro negro «conserva el contraste»), `T` el
   tinte del haz disperso (neutro; dorado: cálido, normalizado en
   luminancia), `K` la PSF. Ocurre en la muestra de pupila de O1, así que
   el bokeh y el enfoque se llevan gratis y una luz fuera del encuadre
   sigue velando.
2. **Tipos** (`src/data/lens-filters.ts`, claves estables, nombres es/en
   genéricos, **ninguna marca**): `DIFFUSION_WHITE` Difusión blanca
   (gaussiana estrecha + cola ancha lorentziana: halo y contraste bajo),
   `DIFFUSION_BLACK` Difusión negra (misma forma, `a` < 1),
   `DIFFUSION_GOLD` Difusión dorada (difusión con `T` cálido), `GLIMMER`
   Brillo (cola fina y dispersa: destellos pequeños alrededor de las
   luces, por un segundo lóbulo estrecho cuya dirección se traba a un
   *hash* de la posición de pupila), `SOFT` Suavizado (solo la gaussiana
   estrecha, `s` alto: pierde nitidez sin halo), `NET` Red (dispersión
   concentrada en dos ejes a 90°, con tinte suave), `STAR` Estrella
   (`points` 4/6/8 rayas rectas desde las luces, ángulo `angle`, caída
   1/r), `STREAK` Rayas (una sola línea horizontal, tinte azul por
   defecto, como una lente anamórfica). **Grados** 1/8, 1/4, 1/2, 1, 2
   (lista, como los filtros reales) → `s` propuesto 0,03 / 0,06 / 0,12 /
   0,22 / 0,38 y anchos propuestos σ₁ = 0,25°, σ₂ = 2,5° de campo; los
   definitivos los fijo yo con la hoja (regla 11).
3. **Pila** de hasta tres filtros por cámara (en la práctica se apilan
   dos: una difusión y una estrella), cada uno con tipo, grado y, según
   el tipo, tinte (dorada, red, rayas), puntas y ángulo (estrella).
4. **RSB.** `LENS` crece con tres filtros al final (`kind u32, grade f32,
   tint[3] f32, angle f32, points u32`, 28 B cada uno; ceros = ninguno,
   *hashes* intactos sin filtros). La PSF se muestrea por CDF inversa
   tabulada en `f32` (sin `exp`/`log` en el bucle; determinismo).
5. **Vista previa.** Equivalente de imagen: `(1 − s)·I + s·a·T·(I ⊗ K)`
   con `K` proyectada a píxeles por la focal, como pase WebGL del visor
   Rápido (separable en dos gaussianas + cola por submuestreo) y la misma
   convolución en TS para la ventana de render; el medidor dice
   «aproximación: el render lo hace el motor» (regla 10).
6. **Interfaz.** Cámara ▸ Lente ▸ **Filtros**: la pila (añadir/quitar,
   hasta tres), por filtro: tipo (lista con ayuda de una frase: qué hace
   fotográficamente), grado, y los mandos del tipo. Guardado con la
   cámara (cada cámara, los suyos). Cadenas es/en.

**Depende de.** O1 (la pupila, `LENS`).

**Criterio.** Tests: campo blanco con difusión blanca grado 1 conserva la
media ± 0,5 %; difusión negra grado 1 queda entre 0,90 y 0,97; estrella 6
da seis rayas (histograma angular de la energía de un foco puntual con
picos en seis ángulos ± 2°); dorada desplaza la media del haz disperso
hacia el rojo; pila de tres con grados ceros = sin filtro bit a bit;
vista previa contra motor en la escena del horno: diferencia media
< 2 %; lista de *hashes* sin cambios con `LENS` sin filtros; paridad
wasm. Hoja `out/lens-filters-sheet.html`: la botella con un foco pequeño
a contraluz dentro del encuadre y otro fuera, 512 px / 128 spp, cada
tipo a grados 1/4, 1 y 2, y dos pilas (difusión negra 1/2 + estrella 6;
dorada 1 + rayas); a ojo. Capturas `docs/ui/lens-filters.png`.
`UI.md`, `SPEC.md` §3.5, `ARCHITECTURE.md` (`LENS`), CHANGELOG.

**Hecho.**

- **Motor** (`rt-core/src/optics/filters.rs`). Los ocho tipos con su
  `FILTER_*` (1 difusión blanca … 8 rayas) y la pila de hasta tres en
  `LensParams.filters`; `Lens::new` construye cada filtro que dispersa
  (grado > 0) y rechaza tipos, grados (0 a 2), tintes negativos y puntas
  (4, 6, 8) fuera de rango. En `Lens::sample`, tras la pupila de O1,
  cada filtro decide con su número si dispersa la muestra (probabilidad
  `s` del grado, `kind_s`: la tabla de las difusiones, el brillo y la
  red, `GRADES` 1/8 … 2 → `GRADE_S` 0,03 … 0,38, y las propias de la
  estrella y las rayas, lineales entre grados) y la desvía `d + right·δx
  + up·δy` con el peso de su lóbulo (`Filter::colour_at`: `a` en el
  núcleo y los destellos, `a·T` en las rayas y en la cola de la
  difusión), así que la imagen es `(1 − s)·I + s·a·(I ⊗ K_T)` con el
  bokeh y el enfoque de la lente y las luces de fuera del encuadre. PSF
  por CDF inversa tabulada (256 valores en `f32`, construida al cargar
  con `fmath`; en el bucle, búsqueda, interpolación y la dirección con
  `fmath::sin_cos`): difusión, gaussiana de 0,25° (60 % de lo disperso)
  y cola de Cauchy 2D de 2,5° hasta 12 anchos; suavizado, la gaussiana
  sola con el doble de `s` (máximo 0,8); brillo, la gaussiana y un halo
  suave de 1° (el 70 % de lo disperso, el halo con el 40 % de eso) y,
  con el 30 %, una nube fija de 4096 destellos de ±0,03° (gaussiana 2D
  de 1°, sus distancias estratificadas y sus direcciones y brillos,
  exponenciales como los de un moteado, de un *hash*) de la que cada
  muestra toma uno por su brillo; red, la gaussiana (su suavizado, el 90
  %) y una cruz en dos ejes a 90° desde `angle`; estrella, `points`
  rayas desde `angle`; rayas, una línea horizontal (dos semirrayas) de
  15°; las rayas con densidad 1/r desde 0,05° que se afila hasta 0 en su
  largo (`line_length_deg`: la estrella de 1,9° a 1/8 a 12° a 2, la red
  de 0,6° a 3,5°) y 0,02° de grosor. `a` = 0,7 en la difusión negra y 1
  en las demás; tintes por defecto de la dorada (1,08, 1, 0,86), la red
  (1,06, 1, 0,94) y las rayas (0,82, 0,95, 1,25), llevados a luminancia
  1. Números propios (cuatro por filtro) en `DIM_LENS_FILTER` = `4 <<
  20`, más allá de la tabla de Sobol; con bandas cromáticas, los del
  grupo de tres.
- **Conexión con las luces** (tras la primera hoja y la indicación del
  líder: MIS entre la dispersión en la pupila y un muestreo directo de
  las luces a través de la PSF). Un rayo disperso rara vez da con una
  luz pequeña, y la hoja sin conexión salía salpicada (la estrella como
  puntos sueltos, el halo de las difusiones como chispas por toda la
  imagen). Cada muestra de cámara con filtros se conecta, por filtro, a
  una de las luces que ve la cámara (`Lights::camera_lights`: las de
  área y las esferas con la marca *cámara*, por su esfera envolvente;
  elegida con probabilidad uniforme): un lóbulo por su parte de la PSF;
  la desviación, dentro del disco que la luz ocupa en el plano de
  desviaciones (`filters::light_disc`), con la densidad de conexión del
  lóbulo (radial: uniforme en el disco; rayas: la raya por la
  probabilidad de la PSF que cae dentro de la luz y la distancia por su
  1/r ahí; brillo: uno de los destellos cuya caja toca la luz, por su
  brillo y el área de esa parte, y un punto en ella; una rejilla de 64 ×
  64 hace que solo visite los destellos cercanos); un rayo de sombra, y
  la radiancia de esa luz por `s`, el color del lóbulo, el color antes
  del filtro y la probabilidad de que los siguientes no dispersen. Las
  dos estimaciones se pesan con la heurística del balance lóbulo a
  lóbulo (`Filter::mis_weight`, `K / (K + p·q)`): las luces que cruza el
  primer tramo del rayo de una muestra que el filtro dispersó pesan eso
  (`integrator::radiance_weighted`, `Lights::crossed_camera_weighted`) y
  la conexión, `s·L` por su color y el mismo peso. Números en
  `DIM_LENS_FILTER_LIGHT` = `5 << 20` (seis por filtro). **Medido** (`rt
  --filter-noise`, la tabla del final de la hoja) en el frasco de la
  hoja a 192 × 144, 16 muestras, seis semillas (varianza de cada canal
  de cada píxel entre las semillas, recortada a 64, media sobre la
  imagen; sin filtro, 1,49), con los filtros del veredicto: estrella 1,
  de 4,68 sin conexión a 1,81 con ella; rayas 1, 2,98 → 1,60; brillo 1,
  11,09 → 3,29; difusión blanca 1, 12,09 → 3,25; difusión negra 2, 18,41
  → 3,69; red 1, 5,41 → 3,09. El ruido que añade el filtro (lo que pasa
  de 1,49) baja 10,2 veces en la estrella, 13,8 en las rayas, 5,3 en el
  brillo, 6 y 7,7 en las difusiones y 2,5 en la red (cuyo ruido es ya
  sobre todo el de su suavizado), con las medias iguales dentro del
  ruido de la dispersión sola (de −0,9 % a 0 %; la suma exacta del test
  lo confirma lóbulo a lóbulo); cuesta, en rayos, del 0,2 al 2,4 % más
  en los núcleos dispersos y el 31 % en las difusiones, cuya cola
  alcanza la luz desde toda la imagen (el tiempo, con la máquina
  cargada, no lo separa; el brillo, que recorre los destellos cercanos a
  cada luz, tardó en la hoja un 20 % más que la dorada). En la primera
  hoja: estrella 10,03 → 2,71, rayas 8,57 → 2,71, brillo 10,37 → 9,24
  (su destello dependía de la celda de la pupila, que la conexión no
  elegía), red 7,72 → 3,04. Diafragma, bokeh y foco no cambian: la
  conexión sale del punto de la pupila de la muestra. Lo que queda de
  ruido es de los brillos de las superficies (reflejos de las luces),
  que la conexión no ve: solo la dispersión los alcanza.
- Una lente sin filtros no saca ningún número nuevo ni traza nada nuevo:
  **todos los *hashes* de antes intactos** (ejemplo, E5, E5c, E5b-1,
  pases, *denoise* y O1 `0xcfc57d4a`). **RSB**: tres huecos de 28 B al
  final de `LENS`, tras el relleno de la imagen, escritos solo cuando hay
  algún filtro (una `LENS` de O1 sale byte a byte igual y se lee sin
  filtros). Escena de paridad `example::o3a_scene` (difusión negra 1/2,
  estrella de 6 a 15°, rayas 1/2 sobre un diafragma de 6 láminas, las
  luces de fondo de O1; `rt --write-o3a-example`, `tests/fixtures/o3a.rsb`):
  `PINNED_O3A_FILTERS_4SPP = 0x49938f3b`
  (`0x715dc88e` en la primera hoja y `0x625d565d` tras el veredicto, antes
  de la mezcla con E12, que lo movió) en escalar, SSE2 y AVX2, en WASI
  (escalar y `simd128`), en el `rt_wasm.wasm` real (también con los pases;
  en CI), por el código de la página y con 1, 4 y 16 hilos.
- **Interfaz.** `src/data/lens-filters.ts` (claves estables, nombres
  genéricos es/en, una frase de lo que hace cada uno; los números son los
  del motor y un test los compara con `filters.rs`). `CameraOptics.filters`
  (opcional: las ópticas de antes no lo escriben); elegir un tipo de bokeh
  o *Disco sencillo* conserva los filtros. *Cámara ▸ **Filtros***
  (`src/ui/panels/insp-filters.ts`): la pila, *Añadir filtro* (hasta
  tres), y por filtro tipo con su frase, ×, *Grado* (1/8 … 2), y según el
  tipo *Tinte* (con *Tinte propio*), *Puntas* y *Ángulo*; todo por el
  *store*, una entrada de deshacer por cambio. **Vista previa**:
  `render/lens-filter-image.ts` calcula los núcleos en píxeles (las
  gaussianas; la cola de Cauchy como cuatro gaussianas ajustadas a su
  energía, error de la CDF ≤ 1 %; las rayas como 49 tomas de peso 1/r; los
  puntos del brillo con el mismo *hash* que el motor) y su convolución en
  TS; `render/lens-filter-pass.ts` hace lo mismo en WebGL para el modo
  Rápido (la escena a un objetivo lineal de medio flotante, gaussianas
  anchas a tamaño reducido, rayas y puntos a media resolución con las tomas
  de dos en dos, y la curva y el espacio de color del visor al final) y en
  las imágenes rápidas de la vista previa; el medidor dice *Filtros:
  aproximación, el render lo hace el motor*. `tools/lens-filters-check.mjs`
  (Chromium local): ocho comprobaciones, `docs/ui/lens-filters.png` y, para
  mirar, `out/lens-filters-viewport.png`.
- **Hoja** `out/lens-filters-sheet.html` (`node
  tools/lens-filters-sheet.mjs`, `rt --filter-sheet`): el frasco de
  perfume con un foco pequeño detrás, dentro del encuadre, y otro justo
  encima del encuadre, 512 × 384 y 128 muestras, cada tipo a 1/4, 1 y 2
  junto a la imagen sin filtro, las dos pilas (difusión negra 1/2 +
  estrella 6; dorada 1 + rayas) y, para comparar, estrella 1, difusión
  negra 2 y brillo 1 sin la conexión; al final, la tabla del ruido
  medido con y sin la conexión (`rt --filter-noise`,
  `out/lens-filters-sheet/noise.json`). Lo que se ve en la segunda, para
  el veredicto (regla 11): las difusiones, igual que en la primera (halo
  alrededor del foco y velo desde el que está fuera del encuadre, la
  negra con menos subida de las sombras); la dorada calienta el halo y
  el velo del foco y no el suelo; la estrella a 1/4 da rayas cortas, a 1
  llegan a media distancia del borde y a 2 al borde, finas y afiladas
  (su grosor visible es el del foco, que mide 0,73°), y las del foco de
  fuera del encuadre entran por arriba a 1 y 2; la red suaviza y deja
  una cruz corta y tenue; las rayas son una línea fina y azulada que no
  tiñe el suelo; el brillo es un halo suave con grano en el borde (con
  un foco tan grande como este, cada destello es una copia del foco; con
  luces pequeñas serían puntos finos). Quedan chispas sueltas de los
  reflejos de las luces en el vidrio (la conexión solo ve las luces, no
  sus brillos).
- **Veredicto de la primera hoja** (del líder) y lo que cambió. (1) La
  dorada y las rayas teñían todo el cuadro: el tinte va solo a lo
  disperso ancho (la cola de la difusión, por su parte de la densidad a
  cada distancia, y las rayas); el núcleo estrecho, que cae sobre la
  imagen, queda neutro; los tintes son más suaves (dorada 1,25/0,98/0,62
  → 1,08/1/0,86; rayas 0,7/0,92/1,4 → 0,82/0,95/1,25), las rayas tienen
  su `s` (`STREAK_S`, 0,02 … 0,07) y la dorada la de la difusión negra.
  En la escena de la hoja, el azul/rojo del suelo lejos de las luces se
  mueve un 1,8 % a 1 y un 3,1 % a 2 con la dorada, y un 2,3 % y un 3,2 %
  con las rayas (test, límites 3 % y 6 %). (2) La cruz de la red cruzaba
  el cuadro: ahora mide de 0,6° a 3,5° según el grado (a 2, el 14,6 %
  del ancho de la hoja) y lleva el 10 % de lo disperso (antes, la
  mitad); el resto es su suavizado, y cada raya de la cruz es más tenue
  junto a la luz que una de la estrella del mismo grado. (3) Las rayas
  de la estrella no crecían con el grado: ahora su largo es el del grado
  (1,9°, 3°, 4,6°, 7,2° y 12°: en la hoja, un cuarto del medio cuadro a
  1/4, el 60 % a 1 y todo a 2), con una densidad 1/r que se afila hasta
  0 en su punta, y su `s` (`STAR_S`, 0,073 … 0,11) crece como la
  integral de esa densidad, de modo que junto a la luz brillan igual en
  cada grado (± 15 %, test) y su grosor (0,02°) no cambia. (4) El brillo
  salía como una corona de manchas (las 36 celdas de la pupila): ahora
  es un halo suave (una gaussiana de 1°, el 40 % de su lóbulo radial, el
  resto el núcleo de 0,25°) con el grano de una nube fija de 4096
  destellos (el 30 % de lo disperso); cada muestra toma un destello de
  la nube (gaussiana 2D de 1°, distancias estratificadas, direcciones y
  brillos de un *hash*, los brillos exponenciales como los de un
  moteado), sin que importe por dónde cruza la pupila; la conexión elige
  uno de los destellos que tocan la luz, por su brillo y el área de su
  caja dentro (una rejilla de 64 × 64 limita la búsqueda a los
  cercanos), y un punto en esa parte. Sin celdas, la pupila virtual del
  estenopo de (6) sobraba y se quitó. (5) Las tablas de `s` solo cambian
  en la estrella y las rayas: la red y el brillo siguen con la de las
  difusiones, y las difusiones blanca y negra y el suavizado dan los
  mismos bits que antes (sus celdas de la hoja son las de la primera).
  El *hash* de O3a se movió (la estrella y las rayas de su pila).
- **Veredicto del responsable (segunda hoja).** Aceptada: la dorada
  calienta el halo y deja neutro el cuadro, la red es una cruz modesta
  sobre su suavizado, las rayas de la estrella crecen con el grado y
  siguen finas, las rayas son una línea con la imagen neutra y el brillo
  es un halo suave con grano. Sobre los puntos de «No encajó»: (9) los
  largos en ángulo calibrados en el 85 mm de la hoja son lo correcto (un
  filtro real es angular; que con un 50 mm la estrella se vea más corta
  respecto al cuadro es lo que pasa de verdad): se quedan así, sin
  escalarlos con el campo; (10) la nube fija de destellos es lo correcto
  (un vidrio de brillo es un patrón fijo): se queda; (11) a (13),
  aceptados.
- **Tests** (cada uno comprobado reintroduciendo el error): 16 en
  `optics::filter_tests` de rt-core y uno en `optics::filters`: grados →
  `s` (sin interpolar, falla); difusión blanca que conserva la media de
  un campo blanco ± 0,5 % (un peso del 95 %, falla); difusión negra a 1
  entre 0,90 y 0,97 (sin absorción, falla); estrella de 6 con la energía
  en seis rayas ± 2° más allá de 1° (una raya de más, falla); dorada con
  la cola cálida y el núcleo neutro, también en una imagen (el tinte
  también en el núcleo, o la parte de la cola al revés, fallan); tres
  filtros de grado 0 = sin filtro bit a bit (el grado 0 que dispersa,
  falla); filtros que cambian la imagen y dan los mismos bits en cada
  ruta SIMD; ida y vuelta de `LENS` y la de O1 byte a byte (escribir
  siempre los huecos, falla); valores fuera de rango (una estrella de 5,
  falla); el *hash* de los destellos del brillo, fijo; la conexión que
  da la misma imagen que la dispersión sola a 1024 muestras ± 3 % en
  cada tipo (las luces cruzadas sin peso o la conexión sin `s`, fallan);
  la suma exacta, sin renderizar, de la dispersión pesada y la conexión
  contra la dispersión sola en cada lóbulo, también con una luz que solo
  es medio disco, con un brillo y una luz pequeña y con la dorada (las
  rayas sin MIS, la densidad radial al doble, la caja del destello mal
  medida o la raya elegida sin su probabilidad, fallan); el brillo como
  nube y no corona (los destellos en anillo, o todos igual de
  brillantes, fallan), con el destello de cada muestra por su brillo y
  la conexión eligiéndolo por su brillo y su parte dentro de la luz (sin
  el brillo en una u otra, fallan); la rejilla de los destellos contra
  todos ellos en 3000 luces (sin el margen de la caja, falla); la
  estrella que se alarga con el grado sin ensancharse (el largo fijo, o
  la `s` fija, fallan); y la red con la cruz corta y más tenue que la
  estrella (la mitad de su luz en la cruz, falla). El *hash* de O3a (los
  números de los filtros en la tabla de Sobol, falla). `rt-cli`: 1/4/16
  hilos con filtros, las celdas de la hoja (una luz dentro y otra fuera
  del encuadre), `--only`, el azul/rojo del suelo de la hoja lejos de
  las luces con la dorada y las rayas a 1 y 2 (el tinte también en el
  núcleo, o los tintes de la primera hoja, fallan), los largos de la
  estrella y la red en el cuadro de la hoja, la varianza entre semillas
  de `--filter-noise` (sin recortar, o dividida entre las semillas y no
  entre una menos, falla) y sus dos filas por filtro, la de la conexión
  con más rayos. `tests/lens-filters.test.ts` (14): los datos son los de
  `filters.rs` (claves, grados, tablas de `s` y de largos, anchos,
  tintes), nombres y frases en los dos idiomas y sin marcas, `gradeS`,
  `filterS` y `lineLengthDeg` (la estrella con la `s` de las difusiones,
  falla), óptica no neutra con filtros (una que los ignora, falla) y
  normalizada a tres (sin recortar, falla), los huecos de `LENS` como
  los lee `rt` (sin las puntas o sin el ángulo, fallan), `o3a.rsb` y
  `o1.rsb` byte a byte, la energía de la aproximación (la cola sin su
  parte, falla), la estrella a su ángulo (5° de más, falla), la dorada
  con el halo cálido y el núcleo neutro, y la red con la cruz teñida y
  el suavizado no (la cola sin tinte o el suavizado teñido, fallan), las
  rayas de la estrella hasta el largo de su grado (un largo fijo, o sin
  afilarse, fallan), y con el `rt.wasm` real el *hash* de O3a y la
  aproximación contra el motor en el horno blanco con las piezas del
  ejemplo por bloques de 4 × 4, < 2 % (sin la absorción de la negra,
  falla).

**No encajó con el plan.** (1) La **conexión con las luces** no estaba
en el encargo: la propuso el líder tras la primera hoja y, medida, la
llevan todos los tipos y no solo los dispersos (estrella, rayas,
brillo), porque la cola de las difusiones daba el mismo ruido de chispas
alrededor de una luz pequeña; es la misma imagen en promedio y sigue
siendo espacio de rayos. (2) La ventana de render no tiene imagen: la
convolución en TS es la referencia del pase WebGL, la que comparan los
tests con el motor y la que se aplica a las imágenes rápidas de la vista
previa. El fotograma de la IA (X4) sigue sin filtros. (3) Aún no hay
sección *Lente* en el inspector (llega con O2): *Filtros* es una
subsección de *Cámara* junto a *Bokeh* y *Óptica avanzada*. (4) La
comparación con el motor «en la escena del horno» se hace por bloques de
4 × 4 (si no, el ruido de dos renders a 128 muestras cuenta como
diferencia). (5) Los grados → `s`, los anchos y el resto de números son
propuestas para el veredicto (regla 11). (6) La primera hoja se rindió
sin la conexión y con un estenopo que fijaba la celda del brillo: el
destello salía como un fantasma de toda la imagen; se arregló sacando la
celda de una pupila virtual, y tras el veredicto el destello ya no
depende de la pupila y esa pupila virtual se quitó. (7)
`rt --filter-sheet --only` vuelve a renderizar celdas sueltas de la hoja;
las tres de brillo y la de comparación salen de ahí. (8) La propuesta
para el brillo (que la conexión eligiera también la celda) la aceptó el
veredicto con los destellos al azar por muestra: la conexión elige el
destello y, como ya no depende de la pupila, el punto de la lente es el
de la muestra (no hay celda que elegir). (9) El veredicto pedía los
largos de la estrella y la red en fracciones del cuadro; están en
ángulo, como los de un filtro real, calibrados en el 85 mm de la hoja:
con otra focal ocupan otra parte del cuadro (con un 50 mm, la estrella a
2 llega al 60 % del medio cuadro). Si se quieren relativos al cuadro, la
lente tendría que conocer el campo de la cámara. (10) «Direcciones al
azar por muestra» es una nube fija de 4096 destellos de la que cada
muestra toma uno al azar: con una dirección nueva en cada muestra la
imagen convergería a un halo liso, sin grano; con la nube fija converge
a un halo con el grano de sus destellos, y con el halo suave debajo no
se leen como manchas sueltas. (11) La red tiñe solo su cruz: su
suavizado cae sobre la imagen, como el núcleo de la dorada. (12) El
visor Rápido dibuja la nube del brillo como la gaussiana de la que sale
(su promedio); el grano es del motor. (13) El *hash* de O3a se movió con
el veredicto (`0x715dc88e` → `0x625d565d`); los demás, no. La mezcla con la rama de la sesión (E11, E12) lo movió otra vez, a `0x49938f3b`, y `o3a.rsb` creció a 9352 bytes con el `RNDR` de 64 B.

## P5 · Actualizar desde la aplicación — **Sonnet** — hecha

**Qué.** Petición del usuario: hoy *Ajustes ▸ Actualizaciones ▸
Descargar* abre el instalador en el navegador; debe **instalar la
actualización y reiniciar la aplicación** desde dentro, preguntando antes
por los cambios sin guardar.

1. **Pregunta** (solo si el proyecto tiene cambios): «¿Guardar los
   cambios de «X» antes de actualizar?» con **Guardar**, **Guardar
   como…** y **Salir sin guardar**; `Esc` cancela (`UI.md` §4.3, en el
   sitio). *Guardar* y *Guardar como…* siguen solo si el proyecto se
   escribió de verdad. Es la misma pregunta de cerrar, con el tercer
   botón: `afterUnsavedCheck` gana *Guardar como…* para todos los usos
   (cerrar, nuevo, abrir), que es lo coherente.
2. **Escritorio instalado (Windows)**: el lanzador descarga el
   `-setup.exe` de la release (el mismo `curl` de los modelos, con
   progreso), descarga `SHA256SUMS.txt` y **comprueba la suma** con el
   `sha256` propio (si no cuadra, no se instala y se dice); lanza el
   instalador en silencio, `setup.exe /S /LAUNCH`, suelto del proceso, y
   la aplicación sale limpiamente (la ventana se cierra). El instalador
   (`packaging/windows/installer.nsi`, sin *plugins*): espera hasta 30 s a
   que `repackshot.exe` quede libre (bucle `FileOpen` en modo escritura
   con `Sleep`), instala, y con `/LAUNCH` arranca la aplicación al acabar
   (también en silencio). Un test de contrato lee el `.nsi` como texto y
   comprueba el bucle de espera y el `/LAUNCH`, como hizo U10.
3. **Portable (Windows y Linux)**: el lanzador descarga el portable
   (`.zip` o `.tar.gz`), comprueba la suma, lo extrae a
   `<carpeta del exe>/update-<tag>/` (el `zip` propio del motor de
   ejecución de IA; en Linux `tar.gz` con el `tar` del sistema, como
   `curl`), y se **sustituye a sí mismo**: renombra el ejecutable en uso
   a `repackshot.old(.exe)` (un ejecutable en uso se puede renombrar,
   no sobrescribir), mueve los archivos nuevos a su sitio sin tocar
   `data/` ni `portable.txt`, arranca el nuevo ejecutable suelto con
   `--after-update` y sale; el nuevo, al arrancar, borra los `.old` y la
   carpeta `update-*`. Si algo falla a medias, deja lo viejo donde estaba
   (orden: extraer todo primero, renombrar después) y lo dice.
4. **Interfaz**: en *Ajustes ▸ Actualizaciones*, cuando hay versión
   nueva el botón principal es **Instalar y reiniciar** (en la web sigue
   *Descargar*, que abre la release, y lo dice); *Notas* se queda. La
   fila enseña el progreso: *Descargando… 45 % · 3,2 de 7,1 MB*,
   *Comprobando*, *Instalando… la aplicación se reiniciará*; los fallos
   (descarga, suma, sin espacio, no es portable ni instalado) en la fila
   con *Reintentar*. El aviso de inicio (cuando hay versión nueva) ofrece
   el mismo *Instalar y reiniciar*. Mientras se descarga se puede cerrar
   *Ajustes*; el progreso sigue en la fila al volver.
5. **API del lanzador** (`rt-app`, documentada en su README):
   `POST /api/update/install` `{tag, assetUrl, sumsUrl}` → `202` y
   `GET /api/update` `{state: IDLE|DOWNLOADING|VERIFYING|INSTALLING|
   FAILED, received, total, error, message}`; `POST /api/update/cancel`.
   Solo URLs `https://github.com/<owner>/<repo>/releases/download/…` del
   *feed* configurado (lista blanca, como el resto de descargas).

**Depende de.** P2, P3e, U6 (Buscar actualizaciones).

**Criterio.** Test TS: con cambios sin guardar la pregunta tiene los
tres botones y cancela con `Esc`; *Guardar como…* escribe y sigue; sin
cambios no pregunta; la petición al lanzador lleva la URL del activo
que toca (instalador o portable según el modo) y nunca una URL fuera de
la lista blanca; cadenas `es`/`en`. Test Rust: una suma que no cuadra
no instala; la sustitución del portable sobre una carpeta de prueba con
un ejecutable falso deja los archivos nuevos, el `.old`, `data/`
intacta y el relanzamiento con `--after-update`; el arranque posterior
limpia; el contrato del `.nsi`. Comprobación en navegador
`tools/update-install-check.mjs` contra el lanzador real y un servidor
local que hace de GitHub (release falsa, activo falso con su
`SHA256SUMS.txt`): el camino portable de Linux de punta a punta (la
aplicación se reinicia con la versión nueva, en una copia en
`out/update-check/`), y el de Windows solo hasta «lanzar el instalador»
(Wine no ejecuta NSIS: anotarlo). Captura `docs/ui/update-install.png`.
La primera actualización real desde la aplicación será de la versión
que lleve esto a la siguiente: apuntarlo en las notas de la release.

**Hecho.** `engine/crates/rt-app/src/update/` (`feed.rs`: la lista blanca —solo
`github.com/<owner>/<repo>/releases/download/<versión>/<archivo>` del repositorio de
`src/data/update-feed.ts`, que el *crate* lee al compilarse—, los nombres de los paquetes y las
sumas; `portable.rs`: extraer, sustituir en el sitio con deshacer, limpiar al arrancar; `mod.rs`: el
estado, el hilo y las rutas `GET /api/update`, `POST /api/update/install` y `…/cancel`);
`ai/download.rs` admite un tamaño solo acotado; `process::spawn_detached`; `--after-update`;
`/api/info` dice `updateApi` y `afterUpdate`. Instalada en Windows: descarga el `-setup.exe` y las
sumas, comprueba el SHA-256 propio y, parado el lanzador, ejecuta `setup.exe /S /LAUNCH`; portable
(Windows `.zip` con el lector propio, Linux `.tar.gz` con el `tar` del sistema, tras mirar su lista):
extrae todo a `update-<tag>/`, renombra lo viejo a `.old`, pone lo nuevo sin tocar `data/` ni
`portable.txt`, deshace lo hecho si un paso falla (probado inyectando el fallo en cada uno de los
ocho) y arranca el ejecutable nuevo con los argumentos de antes y `--after-update`; el nuevo borra
los `.old`, las carpetas `update-*` y la descarga. `installer.nsi`: la espera de hasta 30 s
(`FileOpen` en modo `a` y `Sleep 500`, 60 vueltas), `/LAUNCH` en `.onInstSuccess`, y en silencio
ni página de modelos ni acceso directo del escritorio que se borró. Interfaz (`ui/updates.ts`,
`io/update-install.ts`): *Instalar y reiniciar* en la fila y en el aviso (en la web, *Descargar* y
una línea que dice qué hace), progreso (*Descargando… 45 % · 3,2 de 7,1 MB* con barra,
*Comprobando…*, *Instalando…*), *Cancelar la actualización*, fallos con su motivo y *Reintentar*,
seguimiento del lanzador cada 400 ms (cerrar *Ajustes* no la para; una página recargada la
recoge), y la pregunta por los cambios sin guardar con **Guardar como…** para todos los usos
(`afterUnsavedCheck`: cerrar, nuevo, abrir, actualizar; *Guardar* y *Guardar como…* siguen solo si
se escribió; `Esc` cancela), que en la actualización sale en el sitio del botón. Pruebas: 15 de
sockets en `tests/update.rs` con el `curl` y el `tar` reales contra un servidor local (de punta a
punta el portable de Linux y el de Windows, la suma que no cuadra, la lista blanca, cancelar,
reanudar), 16 unitarias del módulo, 4 de contrato del `.nsi` en `tests/installer.rs`, 35 de
TypeScript en `tests/update-install.test.ts` (más los de siempre, ajustados a tres botones).
`tools/update-install-check.mjs` contra el lanzador real: el portable de Linux de punta a punta en
`out/update-check/linux/` (la versión nueva arranca en el mismo puerto con `--after-update`, el
marcador está en su `app/`, los `.old` ya no están, `data/` y `portable.txt` como estaban) y el
instalado de Windows bajo Wine hasta el instalador arrancado con `/S /LAUNCH`. Captura
`docs/ui/update-install.png`. Se repararon de paso `tools/updates-check.mjs` (roto desde U10 y
P3b: un segundo `.update-notice`, enlaces por un ancla en vez de `window.open`, `open-url` del
lanzador, la versión fijada a 0.1.0) y el `Esc` de *Ajustes* con una pregunta abierta, que
cancelaba la ventana entera en lugar de la pregunta.

No encajó con el plan: (1) *INSTALLING* cubre el desempaquetado y el cambio de archivos, y la
página no puede cerrar la ventana hasta que están en su sitio, así que `GET /api/update` lleva un
campo más, `ready` (contrato ampliado, no cambiado). (2) El lanzador **no sale él al acabar**: sale
cuando se cierra la ventana (la página la cierra al ver `ready`; `--serve-only` sin ventana sale
solo) y **solo entonces** arranca el instalador o el ejecutable nuevo; si arrancase antes, el nuevo
se encontraría con el puerto, `instance.json` y el perfil de la ventana del viejo (y una ventana de
navegador huérfana). (3) `POST /api/update/install` admite un `size` opcional: `curl` no da el total
antes del cuerpo y la barra no inventa números; sin él, solo los MB recibidos. (4) La espera de 30 s
del instalador solo va **en silencio**; a mano, pregunta enseguida como antes, para no hacer esperar
medio minuto a quien lo ejecuta con la aplicación abierta. (5) Un instalador en silencio tampoco
reescribe `pending-models.json` ni recrea un acceso directo del escritorio que la persona borró: no
estaba en el texto y lo habría hecho en cada actualización. (6) El tercer botón dice *Salir sin
guardar* solo en la actualización; al cerrar, nuevo y abrir sigue siendo *No guardar*. (7) Si el
proyecto cambia mientras se descarga, al cerrar para reiniciar se pregunta otra vez; si no ha cambiado
desde que se contestó, no. (8) NSIS no corre bajo Wine: el `.nsi` se compila con `makensis -WX` y su
contrato se lee como texto; el instalador real, el cierre de la ventana propia (WebView2) con
`close-ok`, el cambio de un ejecutable en uso en Windows y SmartScreen quedan por probar en un
Windows real. (9) El zip propio exige nombres de `[A-Za-z0-9._+-]` y 8 niveles: el `dist/` de hoy
cumple, un archivo de `app/` con un espacio en el nombre haría fallar la extracción (con `extract`,
sin cambiar nada). (10) Con la máquina a carga 20–30 (otros agentes), dos pruebas ajenas a esta fase pasan del tiempo:
la de *denoise* del *pool* en `pathtracer` (pasa sola al repetir) y el `afterAll` de
`ai-passes-browser` (cierra el navegador en 10 s; sus siete pruebas pasan, el cierre no).

## E6 · Bisel de aristas, madera y tela en el sombreado — **Opus** (bisel primero; era Sonnet) — hecha

**Qué.** Primero el **bisel de aristas en el sombreado** (decisión Fable,
tras v0.1.5: es la mejora de realismo más visible que queda para modelos
CAD): normal redondeada cerca de las aristas vivas con radio en mm por
material (el campo *Bisel de arista* del inspector deja de decir
*próximamente*), por el método de las aristas más cercanas al punto
(se buscan en la malla, con precálculo de las aristas vivas por ángulo
diedro > 20° y una rejilla o BVH propio de aristas), mezclando la normal
de las dos caras según la distancia a la arista con un perfil circular;
vale para el reflejo (la luz coge la arista) y para la sombra; límite de
coste medido (≤ +15 % en el ejemplo con 0,3 mm). Después, portar a
`rt-core` las recetas procedurales de EZ Packshot (veta
de anillos con dos colores, variación, ruido axial y poro; trama de hilos
con tipo de tejido, hilos por cm y relieve) como funciones de sombreado
con ruido propio (Perlin o *simplex*, escrito aquí y con la estadística
fijada por test), escala en tamaños de pieza; bisel de aristas en el
sombreado (normal redondeada cerca de aristas vivas, radio en mm). La
pelusa queda fuera.

**Depende de.** E3.

**Criterio.** Evaluar las funciones sobre un plano y comprobar
estadísticas (periodo de anillos, contraste, media de rugosidad);
renders de las 13 maderas y las 12 telas como esferas con `rt`; el bisel
cambia la normal solo a menos del radio de una arista viva (cubo).

**Hecho — bisel de aristas** (primera parte, su propio *commit*).

- **Aristas vivas** (`rt_core::geometry::edges`): una vez por malla, la
  primera vez que la pide una instancia con bisel, y guardadas con la malla
  (sobreviven a las actualizaciones sin `MESH`). Soldado por posición exacta
  y luego a menos de 10⁻⁵ del tamaño de la malla (la costura de un torno);
  arista con un triángulo = borde; con dos = viva si sus normales,
  orientadas de forma coherente, se separan más de 20° y la malla no la
  suaviza con sus normales de vértice; con tres o más, ignorada. BVH binario
  propio de segmentos (hojas de 4) y una holgura por triángulo; cada punto
  mira como mucho 128 nodos y 8 aristas a menos de dos radios.
- **La normal** (`rt_core::bevel`): la de un redondeo circular tangente a
  las dos caras, `normalize(r n + (r tan(θ/2) − d) v)`, con la normal de
  sombreado del punto y la de la cara de enfrente interpolada en la arista;
  convexas y cóncavas con la misma fórmula; la huella nunca pasa de `r`
  (aristas agudas: el radio baja a `r / tan(θ/2)`); bordes abiertos, un
  ángulo recto hacia fuera. Varias aristas: el desplazamiento más corto que
  cumple todas (exacto en la esquina de una caja; la mayor petición, no la
  suma, en una arista curva); si no caben, el radio baja por bisección (un
  borde fino se vuelve medio redondeo). Escala de instancia: el radio se
  divide por `∛|det M|` (con escala no uniforme, el redondeo transformado:
  elíptico, de radio medio `bevel_mm`). Se compone con el terminador (RTG
  II): los rayos salen del punto elevado por el terminador y luego por el
  redondeo, `d · a / |r n + w|` a lo largo de la normal biselada (lo justo
  para que toda dirección por encima del plano tangente del redondeo libre
  la cara), y la normal geométrica pasa a ser la del redondeo; una normal
  que miraría hacia atrás se dobla hacia el observador. Lo usan el
  integrador, los fotones de las cáusticas y el pase de normal.
- **Coste** (tiempo de CPU de un hilo, mínimo de tres, máquina compartida
  con otros dos agentes): botella de ejemplo de la interfaz con su bisel por
  defecto de 0,303 mm, 1,444 s → 1,489 s (**+3,1 %**); ejemplo del motor con
  0,3 mm en sus tres materiales, +0,7 %; escena de E6 (pocos triángulos,
  todos tocando aristas, biseles de 2–3 mm), +11 %. Por debajo del +15 %.
- **Sesgo**: una normal de sombreado más; MIS pesa las dos estrategias con
  la misma BSDF, pero no es recíproca: horno blanco con un cubo biselado,
  media 0,99995, píxeles entre 0,988 y 1,014.
- **RSB**: `MATL` pasa a 76 B con `bevel_mm` (f32, 0 = vivo), en el orden
  acordado con E9 (detrás irán `scatter_mm`, `scatter_color[3]`,
  `scatter_g`, `abbe`); un `MATL` de 72 B se lee sin bisel. El escritor
  TypeScript manda `bevelRadiusMm` de todas las familias salvo el emisor.
- **Interfaz**: la nota del campo *Bisel de aristas* deja de decir
  *próximamente* («Es del material. El modo Completo redondea las aristas
  vivas en el sombreado, como un redondeo de este radio; la vista Rápida
  las muestra vivas»). La vista *Rápida* no lo dibuja.
- **Hashes**: los fijados no se mueven (ninguna escena fijada lleva bisel:
  ejemplo `0x223515c3`, E5 `0xbf8abd5b`, cielo de E5 `0x2fcb098a`, E5c
  `0x8bb09f6b`, *denoise* `0xab15f290`, cáusticas `0x55d60f2f`). Nuevo:
  la escena de E6 (`rt --write-e6-example`: caja bicolor en dos mallas con
  escala no uniforme, cilindro metálico de 48 lados, placa más fina que dos
  biseles) **`0xfccda027`** y sus seis pases (`PINNED_E6_PASS_*`), iguales
  en escalar, SSE2, AVX2, WASI, el `rt.wasm` real (también por el código de
  la página) y con 1, 4 y 16 hilos en `rt` y en el lanzador; paso nuevo en
  `engine.yml`.
- **Tests**: 29 nuevos en `rt-core` (extracción: caja, esferas suaves y
  facetadas, bordes y enrollado incoherente, costura de torno, consultas
  frente a fuerza bruta y holgura; bisel: el cubo cambia solo a menos del
  radio y en la forma exacta, simetría entre caras, esquina como esfera,
  esfera suave intacta, arista curva sin cuentas, elevación de una arista
  curva, pieza en dos mallas igual que en una y costura plana, cóncava,
  borde fino, escala de instancia, aristas agudas y poco marcadas, vecino al
  otro lado de un hueco, nunca de espaldas, emisores; renders: la arista
  coge una luz por debajo del plano de la cara, un brillo que la arista viva
  no tiene, un espejo refleja lo que hay bajo el plano, horno blanco; pase
  de normal; RSB), `rt-cli` y `rt-app` (1/4/16 hilos) y la interfaz
  (`materialToRsb`, tamaños de sección, ida y vuelta, `e6.rsb` con el
  `rt.wasm` real).

**No encajó con el plan (bisel):**

- **Bordes entre mallas de una pieza.** La interfaz manda una pieza con
  materiales por cara como una malla por material, con la misma
  transformación: sus bordes comunes no son bordes. `BevelSetup` empareja
  los bordes de las mallas con la misma transformación (bit a bit): si la
  superficie sigue lisa es una costura (sin bisel) y si dobla más de 20° es
  una arista viva con la cara de la otra malla. Se calcula en cada
  preparación de la escena, por instancia. Una costura que no coincida
  (T, soldaduras de más de 10⁻⁵) sigue leyéndose como borde.
- **El pase de normal lleva el bisel** (es la normal con que se sombrea):
  las escenas con bisel cambian sus pases; las fijadas no lo llevan.
- **Todas las instancias de un preset ya traían 0,25 % del tamaño de la
  pieza** (el arreglo del Doctor): desde ahora todo proyecto existente se
  ve con bisel en *Completo* sin tocar nada. Es lo que pedía el Doctor,
  pero cambia el aspecto de los proyectos guardados.
- **Lo que no se redondea**: aristas que la malla suaviza con sus normales
  de vértice (ya son redondas), aristas no variedad y caras duplicadas;
  con escala no uniforme, el umbral de 20° se mide en el espacio de la
  malla.
- **Un borde más fino que dos radios** se ajusta solo en ese punto: la cara
  ancha de al lado conserva su radio, así que el redondeo es elíptico
  (continuo en la arista).

**Hecho — madera** (segunda parte, su propio *commit*; detalle en
ARCHITECTURE §5.2 octies).

- **Ruido propio** (`rt_core::pattern::noise`): ruido de gradiente de la
  descripción pública de Perlin (2002) con nuestra permutación (Fisher–Yates
  con el PCG del motor, semilla fija), `fbm` y un *hash* entero. Estadística
  fijada: media −0,0012, varianza 0,0730 (2¹⁸ puntos), rango
  [−0,993, 0,941]; `fbm` de 4 octavas, varianza 0,0274; los ocho primeros
  valores de la permutación, fijados.
- **La receta** (`pattern::wood`), en milímetros físicos: anillos en diente
  de sierra (suben el 70 %, caen en el último 5 %) con el contraste de
  Michelson de cada especie y la media de la vista *Rápida*; serpenteo de
  media separación a 25 mm; fibra ±5 % a 0,3 × 30 mm; poros en anillo o
  difusos, de `0,15 × anchura × poreDepth` de hondo; figuras de tiras
  (bambú, con sus haces y sus nodos), moteado (MDF) y vetas (ébano).
  Rugosidad anisótropa 0,3 a lo largo de la médula (la tangente del marco de
  sombreado sigue la veta; no queda nada para otra fase).
- **Nudos** (`pattern::knots`, pedido por el usuario): ramas en cono desde
  la médula que cruzan la pieza, colocadas por la semilla del material sin
  tocarse y sin rozar la superficie (≥ 45°, hasta 8 nuevos intentos, si no
  se descartan), con la fibra y los anillos fluyendo a su alrededor (de 1,5
  a 3 radios, abombamiento 0,35 R) y su testa, bolsa de corteza, cuenco y
  grieta; la interfaz los coloca igual (`src/core/knots.ts`), la vista
  *Rápida* los oscurece sobre el color medio (`src/render/knots.ts`) y el
  inspector avisa de los que no caben («6 pedidos · 3 caben»). Mandos
  *Nudos*, *Tamaño*, *Variación*, *Oscuridad* (desactivados con una nota en
  bambú, MDF y ébano); por defecto, pino 4 de 10–25 mm (oscuridad 0,9),
  cerezo y nogal 1 (0,6).
- **Dónde**: en el espacio de la malla, la médula a lo largo del lado más
  largo, a 0,8 de él por debajo y 0,35 a un lado, nunca dentro de la pieza.
- **RSB**: sección nueva `PATN` (108 B, detrás de los `MATL`): material,
  tipo, dos colores, escala, 16 parámetros, figura y semilla. El escritor
  TypeScript la manda para cada material de madera.
- **Hashes**: los fijados no se mueven. Nuevo: la escena de dibujos de E6
  (`rt --write-e6-patterns-example`: tabla de roble biselada y esfera de
  nogal) **`0x2a3a7416`**, igual en escalar, SSE2, AVX2, WASI, el `rt.wasm`
  real y con 1, 4 y 16 hilos en `rt` y en el lanzador; paso nuevo en
  `engine.yml`. Con 0 nudos, los bits de la madera sin nudos.
- **Hoja** `out/wood-sheet.html` (`rt --pattern-sheet`, materiales de
  `tests/fixtures/patterns.rsb`, que escribe el escritor TypeScript): las 13
  maderas en esfera y en caja de 60 × 40 × 25 mm, antes, después y de
  cerca, y la fila de nudos del pino (0, 2 y 6 de 15 mm, 6 de 30 mm) en la
  cara grande de la caja y en una tabla de 300 × 100 × 20 mm.
- **Coste** (tiempo de CPU de un hilo, mínimo de tres, máquina cargada):
  la escena de dibujos de E6, casi toda madera (tabla y esfera), 0,762 s →
  1,058 s (**+39 %**) frente a la misma con el color liso: una docena de
  evaluaciones de ruido por punto de madera; el relieve reutiliza la
  fracción de anillo de la muestra (sin eso, +56 %). Los nudos, unos
  productos escalares por nudo y punto; su colocación, unas decenas de rayos
  por pieza al preparar la escena.
- **Tests**: 34 nuevos en `rt-core` (ruido: permutación, red y periodo,
  estadística fijada, *hash*; madera: perfil en diente de sierra y su media,
  periodo exacto de los anillos, contraste de Michelson y media de la vista
  *Rápida*, la madera de verano en su 40 %, media de cada figura en una
  tabla, poros en la banda de primavera y su hondo por anchura, los poros
  de un anillo no suman un escalón, fibra ±5 %, nodos del bambú cada
  150 mm y sus motas 11–19 por cm² en cualquier plano, la testa de un
  nudo; nudos: colocados como se piden y sin solaparse, la semilla y los
  primeros quietos, flujo alrededor y nada a 3 radios, más ancho lejos de
  la médula, nunca rozan y los descartados no se reponen, colocación fijada
  para la interfaz; escena: el dibujo es de su material, se pega a la pieza
  y escala con ella, médula a lo largo del lado largo y nunca dentro, la
  rugosidad estirada a lo largo de la veta, un render determinista distinto
  del liso, el pase de albedo es el color del camino, una tabla enseña los
  nudos pedidos y de su tamaño (2 / 6 / 6 discos de 17,3 / 15,9 / 33,9 mm
  para 2 × 15, 6 × 15 y 6 × 30 mm), la semilla y 0 nudos iguales bit a bit,
  un nudo más rugoso y su cuenco, en una bola nunca rozan; RSB), `rt-cli` y
  `rt-app` (1/4/16 hilos de la escena fijada) y la interfaz (`patternToRsb`
  de las 13 maderas y sus nudos, mandos desactivados, la colocación igual
  que el motor, `meetsSurface`, los nudos de una pieza, el *fixture* al
  día).

**No encajó con el plan (madera):**

- **La escala es física, no en tamaños de pieza** (decisión del líder sobre
  la primera hoja, por realismo): `ringDensity` pasa a ser anillos por
  100 mm y los presets llevan los de cada especie (roble 33, pino 20, arce
  40…; antes 14 para el roble, por pieza); el mando nuevo *Escala* los
  multiplica. SPEC §3.3 lo dice. Un proyecto guardado conserva su
  `ringDensity` antiguo, que ahora se lee por 100 mm.
- **Campos nuevos que el catálogo de EZ Packshot no tiene**: `ringContrast`,
  `poreSize`, `poreBand`, `woodFigure`, `woodScale` y los cuatro de los
  nudos (claves nuevas; ninguna renombrada).
- **El relieve de los anillos, fuera** (decisión del líder: las esferas
  parecían torneadas); solo relieve de poros, nudos y nodos del bambú. La
  primera hoja enseñó que los poros en anillo sumaban un escalón en cada
  anillo (la banda empezaba de golpe): ahora entra poco a poco, con un test
  que falla con la banda de antes.
- **Limitación de la vista *Rápida***: no pinta anillos, solo el color medio
  y los nudos oscurecidos; por eso tampoco el flujo de la fibra alrededor de
  los nudos que pedía el líder («la misma colocación y desviación»): la
  colocación es la misma, la desviación no tiene nada que desviar.
  Aceptado por el líder.
- **En una pieza pequeña caben menos nudos de los pedidos** (nunca se tocan
  ni rozan): en la caja de 60 × 40 × 25 mm, 2, 3 y 1 de 2 × 15, 6 × 15 y
  6 × 30 mm; en la tabla de 300 × 100 × 20 mm, todos. El inspector lo dice
  con una nota discreta.
- **El umbral de incidencia, 30° → 60° → 45°** (reglas del líder tras la
  hoja): un nudo cuyo eje corta la superficie a menos del umbral se saca otra
  vez hasta 8 veces y si no, se descarta. Con 30° la bola de pino seguía
  enseñando lágrimas: sus nudos la cortaban a 34–39°, y el borde del cono
  roza antes que su eje. Con 60° (lo que pidió el líder para quedarse con los
  nudos de frente) las piezas planas perdían nudos: las ramas suben 15–35°
  por el tronco y la médula está 24° a un lado, así que una cara plana ve sus
  nudos a 49–66° (la tabla de prueba, 1 de 2 y 10 de 12). Con 45° las piezas
  planas no cambian (2 / 6 / 6) y la bola solo pierde las lágrimas (sus
  nudos, a 47–64°): lo decidió la medida, con el visto bueno del líder.
- **Ajustes del líder sobre la fila de nudos**: el flujo alrededor de un nudo
  se desvanece de 1,5 a 3 radios (no de 3 a 5) y abomba 0,35 R (no 0,5 R):
  en la cara de la caja se leía líquido.
- **La pelusa (*fuzz*, *sheen*) sigue fuera**, como decía el plan.

**Hecho — tela** (tercera parte, su propio *commit*; detalle en
ARCHITECTURE §5.2 octies).

- **La receta** (`rt_core::pattern::cloth`, `PATN.kind` 2), en milímetros
  físicos: hilos de urdimbre y de trama redondos de través, con un hueco
  entre ellos, que suben donde pasan por encima y bajan donde pasan por
  debajo (una flotación larga se queda arriba) y enseñan las crestas
  inclinadas de la torsión de su hilo; cada hilo varía ±6 % de color y
  ±10 % de rugosidad. Tejidos: tafetán, sarga 2/2, raso de cinco lizos,
  lona (cesta 2 × 2), punto (*jersey*: uves de dos patas que se solapan
  fila a fila, cada punto de un jaspeado al azar), fieltro (fibras
  apelmazadas, sin hilos) y **sarga 3/1** (nueva, la del vaquero). El
  relieve (`weaveDepth`, media separación a 1) inclina la normal; la
  rugosidad se estira **a través** del hilo de encima (anisotropía 0,5:
  el brillo de las fibras; el fieltro no). El color medio es el de los
  hilos mezclados por la parte de la cara que cubre cada uno (0,5; raso
  0,72; sarga 3/1 0,685), y es el de la vista *Rápida* (`fabricMeanColor`).
- **Dónde**: proyección de caja sobre los ejes de la malla, mezclada con
  pesos `|nᵢ|⁸` en una banda estrecha sin costura; la urdimbre de pie en
  los lados.
- **RSB**: `PATN` de tipo 2 (los mismos 108 B): los dos colores de hilo,
  `scale_mm = 10 / threadCount`, relieve (`weaveDepth`) y torsión
  (`yarnTwist`), el tejido en `variant`. El escritor TypeScript la manda para cada material de tela.
- **Interfaz**: *Hilos por cm* (2–200, físicos), *Tejido* (con *Sarga 3/1
  (vaquero)*) y *Relieve del tejido* los pinta el modo Completo («lo
  pintan el modo Completo y los renders»); la nota de tela ya no dice que
  sea un color plano.
- **Hashes**: los fijados no se mueven (la escena de dibujos sigue en
  `0x2a3a7416`). Nuevo: la escena de tela de E6
  (`rt --write-e6-cloth-example`: cojín vaquero biselado y bola de punto)
  **`0xbb26399f`**, igual en escalar, SSE2, AVX2, WASI, el `rt.wasm` real y con
  1, 4 y 16 hilos en `rt` y en el lanzador; paso nuevo en `engine.yml`.
- **Hoja** `out/cloth-sheet.html` (`rt --pattern-sheet --only cloth`, del
  mismo *fixture*, que ahora lleva también las 12 telas): cada tela en
  esfera y caja, antes, después y de cerca, un campo de 10 mm visto de
  frente (donde se ven los hilos a su tamaño real) y el vaquero tejido en
  2/2 para comparar con su 3/1 (la primera hoja enseñaba también el carbono
  con 0,05 de relieve, que el líder eligió: ahora es su fila).
- **Coste** (tiempo de CPU de un hilo, mínimo de tres, máquina cargada):
  la escena de tela (cojín y bola, 320 × 240, 8 muestras), 0,784 s →
  0,844 s (**+7,6 %**) frente a la misma con el color liso: una tela tejida
  son unas pocas cuentas por proyección (tres evaluaciones con el *bump*);
  el punto, 18 elipses por evaluación.
- **Tests**: 10 nuevos en `rt-core` (tela: la parte de la cara de la
  urdimbre de cada tejido y su color medio, periodos y estructura —el raso
  nunca enseña dos tramas juntas, ni en diagonal; la lona va por parejas; la
  3/1—, relieve de media separación y plano a 0, variación por hilo, la
  torsión y su periodo, y ninguna sin ella, el punto en uve hacia abajo;
  escena: proyección en los ejes de la malla, la anisotropía a través del
  hilo de encima y el fieltro sin ella, la mezcla sin costura y exacta
  donde se juntan dos y tres proyecciones, el PATN de tela leído; la escena
  fijada), `rt-cli` (hoja, `--only`, `--write-e6-cloth-example`, 1/4/16
  hilos), `rt-app` (1/4/16 hilos) y la interfaz (`patternToRsb` de las 12
  telas, físico, límites y valores por defecto; color medio igual al del
  motor en la vista *Rápida* y en el `MATL`; mandos que pinta el motor;
  `projectScene`; el *fixture* con las telas). Se comprobó que fallan con
  22 mutaciones de la tela: todas cogidas; una (las proyecciones de peso
  menor que 0,5, ignoradas) escapaba al principio y la coge el test nuevo
  de la mezcla.

**No encajó con el plan (tela):**

- **Los hilos por cm, físicos y propuestos** (como la madera): el
  `threadCount` del catálogo era por tamaño de pieza (algodón 200, carbono
  90); ahora son hilos por cm y cada tela lleva los suyos de verdad
  (algodón 40, lino 18, sarga 36, vaquero 24, raso 100, lona 14,
  terciopelo 30, fieltro 20, punto 4 puntos por cm, malla 8, microfibra
  120, carbono 5 mechas por cm), aceptados por el líder (veredicto abajo).
  Un proyecto guardado conserva su `threadCount` antiguo, que
  ahora se lee por cm (hasta 200: el algodón de antes sale a 200 hilos por
  cm, invisible).
- **El vaquero pasa a sarga 3/1** (`TWILL31`, clave nueva; la `TWILL` de
  EZ Packshot es 2/2 y la siguen usando la sarga y el carbono): con 2/2 su
  color medio era un gris azulado (la mitad de la cara, trama blanca); el
  de verdad es de urdimbre. Cambia su color en la vista *Rápida*. La hoja
  enseña los dos para el veredicto.
- **Campos nuevos**: `yarnTwist` (0 en el carbono y la malla: mechas y
  monofilamentos lisos; 1 por defecto, sin mando).
- **A tamaño real, la mayoría de las telas no se ven** en un plano de
  producto (el algodón a 0,25 mm, menos de un píxel a 100 mm por 300 px):
  se promedian con las muestras del píxel, sin filtro propio (el color
  converge a la media y el relieve se vuelve rugosidad); algún *moiré* en
  esferas de sarga a pocas muestras.
- **El barniz del carbono sigue el relieve** (el *bump* es de toda la
  BSDF): de cerca se leen tubos brillantes, cuando el barniz de verdad es
  plano. Opciones para el líder: menos relieve en el carbono o que el
  barniz use la normal sin *bump* (cambio del motor, también para la madera
  barnizada).
- **La malla técnica no tiene agujeros** (no hay opacidad por punto): es
  un tafetán abierto de hilos oscuros.
- **El terciopelo y la pelusa**: sin *sheen* en el motor, el terciopelo es
  un punto fino oscuro; la vista *Rápida* sí pinta su pelusa.

**Veredicto del responsable (tela)** (sobre la hoja de telas, filas y
campos de 10 mm; E6 aceptada):

1. **Hilos por cm**: la tabla propuesta queda como valores del catálogo
   (los típicos de verdad). El `threadCount` antiguo de un proyecto
   guardado se sigue leyendo por cm, con el tope de 200.
2. **Vaquero en sarga 3/1** (`TWILL31`): aceptado; la cara se lee índigo
   sobre blanco, como debe.
3. **Carbono**: la alternativa de relieve 0,05 (con el relieve entero, los
   tubos brillantes están mal; con 0,05 la esfera y el campo se leen como
   sarga 3K bajo barniz). Que el barniz ignore el *bump* es un cambio del
   motor para la capa de realismo (M4), no ahora: anotado allí.
4. **`yarnTwist`** sin mando (0 en el carbono y la malla, 1 en el resto):
   aceptado.
5. **Aceptados como están**: la malla sin agujeros hasta que el motor tenga
   opacidad por punto (la traen las texturas de alfa de M2b: anotado en su
   encargo), el terciopelo sin *sheen* hasta la pelusa (S8), el *moiré* a
   pocas muestras (el filtro *Fine* de E11, ahora por defecto, lo suaviza) y
   la proyección de caja sobre los ejes de la malla.

Hecho tras el veredicto: el carbono del catálogo baja su `weaveDepth` de
0,3 a 0,05 (el *fixture* de la hoja, al día) y la hoja ya no enseña esa
alternativa; anotados el barniz sin *bump* en M4 y los agujeros de la malla
en M2b.

**Fusión con la rama de la sesión** (M2a, O1, E12, M3a, S2, S4a, U11,
U11b, E11…). La selección de luz por punto de E12 mueve los tres fijados
de E6, como movió los demás: bisel **`0x2f228634`** (era `0xfccda027`),
madera **`0x6fbc91f7`** (era `0x2a3a7416`) y tela **`0x5604ec69`** (era
`0xbb26399f`), en `rt-core` (todas las ISA), `rt-cli` y `rt-app` (1, 4 y
16 hilos) y en `engine.yml` (sus pasos, detrás de los de O1, S4a y E11).
El `MATL` de E6 (76 B, `bevel_mm` en el byte 72) es el que reservaba el
bloque de texturas de M2a, que sigue en el byte 100 detrás de los campos de
E9. Un material de nodos (M3a) no lleva `PATN` ni nudos en la vista
*Rápida*: hasta M3b es la media de sus salidas. Las secciones de E6 en
ARCHITECTURE eran entonces §5.2 sexies (bisel) y §5.2 septies (madera y
tela); desde la segunda fusión, §5.2 septies y octies.

**Segunda fusión con la rama de la sesión** (O3a, v0.1.6, el arreglo de la
prueba de humo, E9 a, b y c, el ajuste de `GRADIENT_POOL`).

- **`MATL`** es el de E9, de 100 B: el `bevel_mm` de E6 en el byte 72 (el
  hueco que E9 le reservaba), y detrás `scatter_mm`, `scatter_color[3]`,
  `scatter_g` y `abbe`. El motor y el escritor TypeScript escriben todos;
  un registro de 72 B se lee sin bisel y uno de 76 B (E6 antes de E9), con
  el bisel y sin medio ni dispersión (test nuevo). El bloque de texturas de
  M2a sigue en el byte 100, ya sin relleno.
- **El integrador**: la BSDF de E9 (salida de un medio, vidrio dispersivo
  con su banda, superficie, suelo) con el marco de E6 (la tangente de la
  veta del dibujo, si la hay); el punto de sombreado biselado y con su
  dibujo alimenta a los dos.
- **`rt`**: todas las órdenes de los dos lados; un solo `--only` para las
  tres hojas (lista con comas en `--filter-sheet` y `--filter-noise`, `wood`
  o `cloth` en `--pattern-sheet`). En `engine.yml`, todos los pasos de
  paridad: O1, S4a, E11, O3a, E9 y los tres de E6.
- **Hashes**: la compensación de energía de E9a mueve los tres fijados de
  E6 (todas sus piezas tienen GGX rugoso, de 0,12 a 0,85): bisel
  **`0xeacaae75`** (era `0x2f228634`), madera **`0x5ed1bf32`** (era
  `0x6fbc91f7`) y tela **`0x53e6a855`** (era `0x5604ec69`), en `rt-core`
  (todas las ISA), `rt-cli` y `rt-app` (1, 4 y 16 hilos) y en el `rt.wasm`
  real; los seis pases de E6, iguales. Ninguna escena sin bisel, madera ni
  tela se mueve, y todos los *fixtures* RSB sin E6 salen idénticos byte a
  byte a los de la sesión; `e6.rsb` pasa a 9 852 B y `patterns.rsb` a
  6 332 B.
- **Las miniaturas de los montajes**: sus escenas sí cambian, y no por esta
  fusión: toda instancia de un preset trae un *Bisel de aristas* del
  0,25 % del tamaño de la pieza (el arreglo del Doctor) y desde E6 el
  escritor lo manda, así que los héroes de los sets llevan bisel en
  *Completo*. Con el bisel a cero en el escritor, los 88 *hashes* de escena
  del manifiesto coinciden; el test del manifiesto ya fallaba en E6 antes
  de esta fusión (`1dc375e`). No se vuelven a renderizar ni se fijan:
  queda para el responsable (renderizarlas otra vez con el bisel, o que
  las miniaturas no lo lleven).
  **Veredicto del responsable (16-10):** se renderizan otra vez con el
  bisel. Una miniatura enseña lo que da el montaje sobre la escena que
  construye el código, y esa escena lleva el bisel del Doctor; quitárselo
  solo a las miniaturas haría que no coincidieran con el primer render del
  usuario. Las 88 se rehicieron con `rt` y el wasm de E6
  (`tools/setup-thumbs.mjs`) y el *hash* PNG de `STRIP_EDGE` en
  `tests/sets.test.ts` se re-fijó.
- **Docs**: E9 conserva ARCHITECTURE §5.2 sexies y las secciones de E6 pasan
  a §5.2 septies (bisel) y §5.2 octies (madera y tela); las líneas de E6
  del CHANGELOG van en *Sin publicar*, no en v0.1.6.

## E7 · Desgaste visible — **Opus**, con visto bueno **Fable**

**Qué.** Los ocho tipos de desgaste de `src/data/wear.ts` como capas del
sombreado en `rt-core` (aristas por curvatura y bisel, arañazos por curva
de nivel de ruidos estirados, huellas, polvo por normal hacia arriba,
suciedad por oclusión, pátina por manchas, micro-rugosidad, abolladuras),
con la escala física, semilla y variación por pieza de la receta.
Calibración: Opus implementa y Fable ajusta umbrales sobre una hoja de
contactos de desgaste (materiales × básicos) renderizada con `rt`.
Después del visto bueno, el panel de desgaste deja de decir
*próximamente*.

**Depende de.** E6.

**Criterio.** Hoja `out/wear-sheet.html`; con el maestro a 0 la imagen es
idéntica a sin desgaste (test de píxeles); el mismo material en dos piezas
con `wearPerObject` no repite el patrón (correlación baja entre máscaras).

## E8 · Lotes nativos y rendimiento — **Sonnet**

**Qué.** `rt` lee también el `.repack.json` (analizador JSON propio, con
tests) y renderiza proyectos enteros: cámaras × estudios, fotogramas de
animación (usa la misma `evaluate` portada a Rust o recibe un RSB por
fotograma generado por la interfaz: decidir con Fable), salida PNG 16
bits y EXR propio; `--bench` con informe de rayos/s por hilo; perfilado
y mejoras de la BVH y del muestreo con cifras antes y después en el PR.

**Depende de.** E5, N1.

**Criterio.** Un lote de 2 × 2 produce 4 imágenes con nombre por
plantilla; `--bench` en CI deja el número en el resumen del job (no es
puerta); ninguna regresión de determinismo.

## U3 · Herramienta de mover y operaciones de pieza — **Opus** — hecha

**Qué.** Todo lo de `SPEC.md` §3.1 "Operaciones sobre piezas, al estilo
KeyShot": *gizmo* de traslación, rotación y escala en el visor (ejes
locales y globales, incrementos, una entrada de deshacer por arrastre),
pivote (centro, base, origen, punto picado), apoyar, centrar, restablecer
transformación, fijar como objetivo de cámara, duplicar y duplicar
enlazado, agrupar, desagrupar, mover a grupo, patrón lineal y circular
como instancias, desenlazar y enlazar materiales, copiar y pegar
material, seleccionar por material, invertir normales, suavizado, separar
por caras CAD y por material; el menú contextual completo de `UI.md` §2.2
y los campos numéricos del inspector de pieza.

**Depende de.** U1.

**Criterio.** `tests/transform.test.ts`: cada operación como acción pura
con números (apoyar deja `minZ = 0` para un grupo de tres piezas; patrón
circular de 6 deja ángulos de 60°; duplicar enlazado comparte `meshId` y
`materialId`, desenlazar los separa; deshacer revierte cada una);
captura con el *gizmo* sobre una pieza seleccionada.

**Hecho.** `src/core/transform.ts` (composición y descomposición con
Euler continuo, ejes locales y globales, pivotes CENTER, BASE, ORIGIN y
CUSTOM en el espacio del nodo, pivote común en multiselección,
incrementos con `Shift`), reductores de escena y material (duplicar,
duplicar enlazado, agrupar, desagrupar, mover a grupo conservando la
posición en el mundo, patrones lineal y circular como copias enlazadas
bajo un grupo que recuerda sus parámetros y se regenera al editarlos,
desenlazar, enlazar con, copiar y pegar, seleccionar por material,
invertir normales como malla nueva, suavizado, separar por material,
`scene/aim` para focos), `src/render/gizmo.ts` dibujado por la vista
previa en tinta con letras de eje y de tamaño constante en pantalla, un
gesto por arrastre (una entrada de deshacer), sección *Pieza* del
inspector con campos arrastrables y bloqueo proporcional, menú contextual
completo de `UI.md` §2.2 con submenús y entradas deshabilitadas, atajos
`M`, `L`/`G`, `Ctrl D`, `Ctrl ⇧ D`, `Ctrl G`, `Ctrl ⇧ G`, `Ctrl ⇧ C/V`;
parámetro de URL `tool`. 442 tests (37 nuevos), 22 mutaciones comprobadas;
en el navegador: arrastre del *gizmo* con una sola entrada de deshacer,
anillo y cubo con incrementos, patrón circular editado en vivo, pivote
por clic, menús. Captura `docs/ui/move-tool.png`.

Lo que no encajaba: `boundsOf` mide ahora los vértices de las piezas
rotadas (afecta al Doctor y al encuadre, para bien); cada clic en el
visor dejaba una entrada de deshacer "mover la cámara" y se corrigió con
`sameView` y su test; los nodos guardan su transformación `initial` para
*Restablecer* (la hoja de importación la fija tras colocar el modelo);
una escala global no uniforme sobre un nodo rotado pierde la cizalla al
volver a posición, rotación y escala; el patrón circular gira alrededor
del pivote, así que con el pivote en el centro de la caja las copias se
apilan hasta elegir *Origen* o un punto; regenerar un patrón elimina los
hijos que no son originales; `buildMesh` y `sliceMesh` viven ahora en
`core/meshes.ts` y se reexportan desde `io`; la asa de apuntar de los
focos está probada solo en el modelo porque L4 aún no crea focos.

## U4 · Biblioteca propia — **Sonnet** — hecha

**Qué.** `src/core/library.ts` y `src/io/library.ts`: guardar materiales,
montajes de luz, tipos de producto y estudios propios con nombre y
miniatura (renderizada por el visor como las del catálogo), pestaña
*Míos* en cada catálogo con renombrar y eliminar, persistencia en
`localStorage` (en `try/catch`) y exportar e importar como JSON con
versión de esquema. Los presets de fábrica no se editan: editar uno crea
una copia propia.

**Depende de.** U1.

**Criterio.** Ida y vuelta del JSON; un material propio aparece en la
paleta de comandos; eliminar uno en uso no rompe la escena (la instancia
sigue, ya sin origen).

**Hecho.** `src/core/library.ts` (modelo puro: cuatro colecciones con
`id`, nombre, fecha, miniatura y origen; `fromMaterialInstance`,
`fromCurrentRig` con `share` normalizado a 1, `fromCurrentProductType`,
`fromCurrentStudio`, `applyLibrarySetup` con la normalización de
exposición del catálogo, migración de `studio.saved`) y
`src/io/library.ts` (envoltorio `repackshot-library` v1 que es a la vez
el fichero exportado y la entrada única de `localStorage`; validación
campo a campo, imágenes solo `data:image/png|jpeg|webp`, copia de
seguridad si el almacenamiento está corrupto, reintento sin imágenes si
está lleno). Guardar material, montaje, tipo de producto y estudio con
un campo de nombre en línea; miniaturas: esfera del catálogo para
materiales y una captura real de 160 × 120 de la vista previa para el
resto (≈0,5 s con swiftshader, ≈3 KB). Pestañas *Míos* en materiales,
estilos de luz, tipo de producto y estudios, con renombrar y eliminar en
línea, y *Exportar / Importar biblioteca* al pie y en el menú; la paleta
los lista como *Míos*. 504 tests (62 nuevos), 40 mutaciones; en el
navegador, un montaje propio aplicado a Relojería da exactamente su
irradiancia (diferencia 0). Capturas `docs/ui/library-*.png`.

Lo que no encajaba: la biblioteca vive en `UiState` (estado de usuario,
como el tema), fuera del historial; los montajes y tipos propios se
aplican como claves `LIB:<id>` y su definición viaja en el proyecto
(`studio.customSetup`, `studio.customPreset`), así que borrar el
elemento no cambia la escena; borrar un material en uso emite
`material/unlinkLibrary`, que sí es deshacible pero no devuelve el
elemento a la biblioteca; las texturas de imagen no viajan en los
materiales propios (M2); los estudios restauran materiales solo sobre
nodos con el mismo id, como ya hacía `studio.saved`; la captura de
160 × 120 usa el encuadre tal cual (la pieza sale pequeña); importar con
un id existente conserva el que había aunque el contenido difiera.

## L4 · Focos propios — **Opus** — hecha

**Qué.** Lo de `SPEC.md` §3.4 "Luces propias, al estilo KeyShot": añadir
focos (área rectángulo, disco y esfera; punto; foco direccional con cono
y transición; sol), nodos `LIGHT` con transformación propia movidos y
apuntados con el *gizmo* de U3, *Apuntar a…*, *Colocar sobre superficie*,
propiedades completas (potencia en vatios con lúmenes en auxiliar,
temperatura o color, tamaño, dispersión, visible en reflejos y a cámara,
sombra, encendido), duplicar y eliminar, *Guardar montaje como…* a la
biblioteca de U4 con normalización de exposición al aplicarlo a otro tipo
de producto, *Restablecer al montaje*. En la vista previa, cada tipo con
su luz de three; en el motor, las secciones `LGHT` correspondientes (E3
ya cubre área y sol; punto y foco direccional se añaden al integrador
aquí, con test de energía).

**Depende de.** U3, U4, E3.

**Criterio.** Un montaje propio de tres focos guardado y aplicado sobre
otro tipo de producto mantiene la irradiancia total del tipo (test);
captura con un foco direccional apuntado a una pieza; paridad nativo /
wasm sigue en verde.

### L4 · Ampliación: luces y cámaras en el visor, «mirar a través» (petición del usuario, 2026-10-13)

«Integra… luces, y la posibilidad de poder mover una cámara y luces a
gusto, también con el paneo.» Decisiones del líder, dentro de L4:
- Las luces y las **cámaras guardadas** (no la activa) se dibujan en el
  visor como glifos acromáticos (contorno del panel, cono del foco, punto,
  flecha del sol; pirámide de la cámara), con un botón *Luces y cámaras*
  en la barra de vista, junto a *Desplazar*, para mostrarlas u ocultarlas.
- Se seleccionan con un clic en el visor o en sus pestañas, y se **mueven y
  giran con el *gizmo*** de *Mover* (la luz con su asa de apuntar; la
  cámara, con su objetivo); un gesto, una entrada de deshacer.
- ***Mirar a través*** de la luz o la cámara seleccionada (botón y `Ctrl/⌘
  ⇧ L`): el visor mira desde ella y **Orbitar, Desplazar y Zoom mueven ese
  objeto** (la luz apunta a donde mira el visor); `Esc` o el botón vuelven a
  la cámara activa. Respeta *Bloquear cámara*.

**Hecho.** *Focos propios.* `LightType` gana `POINT` y `SPOT` y `LightShape`
gana `SPHERE` (se añade, no se renombra). `core/lighting.ts`: los focos
propios son `LightInstance` de `studio.lights` con `own: true`, en la misma
lista que los del montaje, con campos opcionales nuevos (`name`, `blend`,
`shadow`, `aim` en tamaños de pieza desde el pivote, `roll`), así que un
proyecto, un estudio o una biblioteca de antes abren igual. `lightFrame`
(posición, objetivo, *up* con su giro), `placementOf`, `polarAboutPivot`,
`aimOffset`, `newLight` (delante y arriba de la pieza desde la cámara
activa, con la irradiancia media de los encendidos; el sol, π veces) y las
acciones `studio/addLight`, `duplicateLight`, `deleteLight`, `aimLight` y
`placeOnSurface`; `studio/resetLights` ya quita los propios. Unidades de
puntos y focos (`core/photometry.ts`): **un punto o un foco de P W es tan
brillante en su eje como un panel de P W** (flujo `π P S²` para el motor,
intensidad `P S² / 4` para three.js), lúmenes desde el flujo del motor
(`lightLumens`, `spotFraction`). La biblioteca (`specOf`, los validadores de
`io/library.ts`) lleva tipo, forma, objetivo, giro, transición y sombra.
`io/rsb.ts` escribe `LGHT` 3 y 4, el bit 2 *sin sombra* y el *up* girado
(sin giro, `[0, 0, 1]` como antes: los bytes de los proyectos sin focos
propios no cambian). Vista previa: `PointLight` y `SpotLight` de three con la
intensidad del motor, los paneles girados con su *up*. Motor (`rt-core`,
`light.rs`): esferas de radiancia uniforme muestreadas en su cono, puntos
por posición, la máscara del foco en *smoothstep* desde la dirección del
centro (la de three), cámara y reflejos con MIS, `LightSample::shadow` y el
integrador que no traza la sombra de una luz sin ella (tampoco en el
*shadow catcher*). Interfaz: *+ Añadir luz* con su menú (y *Añadir ▸* de la
cabecera, el visor en vacío y la paleta), la fila del foco seleccionado con
duplicar, apuntar y eliminar, *Apuntar un foco aquí ▸* en el menú de una
pieza, el inspector completo de `UI.md` §2.4 y los dos *próximamente*
quitados (`lights.addSoon`, `lightEdit.moreSoon`).

*Luces y cámaras en el visor, Mirar a través.* `core/view-objects.ts`:
`objectFrame` y `objectGizmoAction` (el *gizmo* de *Mover* sobre una luz o
una cámara guardada: mover sin cambiar a dónde apunta, girar su objetivo y
el giro del panel, el asa de apuntar; una cámara bloqueada no tiene),
`lookThroughCamera` y `lookThroughAction` (la vista desde el objeto y la
navegación que lo mueve; un foco ajusta la focal a su cono), `glyphsOf`,
`pickGlyph` y `viewProjector`. La vista previa dibuja los glifos en la capa
del *gizmo* (discontinuos; el seleccionado, continuo), el modo `MOVE` del
*gizmo* (sin cubos) y mira a través; el trazador (wasm y nativo) renderiza
desde la misma cámara (`setViewCamera`). `main.ts` convierte la navegación
en vivo, con un *token* de gesto que nace al empezar el gesto (una entrada
de deshacer por órbita, desplazamiento o tirón de rueda). En la barra de
vista, *Luces y cámaras* (recordado) y *Mirar a través*; `Ctrl/⌘ ⇧ L`, `Esc`
vuelve antes que nada; un aviso bajo la barra; doble clic y clic derecho en
un glifo.

*Pruebas.* `tests/own-lights.test.ts` (20) y `tests/view-objects.test.ts`
(16): el criterio (un montaje propio de un panel, un foco y un punto,
guardado en Joyería y aplicado a Relojería, Mobiliario de interior y
Estándar, da la irradiancia total de cada tipo con el mismo reparto, el
mismo objetivo y la misma transición), añadir y deshacer, ids que no chocan,
duplicar y eliminar, restablecer, apuntar, giro, colocar sobre superficie,
RSB de ida y vuelta, el sol que coloca el cielo desde su objetivo,
proyecto y biblioteca, glifos y su clic, el *gizmo* de luz y de cámara (una
entrada de deshacer, la cámara activa quieta, la bloqueada sin *gizmo*),
*Mirar a través* que mueve la luz y la cámara y respeta el bloqueo, la
proyección. En `rt-core`, 7 tests de `light.rs` (`I / d²` del punto y de la
esfera, su radiancia vista, el cono y su transición, el flujo del cono
frente al cálculo de la interfaz, la esfera diminuta como punto, la
selección de un foco estrecho, la marca sin sombra) y 4 del integrador (la
irradiancia de puntos, esferas y focos sobre un suelo blanco, la esfera
contada una vez con MIS, lo oscuro fuera del cono, la luz sin sombra que
atraviesa una losa). Mutaciones: 9 en el motor y 21 en TypeScript, todas
detectadas al final (la del proyector se escapaba y ganó un test).
`tools/lights-check.mjs` (Playwright, *Rápido* y *Completo*) comprueba el
menú, apuntar a una pieza con clic, el deshacer paso a paso, el clic en los
glifos (y que no coge nada con el botón apagado o en *Piezas*), el *gizmo*
de un foco y de una cámara guardada, *Mirar a través* con órbita, deshacer y
`Esc`, y una cámara bloqueada que no se mueve; capturas
`docs/ui/lights-add-menu.png`, `lights-spot-aimed.png`,
`lights-spot-full.png` (convergida, solo el lienzo),
`lights-glyphs-gizmo.png` y `lights-look-through.png`.

No encajó con el plan:

- **No son nodos `LIGHT` del árbol.** El plan (y `SPEC.md` §3.1) dice
  nodos `LIGHT` con transformación propia, y U3 dejó `scene/aim` y el asa
  de apuntar para ellos. Pero desde U1 las luces viven en `studio.lights` y
  las cámaras en `camera.cameras`, y de esa lista tiran la vista previa, el
  motor, la animación (los clips apuntan a un foco por su id), el Doctor,
  los estudios, la biblioteca y las barras de reparto. Dos sistemas de luces
  lo habrían duplicado todo y los focos del montaje no se habrían podido
  mover con el *gizmo*. Los focos propios son `LightInstance` con su propia
  colocación (posición, objetivo y giro en tamaños de pieza desde el pivote)
  y los del montaje ganan la misma; el árbol de *Piezas* no los lista (los
  lista *Luces*). `scene/aim` sigue como estaba, sin uso. Si Fable prefiere
  nodos, es una migración de `studio.lights`.
- **Los vatios de un punto y de un foco** no son los de Cycles (que serían π
  veces más oscuros): ninguna receta los usa, y así un montaje que mezcla
  paneles, puntos y focos conserva su equilibrio y un foco nuevo con la
  irradiancia media se ve como los demás. Un sol nuevo nace con π veces la
  media (su medida es la que llega; la de un panel, 1/π de la que llega en
  su eje), así que su barra de reparto se ve mayor. Los lúmenes salen
  pequeños en piezas pequeñas (son el flujo de verdad: los vatios se dan
  para una pieza de 1 m), y la nota del inspector lo dice.
- **Los glifos se dibujan solo mientras se trabaja con luces o cámaras**
  (decisión del líder tras la primera captura): la pestaña *Luces* o
  *Cámaras* abierta, una luz o una cámara seleccionada, o mirando a través;
  con *Piezas* y una pieza, ninguno. El borde inferior del panel principal
  del montaje *Estándar* cruzaba el hombro del frasco como una línea recta
  (el foco está entre la cámara y la pieza, por encima): una segunda pasada
  con profundidad no lo habría atenuado, porque está delante. Además, los
  que no están seleccionados son **discontinuos**, como líneas de
  construcción. *Luces y cámaras* está encendido por defecto y se recuerda.
- **El botón *Luces y cámaras* está a la izquierda de *Desplazar***: U9
  dejó *Escalar* a su derecha y las dos decisiones piden «junto a
  *Desplazar*».
- **Apuntar a la selección** pasó al menú contextual de la pieza (*Apuntar
  un foco aquí ▸*): la selección es una cosa a la vez, y al seleccionar un
  foco las piezas dejan de estarlo; las acciones de fila salen en la fila
  del foco seleccionado (al pasar el ratón se movían bajo el clic que
  selecciona la fila) y su *apuntar a…* es el mismo menú del inspector.
- **Bloquear cámara** se aplica a lo que se mira a través cuando es una
  cámara (su propio bloqueo; el botón de la barra sigue siendo el de la
  activa). Una luz no tiene bloqueo: mirar a través de una luz la mueve
  aunque la cámara activa esté bloqueada, y la cámara activa nunca se mueve
  mirando a través. La cámara activa no tiene glifo ni se mira a través de
  ella (es la vista); para elegir una cámara guardada sin activarla, su
  glifo (la fila de *Cámaras* la activa, como dice §2.2).
- **La caja de selección no coge glifos y *Escalar* no pone *gizmo* en una
  luz o una cámara**: la caja selecciona piezas al nivel vigente, y el
  tamaño de un foco es del inspector. El *gizmo* de *Mover* sobre ellas no
  tiene cubos de escala.
- **El motor elige un foco estrecho como su punto** cuando su cono abarca
  el centro de la escena (y a un veinteavo si no): por su flujo, un foco de
  9° salía casi nunca frente a la cúpula y su círculo de luz quedaba lleno
  de ruido. Cambia solo el ruido, no la media; ninguna escena sin puntos ni
  focos cambia (ningún *hash* ni test de imagen se ha movido). Test nuevo:
  `a_narrow_spot_aimed_at_the_scene_is_chosen_like_its_point_light`.
- **Coordenadas en lugar de un desplegable**: el inspector enseña X, Y, Z
  siempre, como la posición de una pieza.
- Para las comprobaciones, el visor copia el objeto seleccionado, dónde está
  en el lienzo y lo que se mira a través en `data-object`, `data-object-at`
  y `data-look-through`, como el medidor sus números.

## L5 · Luces IES — **Sonnet** — hecha

**Qué.** Lector propio del formato IES LM-63 (texto público) en
`rt-core`, foco de tipo IES en el motor y en la vista previa (aproximado
por un foco direccional con la intensidad del eje), sección RSB propia,
y el tipo en *+ Añadir luz*.

**Depende de.** L4, E5.

**Criterio.** Dos perfiles IES de prueba escritos a mano; la intensidad
muestreada a 0°, 30° y 60° coincide con el archivo.

**Hecho.**

*Lector* (`rt_core::ies`, `IesProfile::parse`). Texto de IES LM-63 (1995 y
2002; también el de 1991, sin línea de versión): cabecera `[CLAVE]` con
`[MORE]`, `TILT=NONE`, los trece números, los ángulos y las candelas,
separados por espacios, tabuladores, comas o saltos de cualquier estilo.
**Fotometría tipo C**; **el tipo B y el A se rechazan** con su mensaje (no
se convierten: es un remuestreo de la esfera que nada necesita, porque toda
luminaria se puede publicar en tipo C), y también `TILT=INCLUDE` y
`TILT=<archivo>`. Estricto, con el motivo y los números del archivo: cuentas
que no casan (de menos, «cortado»; de más, «cuentas mal»), ángulos que no
crecen o fuera de los rangos del estándar (verticales 0–90, 0–180 o 90–180;
horizontales uno, 0–90, 0–180, 90–270 o 0–360), valores que no son números o
no son finitos, candelas negativas, multiplicador no positivo, tabla toda a
cero, más de 2 MiB; antes de reservar nada se comprueba que los números que
hay cubren los que las cuentas piden. Lo que el archivo dice de lúmenes,
lámparas, balasto, vatios y tamaño de la abertura se lee y no se usa: el
archivo es la **forma** (se divide por su pico) y la luz da el nivel.

*Distribución.* `intensity(γ, φ)` interpola **bilinealmente** en el ángulo
vertical y el horizontal sobre los ángulos del archivo (no hace falta que
estén igualmente espaciados), después de reducir φ por la simetría: redonda,
cuadrante, bilateral 0–180, bilateral 90–270 y completa; fuera del rango
vertical es 0. Su marco es el de la luz: eje = `direction` (γ = 0), φ = 0 a
lo largo de `up`, φ crece de `up` hacia `up × direction`, contra el reloj
mirando a lo largo del eje desde detrás. El **flujo** se integra de la misma
función que se evalúa, en forma cerrada por celda (el trapecio es exacto en
φ y `∫ sin γ · lineal(γ)` tiene primitiva): `4π c` para un perfil isótropo
(con cualquier simetría y mallas irregulares, a 4·10⁻⁶), y para el 1000 cos²
escrito a mano `2π · 1000 / 3` con la precisión de la tabla (0,5 % con pasos
de 10°, 5·10⁻⁵ con pasos de 1°: crece con h²), y contra una cuadratura
numérica de `intensity` sobre la esfera, a 1,5·10⁻³.

*Luz* (`LightKind::Ies`, `Light::ies`, `LGHT` de tipo 5). La luz de punto o
esfera pequeña de `power` W con una máscara por dirección, por el mismo
camino que el foco (cono que llena la esfera, posición delta, MIS con los
rayos BSDF, también a cámara y en reflejos): `máscara = intensidad(hacia x) /
pico`. **El perfil da la forma y `power` el nivel**: tan brillante en su
dirección más brillante como el punto de `power` W (como un foco en su eje),
así que un perfil escrito para 500 lm y otro para 5000 dan la misma luz y
cambiar un punto por una luz IES no mueve la exposición; el multiplicador de
la interfaz es `power / base`, con `base` la potencia con que entró (la
media de los focos encendidos, como un punto nuevo). Selección de luz (E12):
por punto, el peso `lum(I) · máscara(x) / max(d², r²)` es exacto; en la
estática (más de 64 entradas, atrapasombras) una luz **dentro de la esfera
que envuelve la escena** pesa por su flujo (el del punto del pico por la
eficiencia del perfil, `flux / (4π · pico)`) y una fuera de ella, como un
foco, por la intensidad hacia el centro de la escena. No lanza fotones. Coste
medido: la escena de paridad (el panel y dos luces IES) tarda un 16 % más que
el ejemplo con su panel (7,2 s frente a 8,3 s, 128 muestras a 480 × 360 con 4
hilos, 61 millones de rayos las dos): el peso y el sombreado de dos entradas
más en la elección por punto y la búsqueda del perfil.

*RSB.* `LGHT` kind 5 con una palabra más (la posición de su perfil: 80 B) y
la sección `IESP` (el texto del archivo, `u32` de largo, bytes y relleno a 4)
una vez por perfil distinto, tras las luces. Los ficheros y las escenas sin
luces IES son los de antes, byte a byte (un test), y **ningún hash fijado se
movió**. `rt_core::FEATURE_IES` (bit 3 de `rt_features`, valor 8, tras el
bit 2 de la sección de Q1; `features` del lanzador pasa de 7 a 15): la página escribe la luz como IES solo cuando el
motor lo dice (`readsIes`, `SceneView.ies`, en el *pool*, `NativeEngine` y
*Exportar escena del motor*) y, si no, como el foco que la aproxima.
`rt --write-l5-example` (`example::l5_scene`: el ejemplo con su panel a una
quinta parte, una esfera de 24 mm con el perfil del *downlight* y un punto
cálido con el *wall washer* girado sobre su eje, 160 × 120),
`PINNED_L5_IES_4SPP` = `0x920f0be1` en las tres rutas SIMD, con 1, 4 y 16
hilos, en WASI y con el `rt.wasm` real, y su bloque de paridad en
`.github/workflows/engine.yml`, que el `tests/ies-engine.test.ts` repite por
el código de la página.

*Página.* `core/ies.ts` es el puerto del lector (el motor escribe, en
`tests/fixtures/ies/conformance.json`, 68 archivos con lo que hace con cada
uno, sanos y mal formados; el lector de la página repite cada rechazo, con el
mismo mensaje, y cada nombre, simetría, pico, flujo e intensidad). `LightInstance`
gana `type: 'IES'` e `ies: { name, text, base }`; viaja en el proyecto, los
estudios, `Guardar montaje como…` (`LightSpec.ies`) y la biblioteca (el
validador exige un perfil que el lector acepte; un perfil dañado al abrir un
proyecto se quita y la luz es un punto). *+ Añadir luz ▸ IES…* abre el
archivo (también soltarlo en la ventana y la paleta), una entrada de deshacer
(`studio/addIesLight`); un archivo que no sirve no añade nada y dice por qué,
en los dos idiomas. Inspector: nombre del perfil, **gráfico polar** dibujado
desde el archivo (C0–C180 continuo, C90–C270 discontinuo, en grises),
pico, haz y simetría, *Cambiar…*, **multiplicador** (en lugar de los vatios) y
los lúmenes (el flujo del punto del pico por la eficiencia del perfil). Rápido
lo **aproxima**, y el inspector lo dice (regla 10), con un `SpotLight` de la
intensidad del eje y un cono cuya transición vale exactamente la mitad del
pico en el semiángulo de la mitad de intensidad (`iesSpot`); los glifos del
visor y *Mirar a través* usan el cono de ese semiángulo. **No se entrega
ningún perfil de fabricante**: los dos de prueba están escritos a mano
(`tests/fixtures/ies/`, sin nada de ninguna luminaria) y cada persona trae los
suyos; así consta en SPEC, UI y en el README de los *fixtures*.

*El criterio, con números.* El *downlight* escrito a mano (1000 cd de pico,
1000 cos², una tabla de 10° en 10°) con el motor a 12 W, muestreado en tres
direcciones (los valores son las candelas que da el motor, de la intensidad
`P/4π · c/c_pico`, con su error contra la del archivo medido en `f32`):

| γ | archivo (cd) | motor (cd) | error / pico |
| --- | --- | --- | --- |
| 0° | 1000 | 1000,0000 | 0 |
| 30° | 750 | 750,0000 | 0 |
| 60° | 250 | 250,0000 | 0 |
| 35° (entre nodos) | 668,5 (lineal; el 1000 cos² daría 671,1) | 668,5001 | 6·10⁻⁸ |
| 45° | 500 | 500,0001 | 3·10⁻⁸ |
| 75° | 73,5 | 73,5001 | 6·10⁻⁸ |

El *wall washer* (900 cd, cada lado distinto) da 560, 430, 330 y 380 cd a 60°
en C0, C90, C180 y C270, y 800 y 765 cd en los puntos entre nodos (30° en C0 y
a 45° de azimut), con el mismo error. La tolerancia del test es **10⁻⁶ del
pico**: el error medido es de redondeo de `f32` (6,3·10⁻⁸; el ángulo vuelve de
un vector por `atan2` bueno a unos 10⁻⁷ rad y la pendiente más fuerte de la
tabla es de 14 cd/°), dieciséis veces eso y 2 600 veces menos que el 0,26 %
en que la curva suave difiere del archivo a 35°, así que un motor que
tomara el nodo más cercano o la curva de la que salen los números fallaría.
Y la misma prueba por la imagen: un suelo blanco lambertiano bajo la luz, con
radiancia `I(θ) cos³θ / h² / π`, a 8·10⁻⁶ (un punto normal da 6·10⁻⁶ con la
misma fórmula), y el multiplicador de 2 que duplica la luz en la interfaz.

*Pruebas.* En `rt-core`: 20 de `ies` (el lector y sus rechazos, el flujo,
las simetrías y la conformidad con la página), 7 de `light` (el criterio, la orientación,
potencia y color, la esfera con perfil, sin perfil ni eje, la elección por
punto y la estática; la prueba de MIS de «todas las clases» gana una luz
IES), 2 del integrador (el suelo a 0°, 30° y 60° y las cuatro caras del
*wall washer*), 4 de `scene::rsb` (el perfil una vez por cada distinto, 80 B,
los bytes de antes, los inválidos y la actualización), el fijado de `render`
y, en `rt-cli`, 1, 4 y 16 hilos y `--write-l5-example`. En la página:
`ies.test.ts` (85: la conformidad y los dos perfiles), `ies-lights.test.ts`
(17: añadir, deshacer, multiplicador, lúmenes, montaje, biblioteca,
estudio, proyecto, RSB, `l5.rsb` byte a byte, glifo y mirar a través),
`ies-ui.test.ts` (11), `ies-switch.test.ts` (6: el bit del *pool* y del
lanzador) y `ies-engine.test.ts` (con el `rt.wasm` real: el hash fijado y una
escena escrita por la página); `tools/ies-check.mjs` (Playwright, *Rápido* y
*Completo*: el menú, el archivo, el gráfico, el multiplicador, *Cambiar…*, el
archivo rechazado; capturas `docs/ui/ies-light.png` e `ies-light-full.png`).
Mutaciones: 9 en el motor (el pliegue de φ, su sentido, la máscara, el radio
de la escena en el peso estático, el término de pendiente del flujo, la
deduplicación de perfiles, la interpolación en φ, el rango de γ y la
normalización por el pico) y 1 en la página (el bit de `FEATURE_IES` que
nunca llega a la vista), todas detectadas.

No encajó con el plan:

- **«Elección de luz por su flujo, que se integra del archivo»**: por punto, la
  intensidad del perfil hacia el punto que se sombrea **es** el peso exacto
  (como el foco: la máscara por dirección), y el flujo no pinta nada ahí; en
  la elección estática el flujo del archivo solo es la medida correcta para
  una luz **dentro** de la esfera que envuelve la escena. Fuera de ella manda
  la intensidad hacia la escena, como se decidió para el foco estrecho en L4
  (un haz de 10° con poco flujo, dirigido a la pieza, es la luz que más
  cuenta; pesarlo por su flujo lo dejaba otra vez lleno de ruido). El flujo
  se integra, se prueba contra los casos cerrados y se usa en la estática
  interior y en los lúmenes del inspector. Si el líder prefiere el flujo
  total también fuera, es una línea de `Lights::new`.
- **Tipo B y A rechazados, no convertidos** (el encargo decía «rechazados o
  convertidos si es sencillo»; no lo es: es otro sistema de ángulos y otro
  remuestreo, y todo lo que la gente exporta para renderizar es tipo C).
- **Nivel con que entra la luz**: el perfil se normaliza por su pico y la luz
  entra con la irradiancia media de los focos encendidos, como un punto nuevo
  (el pico del perfil apuntado al pivote da lo mismo que el punto). Los
  candelas absolutas del archivo no cuentan: las escenas de aquí tienen
  vatios de Cycles, no físicos (a 683 lm/W un perfil real daría una imagen
  negra). Es una convención de exposición (el plan no la marca como decisión
  del líder, pero es fotográfica): el líder puede preferir normalizar por flujo
  (un haz estrecho entraría mucho más brillante en su eje).
- **«Un multiplicador» es `power / base`**, no las candelas por un factor: el
  nivel sigue siendo `power` (lo que leen el Doctor, la animación, los
  estudios, las barras de reparto y la normalización al aplicar un montaje a
  otro tipo de producto) y el inspector enseña ese nivel como múltiplo del
  de entrada. Al aplicar un montaje que lleva una luz IES, el multiplicador
  vuelve a × 1 (la potencia se renormaliza).
- **`NEW_LIGHT_KINDS` no gana `IES`**: una luz IES necesita su archivo, así
  que nace de otra acción (`studio/addIesLight`) y el menú, la paleta y el
  soltar archivos la llaman; el tipo `IES` sí entra en `LightType` y en
  `LIGHT_TYPES` (se añade, no se renombra). El segmentado del tipo solo
  ofrece *IES* a una luz que tiene perfil.
- **Rápido es una aproximación y no puede ser más**: un `SpotLight` de three.js
  no pasa de 90° de semicono, así que un perfil ancho (el *wall washer* tiene
  un haz de 139°) o una lámpara que no baja a la mitad (una bombilla) se
  dibuja como un hemisferio de borde duro: sin luz hacia atrás y sin la caída
  suave del archivo. El inspector lo dice y *Completo* da el archivo entero.
- **El archivo no pone el tamaño de la luz**: las dimensiones de la abertura
  luminosa del archivo se ignoran (la luz es un punto o una esfera de radio
  propio, el de un punto: 0,01 tamaños de pieza al nacer).
- Sin fotones de cáusticas, como el punto y el foco; **el lector es estricto
  también con los números de más** (más valores que las cuentas es un error,
  no se ignoran): un archivo con basura al final se rechaza con su cuenta.
- **`features` de `/api/info` suma el bit 3** (`FEATURE_IES` = 8; con la
  sección de Q1 pasa de 7 a 15): la afirmación de `rt-app/tests/server.rs` que
  lo fijaba cambia con la fase; es la única prueba anterior que se movió, y no
  es de píxeles. Q1 tomó el bit 2 (valor 4) antes de integrar L5: el de las
  luces IES es el siguiente.
- `tools/lights-check.mjs` (L4) **falla en el entorno en un paso que no es de
  L5**: *activar la Cámara 1 desde el menú* (tras *Nueva desde la vista
  actual*); falla igual en el cabeza de sesión `2505ed6`, así que no sirve de
  puerta para esta fase más allá de ese punto. Se actualizó su comprobación
  del menú (la entrada *IES…* viva) y se regeneró `lights-add-menu.png`.
- **`engine/README.md` está en inglés** (como cada fase lo ha dejado); lo de L5
  va en inglés ahí y en español en los demás documentos.

## L1 · Colocación por reflejo, campo claro, luces editables — **Sonnet**

**Qué.** Colocación por reflejo exacta con `pick` del motor en Rust
(reflejar el rayo de cámara en la normal picada y poner el foco a su
distancia);
campo claro por entorno para `camera = true` (disco suave en coordenadas
de ventana, radio aparente a partir del tamaño y la distancia del panel,
radiancia acotada), de modo que ningún foco se vea nunca como objeto con
bordes; edición foco a foco con `modified`; *Restablecer montaje*.

**Depende de.** E4.

**Criterio.** Test geométrico: con una esfera y un clic en su punto
(x, y), el foco acaba en la dirección reflejada (producto escalar > 0.999);
captura de BACKLIT, SILHOUETTE y ECLIPSE con el disco visible y sin
rectángulos.

## L2 · Miniaturas propias — **Sonnet**

**Qué.** `tools/render-thumbs.mjs`: genera un RSB por miniatura con
`src/io/rsb.ts` y las renderiza con el binario nativo `rt` (sin
navegador, en CI): las 72 miniaturas de montaje (160 × 120 y 64 × 64) con
la pieza de ejemplo en gris neutro, y las esferas de los 77 materiales,
con el hash de su receta en un chunk `tEXt` del PNG; `--check` falla si
alguna está desactualizada y la suite lo ejecuta. Sustituye las PNG
portadas de EZ Packshot en `public/thumbs/`.

**Depende de.** E4, E5 (para que las de color y vidrio salgan bien).

**Criterio.** `--check` en verde en CI; cambiar un número de un montaje
sin regenerar hace fallar la suite.

## L3 · Revisión fotográfica de las recetas — **Fable**

**Qué.** Con la hoja de contactos de E3/E5 y las miniaturas de L2, revisar
los 72 montajes y los 16 rigs de tipo de producto sobre el motor propio y
ajustar **solo datos** (`src/data/light-setups.ts`, `studios.ts`). Lo que
se mide: un brillo por fuente con la forma de la fuente; menos del 1 % de
píxeles de la pieza quemados a exposición 0; luminancia media de la pieza
dentro de ±0.3 EV entre montajes del mismo tipo de producto; nada de
zonas negras por encima del 5 % en fondos claros; la miniatura tiene el
brillo donde el render.

**Datos de partida (corrección de la potencia de las luces, tras U5).**
Las recetas se evalúan ya con la convención de Cycles. Con JEWELLERY, la
irradiancia de los focos frente a la de la cúpula sobre una cara hacia
arriba es 2,31× en campo lejano y 1,4–1,9× integrando el panel; la cúpula
sigue dando cerca de la mitad del brillo de la pieza, igual que en
Blender con los mismos valores. REMBRANDT frente a NEON_NOIR cambian el
48 % de los píxeles de la pieza (77 % sin cúpula). El equilibrio entre
focos y cúpula por tipo de producto lo decide Fable aquí;
`tools/setup-contrast.mjs` lo mide.

**Depende de.** E5, L2.

## U7 · Arrastrar un material y selección por caja — **Sonnet** — hecha

**Qué.** Arrastrar un material (una miniatura del catálogo, de *Míos* o
la esfera del material de la selección) sobre una pieza del visor o
sobre una fila del árbol, con resaltado (`UI.md` §2.2 y §2.3). Con la
herramienta *Seleccionar*, selección por caja (ventana y cruce) a cada
nivel (`UI.md` §4.1), que se añadió a la fase con ella empezada.

**Depende de.** U1, U4.

**Criterio.** Reglas de la asignación por arrastre como acción pura con
números; la selección por caja probada sobre geometría proyectada;
comprobación en el navegador con ratón, lápiz y dedo en *Rápido* y
*Completo*.

**Hecho.**

*Arrastrar un material.* Con eventos de puntero, no con el arrastrar y
soltar del navegador (un *webview* de escritorio no siempre da la sesión
nativa, y no deja decidir el fantasma, el lápiz ni `Esc`):
`src/ui/components/material-drag.ts` es el controlador (umbral de 5 px,
miniatura fantasma sobre y a la derecha del puntero, zonas de suelta
registradas por elemento, `Esc` en fase de captura, clic tragado tras
arrastrar; un dedo no arrastra y conserva su gesto de siempre). Las
reglas viven en `src/core/material-drop.ts` y se prueban con números: en
el visor, una suelta alcanza lo que seleccionaría un clic al nivel
vigente (pieza, ensamblaje, modelo o, a nivel *Caras*, la cara entera
bajo el cursor); en una fila del árbol, el nodo y todo lo que cuelga de
él. Un preset del catálogo o un elemento de la biblioteca entran con
**la instancia que la escena ya tiene de él** (la misma que un clic en
la miniatura, así que soltar y hacer clic dejan el mismo proyecto); la
esfera de la selección enlaza con **esa instancia**; con **`Alt`** la
suelta da **una copia propia** (`material/assign` con `copy`, etiqueta
*asignar una copia*). Siempre es **una sola acción** `material/assign` y
una entrada de deshacer, con el nombre del material y del destino.
Resaltado: contorno (el del visor) en las piezas, tinte en las caras y
borde discontinuo en la fila del árbol, que además contornea en el visor
lo que alcanzaría; el fantasma pone *Copia* mientras se pulsa `Alt`.
`src/core/materials.ts` gana `copy` y `material/assign` ya no crea
entrada cuando no cambia nada.

*Selección por caja.* `src/core/box-select.ts` (puro, en píxeles de
pantalla) y `src/ui/panels/viewport-box.ts` (el gesto). **`Ctrl/⌘` +
arrastrar** dibuja la caja con *Seleccionar* y con *Mover* (donde no hay
un asa bajo el puntero), en los tres esquemas del ratón; sin `Shift` ni
`Alt` **sustituye** la selección, con `Shift` **añade** y con `Alt`
**quita**. De izquierda a derecha es una **ventana** (lo que queda
entero dentro; contorno continuo), de derecha a izquierda es **cruce**
(lo que toca; contorno discontinuo), ambos acromáticos. Al nivel
*Pieza*, *Grupo* o *Modelo* se prueba la geometría proyectada (primero
la caja envolvente, luego los triángulos; sin mirar qué tapa a qué, como
en un CAD: una pieza detrás de otra también se coge, y las ocultas no
cuentan); a nivel *Caras* coge las caras enteras (CAD o por continuidad,
ver **M1**) de una pieza, con el botón *Rayos X* en la barra de vista
para coger también las ocultas. Un arrastre de unos pocos píxeles es un
clic, `Esc` cancela, el lápiz hace lo que el ratón y un dedo no dibuja
caja (sigue orbitando); la selección no se deshace (una caja no es una
entrada de historial). Con los esquemas que dejan libre el botón
izquierdo (*Alt + botón izquierdo orbita* y *Botón central orbita*), un
arrastre sin más ya dibuja la caja y `Shift` añade sin `Ctrl`; con
*Botón central*, `Alt` quita sin `Ctrl`; con *Alt + botón izquierdo*,
`Alt` es la órbita y quitar es `Ctrl/⌘ + Alt`. Los clics no cambian:
clic selecciona, `Shift` clic añade, `Ctrl/⌘` clic mete o saca, `Alt`
clic quita (salvo con *Alt + botón izquierdo orbita*, donde `Alt` es de
la cámara). En *Completo* se usa la geometría de la vista previa, igual
que `pick`. Nuevos métodos de `ViewportPort`: `projection`,
`visibleTriangles` y `setHoverFaces`.

*Decisión del usuario sobre el gesto (2026-10-13).* El botón izquierdo
sigue orbitando por defecto, y **`Ctrl/⌘` + arrastrar** es la caja; la
primera versión armaba la caja con `Shift`, `Ctrl` o `Alt`. Lo que
cambia respecto al visor anterior: con *Seleccionar* y *Mover*, `Ctrl/⌘`
+ arrastrar con el botón izquierdo ya no desplaza (era el atajo oculto
de los controles de órbita; quedan el botón derecho, la rueda y la
herramienta *Desplazar*). `Shift` + arrastrar y `Alt` + arrastrar no
arman nada y hacen lo que hacía la cámara antes. El texto de *Ajustes ▸
Preferencias ▸ Visor y navegación ▸ Ratón* y el tooltip de *Seleccionar*
lo dicen en los dos idiomas, y se comprobó en el navegador que no
desbordan (la fila de Ajustes pasa a cuatro líneas y el tooltip cabe en
sus 280 px).

*Pruebas.* 89 tests nuevos (25 de `material-drop.test.ts`, 35 de
`box-select.test.ts` y los 29 de M1 en `faces.test.ts`; 1031 en total);
63 mutaciones de los tests unitarios, todas detectadas salvo dos
equivalentes (F9, y la de que `Ctrl` no arme en *Alt + botón izquierdo
orbita*, que ya arma antes por otra rama), y 16 en el navegador, todas
salvo una guarda de orden entre el resaltado de la suelta y el contorno
al pasar que el navegador no puede observar.
`tools/material-drag-check.mjs` y `tools/box-select-check.mjs`
(Playwright con el Chromium local, en *Rápido* y *Completo*, con ratón,
lápiz y dedo); capturas `docs/ui/material-drag.png`,
`material-drag-tree.png`, `material-drag-faces.png`, `box-window.png`,
`box-crossing.png` y `box-faces.png`. Las de *Completo*, que pesan
mucho, se escriben en `out/` y no entran en el repositorio.

No encajó con el plan:

- **La suelta sobre un destino con materiales distintos conserva la
  pregunta en línea de `UI.md` §4.1** (*Sustituir todos · Mantener los
  existentes · Cancelar*, con inventario): es el caso de soltar sobre
  un grupo o un modelo cuyas piezas llevan materiales distintos. La
  fase pedía "una sola acción" y lo es (una entrada de deshacer una
  vez respondida), pero no se aplica a ciegas. Si se prefiere que una
  suelta sustituya sin preguntar, es una decisión de interfaz (Fable);
  mientras tanto vale lo que dice §4.1.
- **A nivel *Caras* el catálogo solo aparece cuando hay una cara
  seleccionada**, así que no hay miniatura que arrastrar antes de
  coger la primera; la suelta cae en **la cara bajo el cursor**, no en
  las seleccionadas.
- **El resaltado del arrastre ignora el ajuste *Contorno al pasar*:**
  sin él, soltar no tendría ninguna señal de a dónde va.
- **Un dedo no arrastra ni dibuja caja** (conserva lo que hacía:
  desplazar los paneles y orbitar); el lápiz es un ratón.
- **La caja no enseña una vista previa de lo que cogerá:** solo el
  rectángulo; la selección cambia al soltar.
- **En el esquema por defecto la caja no se dibuja con un arrastre sin
  más**, sino con `Ctrl/⌘` + arrastrar (decisión del usuario): el
  botón izquierdo orbita y una caja con un arrastre sin más le
  quitaría la órbita. Quien la quiera sin tecla puede elegir el
  esquema *Alt + botón izquierdo orbita* o *Botón central orbita*.
- Dos cosas de estructura: los clics de `Alt` sobre el visor pasan por
  `clickMods` para respetar el esquema *Alt + botón izquierdo orbita*,
  y `ViewportPort` se amplió con tres métodos (`ARCHITECTURE.md`
  §6.1).

## M1 · Cara CAD entera — **Sonnet** — hecha

**Qué.** Selección de caras por continuidad de superficie, portando el
algoritmo E2 de EZ Packshot: adyacencia por **posición** de vértice
(soldadura a 1e-5 del tamaño de la malla), cruce de arista si el diedro es
menor que el ángulo de arista viva (30°) **y** menor que 2.5 veces la
curvatura propia de la cara clicada; las aristas marcadas por el
importador cortan siempre; `Shift` da el triángulo suelto. Con STEP (I2),
los rangos de cara originales ganan.

**Depende de.** U1, I1.

**Criterio.** Tests con placa, placa con vértices duplicados, cilindro
con tapas (la pared entera, se para en las tapas), perfil
plano-redondeo-pared, arista marcada. Verificar que cada uno falla si se
quita su condición.

**Hecho.** `src/core/faces.ts` (modelo puro): `cadFaceRegion` hace
crecer la cara desde el triángulo picado con las reglas de arriba y, en
una pieza de STEP o IGES, devuelve el rango CAD que lo contiene (los
rangos ganan); la topología se calcula una vez por malla y se guarda en
un `WeakMap`. En el visor, a nivel *Caras* un clic coge **la cara
entera**: clic sin más sustituye, `Shift` añade **un triángulo suelto**,
`Ctrl/⌘` mete o saca la cara entera y `Alt` la quita; al arrastrar un
material se tiñe la cara que recibiría (`ViewportPort.setHoverFaces`).
*Separar por caras CAD* (`scene/separateByCadFaces`) deja de ser
*próximamente*: está en el menú de pieza y en la hoja de importación
(que ahora usa el mismo `facePieces`), cada pieza nueva conserva el
color de su cara, la selección sigue a las piezas y el nivel pasa de
*Caras* a *Pieza*. La acción comparte `replaceByPieces` con *Separar por
material*. Además la selección por caja (ver **U7**) coge caras enteras.
29 tests nuevos (`tests/faces.test.ts`: placa, placa con vértices
duplicados, cilindro con tapas, perfil plano-redondeo-pared, arista
marcada, rangos CAD, piezas separadas; las mutaciones se cuentan en
**U7**); capturas `docs/ui/box-faces.png` y
`docs/ui/material-drag-faces.png`; comprobado en el navegador con
`tests/fixtures/box.step` (seis caras CAD).

No encajó con el plan:

- **Límite del borde con curvatura suave (decisión pendiente de
  Fable).** Se cambió una cosa del algoritmo de EZ Packshot: su
  estimación de la curvatura contaba también las aristas que son
  frontera (marcadas o más agudas que 30°), y un triángulo en el borde
  de una cara plana, junto a una pared, medía la curvatura de la
  esquina y la cara se escapaba por un chaflán; aquí solo cuentan las
  aristas que se podrían cruzar (test *a flat face is flat to its
  rim*). Queda el caso que un clic sobre una malla no puede
  distinguir: un triángulo en el borde de una cara plana cuya única
  arista que gira es un redondeo suave (unos pocos grados por paso)
  parece una faceta de una cara curva, y la cara sigue el redondeo; el
  interior de la misma cara plana no. No afecta a STEP ni IGES (los
  rangos no dudan) y la cabecera de `faces.ts` lo cuenta. Datos para
  decidir si basta o si hace falta un criterio de malla (por ejemplo,
  medir la curvatura en el interior de la región ya cogida): no se ha
  cambiado nada por cuenta propia.
- **`Shift` suelto y `Shift` añade.** M1 pedía "`Shift` da el
  triángulo suelto" y `UI.md` §4.1 "`Shift` añade": a nivel *Caras*,
  `Shift` hace las dos cosas, `Shift` clic **añade el triángulo
  suelto**. Como `Shift` solo vuelve suelto el triángulo y el resto de
  teclas conservan su sentido, `Ctrl/⌘ ⇧` clic lo mete o saca y `Alt
  ⇧` clic lo quita (con *Alt + botón izquierdo orbita*, donde `Alt` es
  de la cámara, no hay `Alt ⇧`); `Ctrl/⌘` y `Alt` sin `Shift` actúan
  sobre la cara entera.
- **La caja de caras trabaja sobre una sola pieza** (`Selection.faces`
  es `{part, indices}`): la seleccionada y, si no hay, la que está en
  el centro de la caja. Sin *Rayos X* solo coge lo que se ve, medido
  con un pase de identificadores del visor (un id por triángulo, con
  una erosión de un píxel para que no cuenten las siluetas de lo
  oculto), así que una cara más estrecha que unos 3 px no se coge; con
  *Rayos X* coge también las ocultas, por geometría.
- ***Separar por caras CAD* solo existe para piezas con rangos** que
  cubren la malla (`canSeparateByFaces`); en una malla sin ellos sigue
  deshabilitado en lugar de partir por continuidad.
- **El contador dice *caras* y cuenta triángulos** (`inspector.faces`:
  un cubo de seis caras CAD entero dice *12 caras de* su pieza): el
  modelo de datos guarda triángulos. Contar caras CAD pide guardar
  también qué rangos se han cogido; se deja anotado.
- **Un clic no tiñe la cara antes de cogerla**: al pasar el ratón sin
  arrastrar nada, a nivel *Caras* solo se contornea la pieza; la cara
  se ve al cogerla. El tinte previo es solo el del material
  arrastrado.
- La ayuda que `UI.md` llamaba `faceSel.help` no existe con ese
  nombre: era `level.tip.FACES`, que ya no dice "próximamente" (se
  reescribió), y se quitó `ops.separateCadSoon`.
- Arreglos de fallos que ya estaban: el inspector no se reconstruía al
  coger la primera cara (`contextKey` no distinguía si había caras;
  con test), y `material/assign` sin cambios creaba una entrada de
  deshacer vacía (ahora devuelve el mismo estado; con test).

## U9 · Primitivas y herramienta de escalar — **Opus** — hecha

**Petición del usuario (2026-10-13):** «quiero poder añadir geometrías
sencillas, algo así como rectángulos de base, cilindros, esferas… y con el
paneo, el típico apartado de escalar, aparte de poder escalar cada pieza
con clic derecho».

**Decisiones del líder.**
- **Añadir ▸ Primitiva** (menú *Añadir* de la cabecera, el botón `+` del
  panel *Escena*, la paleta de comandos y el menú contextual del visor en
  vacío): *Caja* (con radio de bisel), *Plano*, *Disco*, *Cilindro*,
  *Pedestal* (cilindro con bisel), *Esfera*, *Cono*, *Toro*, *Cápsula*,
  *Tubo*, *Escalones* y *Fondo infinito* (la curva de estudio: suelo que
  sube en curva hasta una pared). Claves estables en un catálogo de datos.
- **Paramétricas y vivas**: cada primitiva guarda su tipo y sus medidas en
  mm (ancho, fondo, alto, radio, bisel, segmentos…), editables en el
  inspector (sección *Primitiva*); cambiar una medida regenera la malla con
  **una acción del *store*** y una entrada de deshacer (un arrastre, una
  sola). *Convertir en malla* la congela.
- **Tamaño y sitio por defecto con criterio de estudio**: se crea apoyada
  en el suelo, junto al producto o debajo si es una base (la *Caja* y el
  *Pedestal* nacen como base: 1,4 × la huella del producto y el producto
  apoyado encima), escalada a la escena; sin producto, a un tamaño
  razonable. Material neutro del catálogo.
- **Geometría limpia**: generación pura y determinista en `src/core/`,
  normales y UV correctas (para M2), suavizado por ángulo, y **caras CAD**
  (`faceRanges`) por cara lógica (la tapa, el lateral, el bisel…), para
  que el nivel *Caras* y M1 funcionen con ellas.
- **Proyecto**: la primitiva se guarda como parámetros (no como malla) en
  un campo opcional del nodo; *schema* 2 sigue valiendo y un proyecto
  antiguo abre igual. El motor la recibe como una malla más (RSB sin
  cambios).
- **Herramienta *Escalar*** (`S`) en la barra de vista, junto a
  *Desplazar*: el mismo *gizmo* de *Mover* pero solo con las asas de
  escala (por eje y uniforme en el centro), alrededor del pivote, en ejes
  locales o globales, con incrementos con `Shift`; el inspector muestra
  la escala en vivo. Un arrastre, una entrada de deshacer.
- **Clic derecho ▸ Escalar…** en una pieza (visor y árbol): un panel en
  línea con *Uniforme* (%), por eje (X, Y, Z en %) o **a medida** (mm del
  ancho, fondo o alto con proporción bloqueada), *Aplicar* y *Restablecer
  escala*; actúa sobre la selección al nivel vigente.

**Criterio.** Tests de cada primitiva (cerrada donde debe, normales hacia
fuera, UV en [0, 1], `faceRanges` que cubren la malla, determinismo,
medidas exactas en mm), de la regeneración deshacible, del guardado y la
apertura, de la escala por eje, uniforme y a medida (alrededor del
pivote, a cada nivel); capturas del menú, del inspector y de la
herramienta; cadenas en `es` y `en`; cromo acromático.

**Hecho.** `src/data/primitives.json` (+ `primitives.ts`): las doce formas
con claves estables (`BOX`, `PLANE`, `DISC`, `CYLINDER`, `PEDESTAL`,
`SPHERE`, `CONE`, `TORUS`, `CAPSULE`, `TUBE`, `STEPS`, `SWEEP`), su papel
(`BASE`, `FLOOR`, `BACKDROP`, `OBJECT`), sus medidas (claves, mínimos,
pasos, factor del tamaño de la escena o valor fijo) y el material neutro
`WHITE_STUDIO`; los nombres y las etiquetas de las medidas son cadenas de
la interfaz. `src/core/primitives.ts`: generadores puros y deterministas,
en mm, Z arriba, **centrados en su caja** (que es exactamente sus medidas:
senos y cosenos exactos en los múltiplos de 90°, ningún `h − b + b`), con
un constructor que orienta cada triángulo hacia sus normales y quita las
astillas; superficies de revolución con polos por segmento (la punta del
cono tiene la normal de su faceta), caja redondeada con aristas y esquinas
que se encuentran bit a bit (tabla de cuarto de vuelta simétrica),
escalones en rejilla sin uniones en T, fondo infinito desenrollado;
estancas salvo plano, disco y fondo; normales de la superficie dentro de
cada cara lógica; UV en [0, 1] por cara y sin estirar; cada cara lógica es
un rango de `faceRanges` (y su borde, arista viva), así que *Caras*, M1 y
*Separar por caras CAD* funcionan; medidas acotadas a lo que da una forma;
el id de malla `prim:<dueño>:<FORMA>:<medidas>` nombra contenido y dueño.
`src/core/primitive-ops.ts`: `placePrimitive` (base 1,4 × la huella bajo
el producto, con el producto encima; planos bajo él, una milésima sobre el
suelo; el resto junto a lo que está de pie; sin producto, en el origen y
encuadrado), `fitSweep` (decisión del líder durante la fase, tras ver las
primeras capturas: el fondo infinito de cara a la cámara activa, girado en
Z a su acimut, la pared a 1,75 fondos del producto detrás de él y detrás
de los focos del montaje que quedan detrás del producto
(`wallBehindLights`), ancho 1,3 veces el encuadre donde lo toca, por
encima de lo más alto del encuadre, curva de 0,3 veces el alto;
*Ajustar a la cámara* lo rehace con `scene/fitPrimitive`), y las acciones `scene/addPrimitive` (una entrada de
deshacer con el levantamiento), `scene/setPrimitive` (regenera, conserva el
apoyo, arrastra las copias enlazadas, los materiales por cara y las caras
seleccionadas siguen a sus caras por nombre) y `scene/convertPrimitive`.
`SceneNode.primitive` es el campo opcional del proyecto: `io/project.ts`
no escribe esas mallas y las regenera al abrir (esquema 2, byte a byte).
Herramienta *Escalar* (`S`, junto a *Desplazar*): el *gizmo* con solo
asas de escala (`Gizmo.setMode('SCALE')`, cubos al final de ejes enteros
que se cogen y el punto central; una longitud de cubo más duplica);
*Clic derecho ▸ Escalar…* con `ui/panels/scale-panel.ts` (uniforme, por
eje, a medida con candado, *Aplicar* y *Restablecer escala* =
`scene/resetScale`) en el visor y en el árbol; `selectionExtents` mide la
selección en los ejes en vigor. *Añadir ▸ Primitiva* en el menú de la
cabecera, el `+` del panel *Escena*, la paleta (*Añadir caja*…) y el menú
del visor en vacío; sección *Primitiva* del inspector con *Convertir en
malla*, que también está en *Geometría ▸*. Pruebas: `tests/primitives.test.ts`
(cada forma: mismos bytes, caja exacta y centrada, UV, normales, caras que
cubren la malla, estanqueidad, aristas vivas, volúmenes analíticos, medidas
acotadas, id) y `tests/primitive-ops.test.ts` (colocación, base y huella,
producto encima, una entrada de deshacer, producto bloqueado, planos y
fondo, el pivote de luces y la escala que no ven el decorado, edición viva y
deshacer, copias enlazadas e independientes, caras pintadas y
seleccionadas, convertir, guardar y abrir byte a byte, forma desconocida y
medidas fuera de rango en un archivo, escala uniforme, por eje (también en
ejes locales) y a medida alrededor del pivote a nivel *Modelo*, *Grupo* y
*Pieza*, *Restablecer escala*, las asas de *Escalar*, el atajo y las
cadenas). `tools/primitives-check.mjs` lo comprueba en el navegador en
*Rápido* y *Completo* y hace las capturas `docs/ui/primitives-add-menu.png`,
`primitives-base-box.png`, `primitives-pedestal.png`,
`primitives-pedestal-full.png`, `primitive-inspector.png`,
`scale-tool.png` y `scale-panel.png`, y además comprueba con los píxeles
que el fondo infinito llena el encuadre (esquinas y centro del borde de
arriba claros, no la cúpula oscura) y que *Ajustar a la cámara* lo
rellena tras orbitar. 133 tests nuevos (91 de `primitives.test.ts` y 42
de `primitive-ops.test.ts`; 1627 en total); 42 mutaciones del código
nuevo, todas detectadas (cinco no lo eran a la primera: el recorte de las
UV ocultaba un mapeo malo y se quitó, y la normal de la punta del cono, los
materiales por cara que se desplazan, lo que está de pie junto a un fondo
y un fondo que se aleja por su curva no tenían test o lo tenían demasiado
permisivo; se arreglaron los tests).

No encajó con el plan:

- **El producto, no el decorado.** Un fondo infinito seis veces mayor que
  el producto movía el pivote de las luces (`rigPivot` era el centro de la
  escena), el encuadre de *Crear estudio*, el tamaño medido (y el chequeo
  de escala del Doctor, cuyo arreglo reescalaría todo) y el mapa de
  sombras. Ahora todos miden `productBounds`: las piezas que no son
  primitivas (si solo hay primitivas, todas). Es un criterio de
  arquitectura que no estaba en el plan; *Encuadrar todo* sigue
  encuadrando todo. Si Fable prefiere marcar el decorado de otro modo (por
  ejemplo, solo bases y fondos, no cualquier primitiva), es un cambio de
  una función.
- **El tamaño de pieza** se detecta ahora también cuando entra el primer
  producto en una escena que solo tenía primitivas (antes, solo en una
  escena vacía).
- **Mallas centradas, no apoyadas en su origen**: el Doctor avisaba de un
  origen descentrado en cada primitiva y su arreglo la desplazaba. La
  pieza conserva su apoyo al cambiar medidas por el centro de la base de
  su caja, en sus propios ejes.
- **Planos, disco y fondo infinito una milésima sobre el suelo**: su cara
  de arriba está donde el suelo del estudio, que en el motor es un *shadow
  catcher*, y un empate de distancias entre los dos parpadea. Por encima
  gana la geometría, que recibe sombras de verdad en *Completo*; en
  *Rápido* la sombra de contacto queda bajo el fondo (la vista previa solo
  la dibuja en el suelo). No se apaga el suelo del estudio al añadir un
  fondo: es una decisión fotográfica (Fable).
- **Una versión anterior a U9 no ve las primitivas** de un proyecto nuevo
  (no hay malla en el archivo; abre con el aviso de geometría que falta):
  la compatibilidad es hacia atrás, como se pidió.
- **Cambiar las medidas de una base no vuelve a subir el producto**, y
  una base nueva bajo un producto que ya está sobre otra va al suelo (el
  producto se apoya en la nueva). Una pieza escalada con *Escalar* sigue
  mostrando sus medidas sin escala en la sección *Primitiva* (la nota lo
  dice).
- **Invertir normales, Suavizado y Separar congelan la primitiva** (dejan
  de ser paramétricas), porque su malla ya no es la de sus medidas.
- **El fondo infinito se ajusta a la cámara**, no a los ejes del mundo
  (petición del líder a mitad de fase): las primeras capturas dejaban ver
  el entorno oscuro en una esquina del encuadre. Si la curva llegaría bajo
  el producto (un producto muy plano de fondo), la pared se aleja más de
  los 1,75 fondos. Mover la cámara después no lo reajusta solo: para eso
  está *Ajustar a la cámara*. El test lanza rayos por una rejilla de 7 × 7
  del encuadre en ocho cámaras (de frente, cenital, ortográfica, tele en
  vertical, gran angular cuadrada, un producto delgado) y todos dan en el
  fondo.
- **Un fondo infinito tapaba los focos que quedan detrás de su pared
  (decidido por Fable a mitad de fase).** Con el montaje *Estándar* y la
  cámara de referencia, el contraluz (*RIM*, 70 W, a unos 290 mm detrás
  del producto) quedaba detrás de la pared, que estaba a 154 mm: en
  *Completo* la pared lo tapaba y la imagen salía más plana y gris que en
  *Rápido* (la vista previa no hace sombras de los focos). **Decisión:** un
  fotógrafo pone el papel lo bastante atrás para que el contraluz y los
  focos traseros quepan entre el producto y el fondo, así que la luz que
  eligió el usuario sigue funcionando. `fitSweep` (al añadir y en
  *Ajustar a la cámara*) lleva la pared detrás de cada foco encendido del
  montaje que está detrás del producto según la dirección de la cámara, a
  1,25 veces lo que ese foco está detrás del centro del producto más la
  mitad de su panel (`SWEEP_FIT.lights`, `wallBehindLights`; un sol no
  cuenta), y luego calcula ancho, alto y curva para cubrir el encuadre a
  esa distancia como antes. En la vista de referencia la pared pasa de
  154 mm a unos 480 mm. Los focos traseros que acaben dentro del encuadre
  quedan fuera de esta decisión. Test: con el montaje *Estándar* y la
  cámara de referencia ningún foco queda detrás de la pared (falla con la
  distancia antigua), y sin focos detrás la pared vuelve a estar a 1,75
  fondos.
- **El nombre de *Añadir*.** No hay un menú *Añadir* propio en la cabecera
  (UI.md §2.1 es *nada más*): es una entrada *Añadir ▸* del menú de
  aplicación, con el rótulo *Primitiva* y las doce formas debajo.
- *Escalar…* del menú contextual no muestra atajo (`S` enciende la
  herramienta, no abre el panel). Los modificadores de la caja de
  selección y los clics son los de *Mover*.

## U10 · Recorrido guiado y avisos de la IA — **Sonnet** — hecha

**Petición del usuario (2026-10-13):** «avisar si no se tiene instalado el
*inference runtime*; la primera vez que se inicie la app, un tutorial que
se pueda saltar pero que te guíe por todas las opciones; al instalar, si
se selecciona la IA, que pida instalar también el *inference runtime*».

**Decisiones del líder.**
- **Recorrido guiado** al primer arranque (y desde *Ayuda ▸ Recorrido
  guiado*): una capa propia (nunca ventanas del navegador) que resalta
  cada zona en orden — cabecera y menú, árbol y niveles de selección,
  herramientas de vista (Seleccionar, Mover, Escalar, Orbitar, Desplazar,
  Zoom, caja con `Ctrl`), *Rápido/Completo*, inspector (producto, luz y
  montajes, entorno y cielo, cámara y enfoque con clic, materiales y
  arrastre), pestañas de luces, cámaras y estudios, *Añadir ▸ Primitiva*,
  ventana de render (cola, IA), visor de resultados y *Ajustes* por
  secciones — con un texto corto por paso, *Siguiente · Atrás · Saltar*,
  puntos de progreso y teclado (`→`, `←`, `Esc`); en `es` y `en`;
  acromático; usa los `data-guide` que ya existen. Se recuerda en el estado
  de la plataforma (carpeta de datos en escritorio) que ya se vio; *Saltar*
  cuenta como visto.
- **Aviso del motor de ejecución**: si hay un modelo de IA y no está el
  motor de ejecución (o le falta Visual C++), la sección de IA de la
  ventana de render y *Ajustes ▸ Post-procesado IA* lo dicen con un botón
  *Instalar*; al arrancar, una nota discreta en la barra de estado, una
  sola vez por sesión.
- **Instalador**: si en el paso *Modelos de IA* se elige algún modelo, se
  marca también el **motor de ejecución** recomendado para el equipo
  (Vulkan con GPU, CPU sin ella), se puede desmarcar, y la app lo
  descarga en el primer arranque como los modelos (la regla de P2: el
  instalador elige, la app descarga). Lo mismo en el selector del primer
  arranque de los portables.

**Criterio.** Tests del orden del recorrido (todos los pasos apuntan a algo
que existe; ningún paso apunta a un elemento oculto), de *Saltar* y del
recuerdo (no vuelve a salir; sí desde *Ayuda*), del aviso con y sin motor
de ejecución, del archivo de elección del instalador con el motor
incluido (y del NSIS que lo escribe); capturas de tres pasos y del aviso.

**Hecho.** *Recorrido guiado* (`src/ui/tour.ts`, `src/ui/panels/tour.ts`,
`src/ui/tour.css`; `UI.md` §4.7): 30 pasos en la web y 31 en el escritorio,
en el orden de arriba (bienvenida, menú, piezas y niveles, herramientas,
*Rápido/Completo*, producto, luz, entorno, cámara, materiales, las tres
pestañas, *Añadir ▸ Primitiva*, *Render…*, ventana de render, cola, IA,
resultados, una sección de Ajustes por paso y el cierre), con texto corto en
`es` y `en`, *Siguiente · Atrás · Saltar*, un punto por paso y `→ ← Esc`. Es
modal (se queda con el puntero y con todas las teclas: `Supr` no borra bajo
él), acromático, y localiza las zonas por los `data-guide` (los de la guía y
los nuevos). Un paso cuya zona no está a la vista la pone (pestaña, panel
lateral —en una ventana estrecha solo el que hace falta—, ventana de render
o de Ajustes, cajón *Cola*, catálogo de materiales, selección) y al terminar
todo vuelve a como estaba; un paso cuya zona no aparece en 0,7 s se salta.
La tarjeta va al lado de la zona, fuera de la ventana de render o de
Ajustes cuando hay sitio y, si no, dentro, donde no tape ningún control.
*Saltar*, *Hecho* y `Esc` cuentan como visto: `layout.tourSeen` en el
documento de ajustes (la carpeta de datos en escritorio, nada en el
almacenamiento del navegador allí). Sale solo en el primer arranque, tras el
selector de modelos de un portable, y desde *Ayuda ▸ Recorrido guiado* (nuevo
submenú del menú de la aplicación, y la paleta).

*Aviso del motor de ejecución*: `runtimeWarning` (`core/ai-runtimes.ts`, puro)
dice qué pasa con un modelo instalado —no está, en pausa, bajando, no
arranca, falta Visual C++ en Windows, no hay compilación para el sistema—;
`ui/ai-runtime-state.ts` tiene el único sondeo del lanzador; el recuadro con
*Instalar · 26 MB* (el flujo de la fila del motor de Ajustes), *Reanudar*,
*Pausar*, *Instalar el entorno de Microsoft Visual C++…* y *Comprobar de
nuevo* sale en la sección de IA de la ventana de render (con una marca en su
título plegado) y arriba de *Ajustes ▸ Post-procesado IA*, y la barra de estado
lleva una nota discreta una sola vez por sesión. **Instalador**: `repackshot
--hardware` escribe `[runtime]` (la compilación que elige la regla de
`ai-runtimes.json` para el sistema; con `--device cpu`, la de CPU), el paso
*Modelos de IA* marca la casilla al elegir el primer modelo, se puede
desmarcar y anota `"runtime"` en `pending-models.json`; el lanzador la
descarga en el primer arranque (`Ai::start_pending_runtime`); el selector del
primer arranque de un portable la ofrece igual y la baja con el primer
modelo. Tests: la regla, la tabla de avisos, el sondeo, la nota una vez por
sesión y los botones (`tests/ai-runtime-warning.test.ts`); el orden del
recorrido, que cada ancla existe en el código, que cada paso abre lo que
necesita y lo devuelve, *Saltar* y lo recordado, cuándo arranca, las teclas, la
tarjeta y los textos en los dos idiomas (`tests/tour.test.ts`); el NSIS leído
como texto contra el lanzador (`engine/crates/rt-app/tests/installer.rs`,
`tests/installer-page.test.ts`); el lanzador descargando lo que el instalador
dejó, sobre sockets con el `curl` real y un servidor local, y sin descargar
nada con una clave de otro sistema, desconocida o sin motor
(`tests/ai.rs`). Comprobaciones del navegador: `tools/tour-check.mjs` (el
recorrido entero, ancho, estrecho y en español, con sus capturas) y
`tools/ai-runtime-check.mjs` (contra el lanzador real: selector, avisos, nota,
Visual C++ y el estado en la carpeta de datos). Cada test falla si se
rompe lo que guarda. Capturas en `docs/ui/`: `tour-tools.png`,
`tour-camera.png`, `tour-render-ai.png`, `tour-settings-es.png`,
`ai-runtime-warning-render.png`, `ai-runtime-warning-settings.png`,
`ai-runtime-warning-vc.png`, `ai-runtime-chooser.png`, `ai-runtime-note.png`.

**No encajó con el plan.** (1) El *Ejecutar en el procesador* del instalador
no se aplicaba a nada: para que el motor que marca el instalador sea el que
la aplicación espera, el primer arranque lo convierte en *Ajustes ▸
Post-procesado IA ▸ Ejecutar en* (`applyInstallerChoice`); es una decisión
que no estaba en el plan. (2) La página del instalador no se puede ver aquí
(*makensis* la compila con `-WX`, pero Wine no ejecuta un instalador NSIS):
su lógica está cubierta como texto, y falta mirar en un Windows real que la
fila nueva cabe en la página con seis modelos de dos líneas. (3) La
descarga del motor desde el instalador, de punta a punta, tampoco se puede
probar aquí; sí el lanzador (sockets) y la página (lanzador real). (4) Falta
Visual C++ no se puede producir en Linux: el navegador lo prueba con la
respuesta del lanzador cambiada. (5) La tarjeta de un paso de Ajustes va
dentro de la ventana, donde no tapa ningún control pero sí texto de
descripción; una sección que sea toda controles la dejaría en la esquina
inferior derecha. (6) Quien actualiza desde una versión anterior ve el
recorrido una vez (no hay marca previa que lo distinga de un primer
arranque). (7) *Ayuda ▸* agrupa lo que antes eran tres entradas sueltas
(*Guía*, *Atajos*, *Acerca de*); la *Guía* de seis pasos sigue como estaba y
el recorrido no la sustituye. (8) Con los modelos todavía bajando (el
instalador los dejó pendientes) no hay aviso: «hay un modelo» es un modelo
instalado.

## M2 · Texturas de imagen y etiquetas — **Opus** — sustituida por M2a y M2b

**Nota (Fable, tras v0.1.5).** Esta fase se divide en M2a (sin motor:
importación, ranuras, etiquetas, vista previa y contrato RSB) y M2b (el
motor), definidas más arriba en «Materiales y sets con efecto». El texto
siguiente se conserva como origen.

**Qué.** Texturas de color, rugosidad, metal, normal y alfa con proyección
caja, plana, cilíndrica y UV, escala, rotación y desplazamiento; etiquetas
(*labels*): una imagen con alfa proyectada sobre una zona de la pieza,
colocada con clic y arrastre, con su propio acabado (brillo distinto del
sustrato). Es la función más usada de packaging y cosmética. Las
imágenes viajan al motor como secciones RSB propias.

**Depende de.** E5.

**Criterio.** Captura con una botella etiquetada; test de proyección caja
(un cubo recibe la textura sin estirar en las seis caras); el proyecto
guarda las imágenes embebidas.

## N1 · Animación y vídeo al estilo KeyShot — **Opus** — hecha

**Qué.** Sustituir el editor de U1 (planos + tarjetas) por el modelo de
`SPEC.md` §3.7 y la interfaz de `UI.md` §2.5, que siguen cómo funciona
el de KeyShot: una sola línea de tiempo con **una pista por objetivo** y
**barras** arrastrables y estirables; la **pista de cámara** con tramos
de cámara activa y eventos de **cambio de cámara** (corte o fundido a
color); el **asistente de animación** en tres pasos (tipo en rejilla de
tarjetas agrupadas, objetivo, parámetros) en línea en el inspector; el
**inspector de animación** con curva de tiempo (incluida *personalizada*
con dos asas), invertir y repetir; las animaciones **bajo su objetivo en
el árbol**; reproducción con cabezal, fps, bucle y vista previa rápida.
Tipos nuevos en `src/data/animation.ts` sin renombrar los existentes:
`FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC` (este último se activa con E5),
`PATH` reservado. `evaluate(state, t)` completo para todos los tipos,
composición por objetivo y conflictos visibles; despiece (centro,
disposición, factor). Migración del estado de U1: los planos pasan a
tramos de la pista de cámara y los movimientos a barras, sin perder nada
(test con un proyecto de U1 guardado). **Salida**: modo *Animación* en
la barra de render (rango, fps, vídeo o fotogramas, presupuesto por
fotograma, estimación), un RSB por fotograma renderizado por el pool de
workers, codificación en el navegador (WebCodecs → WebM/MP4; secuencia
PNG/JPEG como alternativa siempre disponible), trabajos de animación en
la cola. La *previa renderizada* (motor a pocas muestras por fotograma)
y el fundido cruzado quedan para después y se marcan *próximamente*.

**Depende de.** U1, U3 (el pivote y los ejes locales de las rotaciones),
E4 (para la salida renderizada; la línea de tiempo y la vista previa
rápida no dependen de él y pueden ir antes).

**Criterio.** Tests de `evaluate` con números (órbita de 90° en 4 s a
mitad con *suave* da 45°; rotación con pivote en otra pieza mantiene la
distancia a ese pivote; `FADE` invertida y repetida 2 veces da el valor
esperado en 5 instantes; curva personalizada con asas en (0.42, 0) y
(0.58, 1) coincide con la de referencia ±1e-3); los 16 presets producen
un estado válido en cada fotograma; una barra arrastrada en la línea de
tiempo produce una sola entrada de deshacer; el proyecto de U1 migra con
el mismo resultado en `t = 2 s`; un vídeo de 2 s a 12 fps sale y se
reproduce; captura de la línea de tiempo con tres pistas y el asistente
abierto en el paso 1.

**Qué no tocar.** Las claves existentes de `MOVE_KINDS` y
`SEQUENCE_PRESETS` (se añade, no se renombra); el motor (`engine/`).

**Auditoría al empezar** (sobre `main` en v0.1.15, punto por punto del
brief y del criterio; N6 y U5 ya habían construido una parte):

| Punto | Estado al empezar | De qué fase | Qué hizo N1 |
| --- | --- | --- | --- |
| Una línea de tiempo con una pista por objetivo y barras arrastrables y estirables | Hecho | N6: árbol de lo animado + carriles, imán, un arrastre = una entrada de deshacer | Nada que rehacer; filas nuevas para los materiales |
| Pista de cámara con tramos de cámara activa | Hecho | N6 (tramos, borde arrastrable, cámara del plano en su menú) | Clic en un tramo: sus propiedades |
| Cambio de cámara: corte o fundido a color | Parcial: solo el corte implícito en el borde de un plano | U1, N6 | `Shot.transition`: corte o fundido a negro o blanco con duración; propiedades del plano, marca en la pista, el visor y cada fotograma |
| Asistente en tres pasos (tipo en rejilla de tarjetas agrupadas, objetivo, parámetros), en línea | Parcial: tres secciones a la vez, el tipo en una lista | U1; N6 puso el objetivo de la selección | Tres pasos con *Atrás* y *Siguiente*, la rejilla de tarjetas agrupada; el objetivo primero (el orden de N6) |
| Inspector de animación: curva de tiempo, *personalizada* con dos asas | Parcial: curva con vista previa, sin personalizada | N6 | `CUSTOM` con el editor de dos asas |
| Invertir y repetir | Hecho | N6 (`reverse`, `repeat`) | Probados en el criterio de `FADE` |
| Las animaciones bajo su objetivo en el árbol | Falta | — | Bajo piezas, grupos y el modelo |
| Reproducción: cabezal, fps, bucle, vista previa rápida | Hecho | U1, N6 | Los fundidos, colores y el sol en la vista previa rápida |
| Tipos `FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC`, `PATH` reservado | Falta | — | Los cinco, al final de `MOVE_KINDS` |
| `evaluate` completo, composición por objetivo, conflictos visibles | Parcial: los tipos de entonces; conflictos marcados | U1, N6 | Los tipos nuevos, el pivote de un giro, el objetivo material |
| Despiece (centro, disposición, factor) | Hecho | N6 | — |
| Migración del estado de U1 (planos a tramos, movimientos a barras), con un proyecto de U1 | Parcial: el modelo de N6 es el de U1 (planos y clips) y se lee; ningún test decía que reproduce lo mismo | N6, U2 (`project-v1.json`) | Test con `project-v1.json` contra las poses que daba el código de U1 |
| Salida: modo *Animación* (rango, fps, vídeo o fotogramas, presupuesto por fotograma, estimación) | Hecho salvo el vídeo | U5 | El vídeo |
| Un RSB por fotograma renderizado por el *pool* | Hecho | U5 | — |
| Codificación en el navegador (WebCodecs → WebM/MP4), secuencia siempre disponible | Falta (*próximamente*); el `output` del Doctor dormido | U5, D1 | WebCodecs, *muxers* propios, el Doctor conectado |
| Trabajos de animación en la cola | Hecho | U5 | Trabajos de vídeo |
| Previa renderizada y fundido cruzado: *próximamente* | — | — | Siguen *próximamente* |
| Criterio: órbita de 90° en 4 s a mitad con *suave* da 45° | Hecho | U1 (`tests/animation.test.ts`) | — |
| Criterio: rotación con pivote en otra pieza mantiene la distancia | Falta (no había pivote) | — | `tests/animation-n1.test.ts` |
| Criterio: `FADE` invertida y repetida 2 veces, 5 instantes | Falta | — | Ídem |
| Criterio: curva personalizada (0.42, 0) y (0.58, 1) ±1e-3 | Falta | — | Ídem (frente a una bisección propia de la prueba) |
| Criterio: los 16 presets dan un estado válido en cada fotograma | Hecho | U1 | Extendido a los campos nuevos de la pose |
| Criterio: una barra arrastrada es una entrada de deshacer | Hecho | N6 (prueba y `tools/animation-check.mjs`) | Lo mismo para un asa de la curva y un fundido |
| Criterio: el proyecto de U1 migra igual en t = 2 s | Falta | — | `tests/animation-migration.test.ts` |
| Criterio: un vídeo de 2 s a 12 fps sale y se reproduce | Falta | — | `tests/video.test.ts` y `tools/video-check.mjs` |
| Criterio: captura de la línea de tiempo con tres pistas y el asistente en el paso 1 | Falta | — | `docs/ui/animation-n1-wizard.png` |

**Hecho.** Lo que faltaba o estaba a medias, sin rehacer lo de N6 ni U5:

- **Tipos nuevos** (`src/data/animation.ts`, añadidos al final; las 17 claves de
  antes, intactas): `FADE` (la cantidad es la **opacidad final** en %, por
  defecto 0; invertido, aparece; los de un nodo y sus grupos se multiplican),
  `PAN` (la cámara gira donde está: su objetivo da la vuelta alrededor de su
  posición; positivo, a su derecha), `MATERIAL_COLOR` (el color base de un
  material, desde el que dejaron los clips anteriores, hacia el del clip),
  `SUN_ARC` (el sol gira alrededor del polo celeste, 15° por hora: el primer foco
  solar que alumbra o, sin él, el sol propio del cielo) y `PATH`, solo en el
  catálogo (`RESERVED_MOVES`: nada lo ofrece ni lo reproduce). `CUSTOM` se añade a
  `EASING_KINDS`; `MOVE_GROUPS` da sus grupos al asistente. Un objetivo nuevo,
  `MATERIAL` (`ClipTarget`), y con él todas las piezas que lo llevan
  (`partsWearing`).
- **Giro con pivote** (`MotionClip.pivot`): `SPIN` y `TUMBLE` de una pieza o
  grupo alrededor del centro de otra pieza o de un punto, sobre su propio eje (Z o
  X), hecho en el mundo y devuelto al padre; sin pivote, exactamente lo de antes.
- **Curva personalizada** (`src/core/curve.ts`): Bézier cúbica de dos asas
  (x en 0..1, y en −0,25..1,25), Newton desde la fase y bisección donde la curva
  se pone vertical. Editor en las propiedades (`ui/components/curve-editor.ts`):
  arrastre con una entrada de deshacer, flechas, y sus cuatro números.
- **Cambio de cámara** (`Shot.transition`, `shotFadeAt`): corte o fundido a
  negro o blanco (0,04–10 s, 0,5 s por defecto) centrado en el corte, con la curva
  suave y nunca más largo que la mitad de cualquiera de los dos planos; en el
  primer plano, un fundido de entrada. Propiedades del plano al hacer clic en su
  tramo, marca sobre el corte en la pista, el color sobre el encuadre del visor al
  reproducir, y en cada fotograma renderizado (`src/core/fade.ts`: en los valores
  de una imagen de 8 o 16 bits, en luz lineal en EXR, TIFF de 32 bits y DNG).
- **El motor sin tocarlo**: la escena RSB (`src/io/rsb.ts`) lleva los fundidos
  como cobertura (una copia del material por opacidad, con su dibujo de madera o
  tela y su programa; un emisor baja su emisión; a 0 % la pieza no está), el color
  de un material posado y el sol del cielo movido. Sin animación nueva, los mismos
  bytes que antes (las pruebas de paridad siguen fijadas).
- **Rápido** (`src/render/fade-preview.ts`): el material compartido puesto como lo
  deja el clip (y devuelto a su instancia después), una copia translúcida para
  cada pieza que se funde, el sol del arco en el cielo y en los focos.
- **Asistente en tres pasos** con la rejilla de tarjetas (icono, nombre, frase),
  agrupada en *Piezas · Cámara · Luz y entorno · Materiales* con el grupo del
  objetivo primero; *Un material* como objetivo; el color en el paso 3.
- **Bajo su objetivo en el árbol de la escena**: las animaciones de una pieza o
  grupo bajo ella, las del modelo bajo el modelo, con su icono y su frase corta;
  clic abre el cajón con ella elegida.
- **Vídeo codificado** (`src/io/video.ts`, `webm.ts`, `mp4.ts`; ARCHITECTURE
  §5.4 ter): WebCodecs preguntado en tiempo de ejecución (WebM con VP9 o VP8, MP4
  con H.264 *Constrained Baseline* del nivel que pide el tamaño), *muxers* propios
  de las especificaciones públicas, un trabajo de vídeo en la cola que pasa cada
  fotograma al codificador y guarda **un archivo**; la ventana de render solo
  ofrece lo que el sistema codifica (lo demás deshabilitado con su porqué). En el
  Chromium de aquí: **VP9, VP8 y AV1 sí, H.264 no**.
- **Doctor** (`output`): `EngineFacts.videoCodecs` sale de la respuesta del
  navegador (`ui.video`, `encodableCodecs`) y el chequeo avisa **solo** de un
  vídeo con un contenedor que este sistema no codifica (arreglo: fotogramas); las
  pruebas de D1 se reescribieron con eso (un vídeo que sí se codifica ya no es un
  aviso), y una nueva sigue la respuesta del navegador hasta el aviso.
- **Accesibilidad del cajón** (lo que el repaso de H1 dejó a esta fase): los
  presets vuelven a ser botones, cada uno dentro de un elemento `listitem` de una
  lista con nombre; el árbol de lo animado (`role="tree"`, con nombre y el foco)
  dice qué fila está activa con `aria-activedescendant` (cada fila con su `id` y
  `aria-selected`) y **↑ ↓** van a la animación de arriba o de abajo; la regla,
  que está dentro del árbol, queda para el puntero (`aria-hidden`, sin etiqueta;
  su ayuda sigue) porque el cabezal ya se mueve con el teclado desde el árbol.
  `tests/a11y-timeline.test.ts` (4, en Chromium como el de H1) y una prueba de las
  teclas.
- **La marca del fundido** en la pista de cámara tapaba el principio del nombre del
  plano siguiente y usaba la duración pedida aunque los fotogramas la recorten a la
  mitad de un plano: `shotFadeSpan` (core) es ahora el tramo que usan los
  fotogramas (`shotFadeAt`) y la pista, y el nombre del plano empieza pasada la
  marca (una prueba del tramo y otra en Chromium, que fallan sin el arreglo).
- **Galería**: las cuatro capturas, con su entrada en `docs/GALERIA.md` bajo
  *Sin publicar* (por versión y por función) y una fila en «Sin captura» con lo de
  N1 que no tiene imagen (el fundido en el visor y en un fotograma, una pieza que
  se funde, el pivote, el arco solar, un fotograma del vídeo y el MP4).
- **Migración de U1**: `tests/fixtures/u1-hero-poses.json`, tomadas con el
  `evaluate` de U1 (commit `67b9154`) sobre `project-v1.json` en 0, 2, 5,5 y 9 s;
  el proyecto abierto hoy reproduce lo mismo a 1e-9, con sus planos como tramos y
  sus movimientos como barras.

Pruebas: `tests/animation-n1.test.ts` (21: pivote en otra pieza y en un punto,
también con un padre fuera del origen; `FADE` invertida y repetida en cinco
instantes, sus multiplicaciones y su partición; `PAN`; `MATERIAL_COLOR`;
`SUN_ARC` y su ángulo al polo; la curva frente a una bisección propia, también
con asas en los extremos, y su arrastre como una entrada de deshacer; los fundidos
de la pista, su tramo y sus píxeles; los 16 presets en cada fotograma; el asistente, los
planos y los materiales), `tests/animation-migration.test.ts` (2) y
`tests/video.test.ts` (12: los dos contenedores releídos por lectores aparte, un
vídeo de 2 s a 12 fps de 24 fotogramas, el escritor con un codificador falso, un
trabajo de la cola hasta el archivo, y fotogramas reales de libx264 y libvpx en
nuestros MP4 y WebM leídos por ffprobe donde la máquina tiene ffmpeg). Mutaciones:
**48**, todas muertas (en `evaluate` de los tipos nuevos y del pivote, en la curva,
en los dos *muxers* y el escritor, en la cola de vídeo, en el Doctor, en la
accesibilidad del cajón y en la marca del fundido); una sobrevivió
al principio (quitar la vuelta al padre del giro con pivote: el padre de la tapa está
en el origen) y se mató con una prueba sobre el cuerpo, que cuelga del modelo.
En el navegador, `tools/video-check.mjs` (Chromium con WebCodecs de verdad): los
códecs, un vídeo de 2 s a 12 fps por el escritor de la aplicación en VP9
(18 760 bytes) y en VP8 (6 798 bytes) leídos por ffprobe (24 fotogramas, 2 s,
320 × 180), el asistente en tres pasos, un fundido a negro, un asa arrastrada y
deshecha, el fundido en el visor, y un render de la aplicación en WebM VP9 de 48
fotogramas (2 s a 24 fps, 160 × 90) leído por ffprobe; capturas
`docs/ui/animation-n1-wizard.png` (la línea de tiempo con tres pistas y el
asistente en el paso 1), `animation-n1-cards.png`, `animation-n1-curve.png` y
`render-window-video.png`. El motor de Rust no se tocó. Compuertas, con `main`
mezclado (H1 y la galería) y `rt.wasm` compilado: `npm run qa` en verde (169
archivos y 2907 pruebas pasan, 4 archivos y 6 pruebas omitidas; al empezar pasaban
161 y 2836, y H1 trae las suyas) y `npm run engine:test` en verde (1098 pasan, 11
ignoradas), como antes.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
**Fable**, que decide si se cambia):
- ◆ **El orden del asistente.** El brief pide tipo → objetivo → parámetros; N6
  entregó el objetivo primero (*+ Animar Tapón…* lo trae puesto) y se mantiene: el
  paso 2 es la rejilla, con solo los tipos de ese objetivo y su grupo primero.
- **Una pista por objetivo con barras**: se queda el modelo de N6 (una fila por
  objetivo y, debajo, una por animación; plegado, las barras de todas en la fila
  del objetivo), que ya estaba aceptado.
- ◆ **Qué es un fundido**: la cantidad es la opacidad final y aparecer es el
  fundido invertido (el SPEC decía «de 0 a 1 o de 1 a 0»). En el motor es una
  cobertura estocástica (con poco muestreo se ve como un tramado) y un emisor baja
  su emisión, porque el motor no da cobertura a los emisores; en *Rápido*, una
  copia translúcida sin escritura de profundidad.
- ◆ **El arco solar**: polo fijo detrás del producto a 45° de altura, en el marco de
  los focos (`SUN_POLE_AZ`, `SUN_LATITUDE`); la latitud y dónde está el norte no
  son de esta fase.
- ◆ **El fundido a color**: centrado en el corte, medio en cada plano, curva suave,
  nunca más de la mitad de un plano; el de entrada solo en el primero, y no hay
  fundido de salida al final de la animación. Se mezcla en los píxeles después
  del motor: en los formatos lineales, hacia el color en luz lineal con la
  exposición (el blanco es 1, que con *Fílmica* o *AgX* no es el blanco de la
  imagen).
- ◆ **La calidad del vídeo**: UI.md decía *con calidad*; no hay mando, es
  automática (unos 0,1 bits por píxel, de 1 a 50 Mbit/s). Sin alfa ni sonido.
- **H.264** solo *Constrained Baseline* (sin fotogramas B, así el MP4 no necesita
  `ctts`); el Chromium de código abierto de aquí no lo codifica, así que el MP4 se
  probó en Node con fotogramas reales de libx264 y ffprobe, no con WebCodecs.
  WebM cae a VP8 donde no hay VP9; AV1 no se ofrece aunque Chromium lo codifique.
- **Los fps de la ventana** son 24, 25, 30 y 60: el vídeo de 12 fps del criterio
  sale por el escritor de la aplicación (la prueba con el codificador falso y el
  navegador con el de verdad); el camino entero de la aplicación se probó a 24 fps.
- **Un vídeo se guarda al final**: un trabajo detenido no deja nada; los plugins de
  trabajos no pasan por sus fotogramas y el historial guarda el primero como PNG
  (`ResultMeta.video` dice de qué vídeo).
- **El aviso de D1 «un archivo que un fallo pierde entero»** se quita: el encargo
  dice que `output` avise solo de un códec que no se codifica (era la ◆ de D1).
- **Pivote**: el eje es el propio del objetivo (Z o X); el eje libre no se
  construye. Si la pieza pivote se mueve, el pivote no la sigue (se toma en reposo).
- **Color de material**: el color base de los parámetros *Simple*; un material de
  nodos (M3a) no cambia de color, ni en el motor ni en *Rápido* (sí se funde).
- **Bajo su objetivo en el árbol**: solo piezas, grupos y modelo; las de cámara,
  focos, entorno y materiales se ven en la línea de tiempo.
- El *barrido rápido* de la biblioteca de movimientos (A6) sigue siendo una
  órbita; la variante con `PAN` queda pendiente.
- `ease()` de `light-math` trata `CUSTOM` como lineal: la curva de un clip vive en
  `clipCurve`, que es la que la usa.
- `tools/render-window-check.mjs` se para en su paso (g) (tras elegir *Copper* en la
  paleta, Ctrl+Mayús+Intro no arranca el render y espera hasta agotar el tiempo); pasa
  igual en una compilación de `main` sin N1 (`3096821`), así que no es de esta fase y
  no se toca aquí. Por eso `render-window-animation.png` (U5) no se ha regrabado y
  sigue enseñando el vídeo como *próximamente*; lo de ahora está en
  `render-window-video.png`.
  *Resuelto después, fuera de esta fase*: el fallo era de la herramienta, no de la
  interfaz. Cerraba el visor de resultados con Esc nada más empezar la descarga del
  JPEG, antes de que el trabajo terminase y el visor abriera; ese Esc llegaba a la
  escena y deseleccionaba el cuerpo (`Esc` deselecciona, UI §2.3), así que *Copper* pedía
  *Sustituir todos* dentro de la paleta, que seguía abierta (es modal) y se tragaba
  Ctrl+Mayús+Intro. Pasaba o no según el momento. La herramienta espera ahora al visor,
  comprueba la selección y que la paleta se cierre, y `render-window-animation.png` y las
  otras tres capturas de U5 se regrabaron.
- **La regla de la línea de tiempo** no es un `slider`: está dentro del árbol, que
  solo puede contener sus filas, y el cabezal ya tiene el teclado (Inicio, Fin,
  ← →) desde el árbol; se oculta a las ayudas técnicas. Si se quiere un control
  propio para el cabezal, va fuera del árbol (otra estructura del cajón).

## N2 · Cola, pases y lotes — **Sonnet**

**Qué.** Cola de render con progreso y cancelación sobre `render()` del
motor; pases alfa, profundidad, normales e id de pieza como salidas
opcionales del integrador (sección `RNDR` con máscara de pases; PNG 16
bits o EXR); lote cámaras × estudios con nombre de archivo por plantilla
(`{proyecto}_{camara}_{estudio}`); descarga en ZIP propio (sin
dependencia: el formato *store* de ZIP es trivial).

**Depende de.** E4.

**Criterio.** Tests de nombre de archivo y de cola (orden, cancelar el
segundo deja el tercero); un lote de 2 × 2 produce 4 imágenes.

## D1 · Doctor de motor — **Sonnet** — hecha

**Qué.** Los chequeos que dependen del motor: `rt.wasm` cargado y
número de workers (y aviso si el navegador solo da uno), SIMD disponible
en wasm, denoise, transformada de vista, cáusticas (fireflies: muestras
aisladas muy brillantes detectadas en la acumulación), formato de salida
de vídeo, tiempo estimado frente al presupuesto. *Arreglar todo* en un
clic.

**Depende de.** E4.

**Criterio.** `tests/doctor-engine.test.ts` con un motor falso que simula
cada estado; cada chequeo se dispara y se limpia.

**Hecho.** Los chequeos de motor viven en un módulo propio,
`src/core/doctor-engine.ts`, enchufado a `runDoctor` y a `fixDoctor` por su
rama por defecto: los diez de escena, sus claves y sus pruebas no se
tocaron. Lo que el motor y el sistema dicen no es proyecto, así que la página
se lo entrega al Doctor como `EngineFacts` (`setEngineFacts`, igual que el tope
de partículas de S4a) a través de `installDoctorFacts` (`src/ui/doctor-facts.ts`),
que lo construye del estado de la interfaz y del `status()` del visor, pide
`doctor/refresh` solo cuando cambia algo (volátil, sin entrada de deshacer) y lo
repite tras deshacer y rehacer; `main.ts` le da un pulso de un segundo para lo que
solo sabe el motor. Sin hechos, los siete chequeos de motor y los dos que no se
tocan (`lighttree`, `persist`) siguen en *no disponible* con la misma forma de
antes. El catálogo pasa a **19** entradas: `simd` detrás de `engine` y `budget`
detrás de `output` (nuevas), y los textos de `engine`, `denoise`, `color`,
`caustics` y `output`, que hablaban de Cycles, reescritos para este motor con
sus claves intactas. Detección, arreglo y prueba de cada uno:

- **`engine`**: la disponibilidad de `ui.engine` (`NO_WASM`, `OUTDATED`,
  `FAILED`, `NO_WORKERS`, cada una con su frase) y un *pool* de un solo worker
  con el motor de WebAssembly. Sin arreglo; si es *Hilos* quien lo limita
  (Automático daría más), el aviso trae el botón **Ajustes** que abre esa fila.
- **`simd`**: `EngineInfo.simd` frente a lo que el sistema soporta y al ajuste:
  sin simd128, *SIMD* en *Desactivado* (con botón a esa fila), falta
  `rt-simd.wasm`, o un motor de escritorio sin camino vectorial.
- **`denoise`**: en el visor y no en el render, a fuerza 0, o un `rt.wasm` sin
  `rt_denoise` (los *workers* lo dicen en su primer mensaje, `ready.denoise`; antes
  nadie fuera del worker lo sabía). Apagado en todas partes no avisa. Arreglo:
  *Los dos* / 100 %, por `render/set`.
- **`color`**: con *Estándar*, la fracción del encuadre a más de una parada sobre el
  blanco (2 lineal, con la exposición aplicada) leída del histograma por
  paradas de la acumulación; con *Fílmica* y *AgX* no hace falta imagen. Arreglo:
  *Fílmica*.
- **`caustics` (Fireflies)**: `render/frame-scan.ts` lee la acumulación que la
  página ya tiene (sin tocar el motor): un píxel es un *firefly* si su media
  pasa del blanco, es 4 veces la del mejor de sus ocho vecinos y, con la
  luminancia al cuadrado, una sola muestra aporta la mitad de su luz o más (el
  cociente `lum2 / (Σ luminancia)²` es una cota inferior exacta de la parte de la
  mayor muestra). Avisa desde 8 píxeles o 10⁻⁵ del encuadre; arreglo: cáusticas
  *Apagado* → *Automático* y recorte de indirecta en 10, o, si ya está, solo
  «más muestras». Lo hacen `status().scan` del *pool* y del lanzador, leído de nuevo
  cuando las muestras se doblan (de la 16 en adelante).
- **`output`**: vídeo con un códec que el sistema no codifica, o vídeo a secas
  (un archivo que un fallo pierde entero). Arreglo: secuencia de fotogramas.
- **`budget`**: con la velocidad que el motor midió (`ui.throughput`, nunca
  inventada), el tiempo de *Tiempo* no llega a un Borrador (64), o el de *Lo que
  llegue antes* a la mitad de las muestras. Arreglo: subir el tiempo al
  necesario más una cuarta parte de holgura (`BUDGET_HEADROOM`), a la decena de
  segundos: la prueba en el navegador mostró que la velocidad que mide el visor se
  mueve de una lectura a la siguiente y un presupuesto justo volvía a quedarse corto
  nada más arreglarlo.

Un escaneo es de **una imagen**: lleva el proyecto del que sale (`basis`) y
`sameImage` (que repite `touchesImage` de los dos motores, con una prueba que las
compara) dice cuándo deja de valer; el Doctor no usa una lectura de otra imagen
(`Midiendo…`). El *store* vuelve a pasar el Doctor cuando cambia lo que los
chequeos leen (`engineInputsChanged`). Los arreglos pasan por el *store* y son
una entrada de deshacer; *Arreglar todo* los junta en una, y lo que el proyecto
no puede cambiar es un aviso con su explicación y sin arreglo falso.
`tests/doctor-engine.test.ts` (72 pruebas) lleva un motor falso que escribe
donde escribe el real y usa el `installDoctorFacts` de verdad: cada uno de los
catorce fallos de la tabla se dispara y se limpia, más *Arreglar todo*, los
umbrales en sus fronteras, `doctorSentence` en los dos idiomas, y que deshacer
refresca; `tests/frame-scan.test.ts` (17) lee acumulaciones sintéticas, el
`status().scan` del *pool* con *workers* falsos y el del lanzador con su simulador;
`tests/frame-scan-engine.test.ts` (3), el `rt.wasm` de verdad. Cada chequeo
nuevo se probó **desactivando su detección** (y cada arreglo, y cada umbral):
cerca de cien mutaciones, todas muertas salvo tres equivalentes: no recortar la
fila superior ni la inferior de los vecinos (fuera del marco se lee `undefined` y
no gana a nadie) y el `full` del `status()` del *pool* (la caché, que pide 16
muestras, ya lo cubre). `tools/doctor-engine-check.mjs` lo recorre en Chromium con el `rt.wasm`
real (27 comprobaciones: el motor y el visor sanos, *SIMD* en *Desactivado* con
su botón a *Ajustes*, *denoise* solo en el visor y un presupuesto de 5 s con la
velocidad que el motor midió, *Arreglar todo* y un deshacer) y deja
`docs/ui/doctor-engine.png`. El motor de Rust no se tocó: ni `rt_features` ni
ningún *hash* fijado se mueve. Compuertas: `npm run qa` en verde (159 archivos y
2746 pruebas pasan, 4 archivos y 6 pruebas omitidas; al empezar pasaban 2635) y
`npm run engine:test` en verde (1098 pasan, 11 ignoradas). Con K1 en la
misma rama conviven los dos: `runDoctor` da los 19 de `DOCTOR_CHECKS` y, con el tipo
*Interior*, los siete de `INTERIOR_CHECKS` detrás; `fixDoctor` encamina cada clave a su
Doctor (`isInteriorCheck`) y *Arreglar todo* limpia las dos clases en una entrada de
deshacer (cuatro pruebas en `tests/doctor-engine.test.ts`, que también fija que las claves
de interior no son ni de escena ni de motor). Coste: la lectura de
la acumulación corre en el hilo principal cada vez que las muestras se doblan
(de 16 en adelante: cinco o seis veces por vista) y tarda, medida en Node con el
código caliente, 40 ms a 1280 × 720, 160 ms a 2560 × 1440 y 330 ms a 4K.

Un fallo que apareció al probarlo y se corrigió con su prueba
(`tests/store.test.ts`): una acción que un oyente del *store* envía mientras se le
avisa de un deshacer, un rehacer, un reinicio o el cierre de una transacción
esperaba al siguiente `dispatch` (`apply` se vaciaba solo en `dispatch`); el
Doctor necesita pedir `doctor/refresh` tras deshacer, y no llegaba.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es de criterio y se
deja anotado para quien decide, la regla 11):
- ◆ **`color` no tiene en este motor el chequeo de origen** («la transformada
  de la escena no coincide con la elegida en los ajustes»): hay una sola fuente
  (`image.viewTransform`) y la página convierte las sumas ella misma, así que no
  hay nada que discrepe. La propuesta es otra cosa que el motor sí sabe: con
  *Estándar* se recortan las altas luces. Pendiente: si eso es un fallo (un fondo
  blanco liso se quiere recortado), el umbral (**1 %** del encuadre, a más de
  **una parada** sobre el blanco: `CLIP_FRACTION`, `CLIP_OVER_WHITE`) y si el
  arreglo es *Fílmica* o *AgX*.
- ◆ **`caustics` / Fireflies cambia de sentido**: el de origen avisaba de
  cáusticas *encendidas* sin necesidad; aquí las cáusticas son un mapa de
  fotones que quita fireflies, y apagadas los dejan. Umbrales propuestos, todos en
  `render/frame-scan.ts` y `core/doctor-engine.ts`: brillo ≥ 1 (blanco), aislamiento
  ×4, parte de una muestra ≥ 0,5, 16 muestras como mínimo, 8 píxeles o 10⁻⁵ del
  encuadre, recorte de indirecta **10** (un recorte quita energía: es un sesgo, no un
  arreglo gratis). Se miraron datos reales (`tests/frame-scan-engine.test.ts`): dos
  escenas ordinarias a 16 muestras, 0 *fireflies*; espejos con luces de alfiler a 64,
  4 con una muestra de hasta ~76 veces el blanco; no se afinó con más escenas.
- **Lo que no se mide**: dos *fireflies* pegados se ven como vecino brillante uno al
  otro y no cuentan; con el *denoise* del visor del lanzador encendido, las sumas que
  llegan a la página son la imagen filtrada (`fireflies: null`, y el chequeo dice que
  no hay nada que contar; el *pool* lee siempre las sumas sin filtrar); en *Rápido*
  no hay acumulación.
- ◆ **`budget`: qué es «demasiado lento para el presupuesto»**. No hay presupuesto
  de tiempo si se termina por muestras o por ruido (no avisa); con *Tiempo*, el
  de un Borrador (64 muestras) es el mínimo para una imagen utilizable; con *Lo
  que llegue antes*, la mitad de las muestras pedidas (`BUDGET_REACH`). El arreglo
  sube el tiempo (con un 25 % de holgura) y no baja las muestras (la otra salida
  honesta); una animación se
  juzga por el presupuesto de cada fotograma, y su total no se compara con nada.
- ◆ **`output` dormido**: hasta N1 los ajustes fuerzan la secuencia de
  fotogramas, así que solo un proyecto de un futuro con vídeo lo dispara. Se decide
  si debe avisar también cuando el códec sí se codifica (hoy sí, por «un archivo
  que un fallo pierde»); el arreglo es siempre la secuencia, sin cambiar de
  códec.
- ◆ **`denoise`**: solo avisa del visor sin el render (no al revés: el visor en
  bruto es una decisión de cada día) y de fuerza 0; el arreglo es *Los dos* / 100 %.
- **`lighttree` y `persist`** siguen en la lista como *no disponibles* con su motivo
  (el árbol de luces es de K4; los datos persistentes son de Blender y no tienen
  equivalente): las claves son estables y no se quitan. Si se prefiere, `persist`
  puede retirarse del catálogo en una fase de limpieza.
- **Ajustes de la aplicación**: lo que limita *Hilos* y *SIMD* no es del proyecto
  ni se deshace; el Doctor lo señala con un botón que abre la fila y no lo
  cambia. Si se prefiere un arreglo que lo cambie, es una decisión (la regla 6 dice
  que toda mutación es deshacible).
- `sameImage` repite la lista de `touchesImage` del *pool* y la del lanzador (ya
  eran dos copias): `tests/doctor-engine.test.ts` las compara en dieciséis
  acciones. Difiere en el cabezal, a propósito (el Doctor no corre en cada fotograma).
- La burbuja de ayuda de *Arreglar* usa el texto del catálogo; los de motor lo
  dicen en general («Sin arreglo en el proyecto: …»), y el aviso de cada caso, la
  razón.

## U5 · Ventana de render y visor de resultados — **Opus** — hecha

**Qué.** `UI.md` §2.5, §2.7 y §2.8: la barra inferior pierde calidad,
resolución, presupuesto y formato, y queda con *Animación*, *Cola* (con
contador y progreso) y **Render…**; la **ventana de render** al estilo de
KeyShot con *Imagen · Animación*, *Salida* (nombre por plantilla con
fichas, carpeta al terminar con el acceso al sistema de archivos del
navegador donde exista y *Descargas* donde no, formato, transparente,
cámara una o todas, tamaño en píxeles y tamaño de impresión con **ppp**
enlazados y escritos en el archivo —`pHYs` en PNG, densidad JFIF en
JPEG—), *Calidad* (*Terminar por* muestras o tiempo, *lo que llegue
antes* en avanzado, estimación a partir de las muestras por segundo
medidas), *Animación* (rango, fps, vídeo o fotogramas, presupuesto por
fotograma, estimación total; la secuencia de fotogramas funciona ya, el
vídeo codificado llega con N1 y se marca *próximamente* hasta entonces),
la sección *Post-procesado IA* como hueco plegado (*próximamente* hasta
X3), y el pie con **+ Añadir a la cola** y **Render** (este último pone
el trabajo el primero y lo arranca); `RenderJob` completo en el *store*
con migración del estado de U1; cajón *Cola* con reordenar, editar,
duplicar, pausar y terminados; **visor de resultados** sobre el visor
con zoom, datos y el **componente de comparación con divisor
deslizable** genérico (dos imágenes cualesquiera), que X3 reutiliza;
historial de resultados en el almacenamiento del navegador (IndexedDB u
OPFS) con límite y borrado; atajos `Ctrl ⏎`, `Ctrl ⇧ ⏎`, `⏎`, `⇧ ⏎`.

**Depende de.** E4 (render siempre con el trazador).

**Criterio.** Tests: `px = tamaño × ppp` en los dos sentidos con
redondeo y candado; el PNG lleva `pHYs` con los ppp (lectura del
fichero en el test) y el JPEG su densidad; plantilla de nombre con todas
las fichas; *Render* y *+ Añadir a la cola* producen la cola esperada;
*Todas las cámaras* crea un trabajo por cámara; *Terminar por tiempo*
corta en el límite (±1 pasada); migración de un proyecto de U1; la
ventana no aparece en la captura del visor. Capturas de la ventana en
*Imagen* y en *Animación*, del cajón *Cola* con tres trabajos y del
visor de resultados con el divisor.

**Hecho.** La barra inferior queda con *Animación*, *Cola* (contador y
progreso), el último resultado y **Render…**; la ventana de render
(`ui/panels/render-window.ts`) con *Salida* (plantilla con fichas,
*Descargas* o carpeta elegida con el permiso recordado, PNG 8/16 bits,
JPEG con calidad, EXR lineal sin comprimir, transparente, cámara activa,
una o todas, píxeles ↔ impresión con candado y ppp), *Calidad* (*Terminar
por* muestras, tiempo o lo primero, estimación con las muestras por
segundo medidas, avanzado con rebotes, recorte y semilla), *Animación*
(rango, fps, fotogramas funcionando ya, vídeo *próximamente*), el hueco
plegado del post-procesado IA y el pie con **+ Añadir a la cola** y
**Render**. Los ppp van en `pHYs` (PNG) y en la densidad JFIF (JPEG).
*Terminar por tiempo* lo decide `render/schedule.ts` entre pasadas
midiendo el tiempo por muestra, siempre dentro de una pasada del límite.
`RenderJob` completo con migración pura del estado de U1 y
`PROJECT_SCHEMA = 2`. Cola con reordenar, editar, duplicar, pausar y
terminados; visor de resultados con zoom, datos y el componente genérico
`ui/components/split-compare.ts`; historial en IndexedDB (50 resultados o
500 MB) con memoria como respaldo. 621 tests; 31 mutaciones comprobadas;
8 comprobaciones en el navegador (`tools/render-window-check.mjs`), entre
ellas que la ventana nunca aparece en la imagen del visor. Capturas
`render-window-image.png`, `render-window-animation.png`,
`queue-drawer.png` y `results-split.png`.

No encajó con el plan: la cola pasa a ser **deshacible** (U1 la hizo no
deshacible; manda este brief); *Render* con la cola en marcha no
interrumpe el trabajo en curso, va el primero y empieza después; en
*Animación* hace falta una fila *Tamaño del fotograma* (solo píxeles) y
las secciones van apiladas; el historial guarda solo el primer fotograma
de una animación; *Pausar* reinicia el trabajo, porque un render no se
reanuda a medias; `{n}` es el número de render en imagen y el de
fotograma en animación; EXR también para secuencias, sin ppp; los ajustes
avanzados solo se aplican al render, no al visor Completo; *Abrir
carpeta* se oculta en el navegador. Observación para L3: con el estudio
de joyería, REMBRANDT y NEON_NOIR solo cambian un 3 % de los píxeles; se
revisa con las recetas sobre el motor propio.

## U6 · Ventana de Ajustes y gestor de modelos — **Opus** — hecha

**Qué.** Petición del usuario: unos Ajustes profesionales, todo lo
configurable separado por módulos y agrupado en una columna a la
izquierda. `UI.md` §2.9 entero: la ventana (960 × 680, buscador,
grupos *Aplicación* · *Render* · *Sistema*, cambios al momento, punto y
*Restablecer* por fila y por sección, enlaces directos y
`?settings=<sección>`), y sus secciones **General**, **Preferencias**,
**Accesibilidad**, **Atajos de teclado**, **Motor de renderizado** (con
*Medir rendimiento* de verdad), **Post-procesado IA**, **Almacenamiento**,
**Escritorio** (solo en la aplicación de escritorio) y **Acerca de** (con
las licencias de terceros completas). Los ajustes son un objeto tipado
con versión, valores de fábrica y migración en `src/core/settings.ts`
(puro), guardado por `src/ui/prefs.ts`; las preferencias sueltas de hoy
(tema, idioma, anchos, modo del visor) migran a él.

El **gestor de modelos** de `AI-POST.md` §5 (absorbe X5): la lista de
`src/data/ai-models.json` (de X1 parte A) y los importados; descargas
con progreso, pausa, reanudación tras cerrar (peticiones `Range`), y
`sha256` por fichero; almacenamiento en OPFS en la web y en la carpeta
de datos a través del lanzador en escritorio (P2), detrás de una sola
interfaz `ModelStore`; *Usar*, *Eliminar*, *Importar modelo…* con el
manifiesto `model.repackshot.json` validado y rechazo de *pickle*;
licencia mostrada y aceptada antes de la primera descarga; la
**configuración del modelo activo**; la **detección del equipo** (límites
de WebGPU en la web; `/api/hardware` del lanzador en escritorio) y la
**regla de recomendación** evaluada sobre la tabla del JSON. Si el
instalador dejó una elección, sus descargas arrancan en el primer
arranque. En las versiones portables de escritorio el selector aparece
una vez en el primer arranque; en la web, la primera vez que se activa el
post-procesado (`AI-POST.md` §2.2) y siempre en *Ajustes*, porque hoy no
hay modelo para navegador. Mientras no exista X3 el post-procesado no
corre: la sección lo dice en una línea y lo demás funciona.

**Depende de.** U5 (la ventana de render enlaza con *Gestionar
modelos…*), X1 parte A (el JSON con ficheros y `sha256`). La parte de
escritorio del almacenamiento se prueba con el lanzador de P2.

**Criterio.** Tests: migración de las preferencias sueltas; cada ajuste
tiene valor de fábrica y *Restablecer* lo devuelve; el buscador encuentra
un ajuste por una palabra clave en `es` y en `en`; la regla de
recomendación da la fila de `AI-POST.md` §2.4 en los bordes de cada tramo
(fichero de casos `tests/fixtures/ai-recommend-cases.json`, el mismo que
usa el test en Rust de P2); sin detección no recomienda; un manifiesto
inválido se rechaza con el motivo; un `.ckpt` se rechaza; un modelo no
comercial no puede ser el de por defecto; borrar el activo vuelve a la
recomendación; una descarga cortada se reanuda desde el último byte
escrito (servidor de prueba con `Range`) y un `sha256` erróneo deja el
fichero *Dañado*; contraste alto y tamaño de interfaz cambian los
*tokens* y siguen acromáticos. Capturas en inglés de *General*,
*Accesibilidad*, *Motor de renderizado* y *Post-procesado IA ▸ Modelos*
con una descarga en curso.

**Hecho.** `src/core/settings.ts`: unos 57 ajustes tipados con versión,
valores de fábrica, validación, migración de las preferencias sueltas y
una tabla de metadatos (`SETTING_ROWS`) de la que salen la ventana, el
buscador en los dos idiomas, los puntos de *cambiado* y *Restablecer*. La
ventana (`ui/panels/settings-*.ts`) con los grupos *Aplicación*,
*Render* y *Sistema*, enlaces directos y `?settings=`; cada sección
conectada de verdad (navegación y botones del ratón, resolución durante
gestos, tamaño de interfaz y de texto, contraste alto, reducir
movimiento, anuncios para lectores de pantalla, motor *Automático ·
Nativo · WebAssembly*, hilos y SIMD, límite del visor, *Medir
rendimiento* con un render real de 10 s, límites del historial, carpeta
de datos, licencias de terceros completas copiadas al construir).
*Último proyecto* funciona: el encabezado pregunta al arrancar si abrir
el último archivo. Gestor de modelos con una interfaz `ModelStore` y tres
implementaciones (OPFS en un worker con la misma disposición por
`sha256` que el lanzador, el lanzador y memoria), descargas por trozos de
4 MiB con `Range`, reanudación tras recargar, SHA-256 propio en
streaming (fichero *Dañado* si no cuadra), dos ficheros a la vez, lo
compartido una sola vez, licencia aceptada antes de descargar, importación
con manifiesto y rechazo de *pickle*, la elección del instalador al
arrancar y el selector una vez en los portables. 939 tests; comprobaciones
en navegador web (`tools/settings-check.mjs`) y de escritorio con el
lanzador real (`tools/settings-desktop-check.mjs`). Capturas
`settings-general.png`, `settings-accessibility.png`,
`settings-engine.png`, `settings-ai-models.png` y `settings-desktop.png`.

No encajó con el plan: *Próximamente* la copia automática, las letras de
acceso, cambiar atajos, *Buscar actualizaciones* y la tubería de IA; las
descargas del catálogo por el lanzador no se probaron con ficheros de
varios GB (la importación cubre el almacén de punta a punta); el test de
límites de U2 tenía un falso positivo y el test acromático leía cadenas
vacías en vez del CSS (los dos corregidos, con su caso); *Al arrancar*
vale *Proyecto vacío* por defecto, como hasta ahora, con el modo
estándar ya montado. Encontró un fallo de P2: un proyecto vacío nunca se
renderiza en nativo (el lanzador pide mallas que no hay).

## N3 · Paseo de cámara — **Sonnet**

**Qué.** El tipo de animación `WALK` de `SPEC.md` §3.7: herramienta
*Trazar paseo* en el visor (clic en el suelo por punto, `⏎` termina,
puntos arrastrables, la curva dibujada en tinta), *Paseo alrededor de la
selección* en un clic, Catmull–Rom centrípeta recorrida a velocidad
constante por longitud de arco con arranque y parada suaves, altura de
ojos, mirada hacia delante / hacia un objetivo / por puntos con giro
suavizado, y **Simular pasos** (cadencia, balanceo vertical y lateral,
inclinación, sincronizados con la distancia y apagados al pararse). Se
edita en el inspector de animación y aparece como barra en la pista de
cámara. *Recorrido de la sala* se activa cuando exista K2.

**Depende de.** N1.

**Criterio.** Tests de `evaluate`: la velocidad es constante ±1 % en
toda la curva salvo arranque y parada; la altura de la cámara es la de
ojos ±0 sin pasos y oscila con la amplitud y la cadencia pedidas con
pasos; con *hacia un objetivo* el objetivo queda en el centro del
encuadre ±0,5°; parar a mitad de curva apaga el balanceo en menos de un
paso; el mismo `t` da la misma cámara siempre. Un vídeo de 4 s del
paseo alrededor de la botella, con y sin pasos.

## X1 · Confirmar el modelo de IA — **Fable**, con Sonnet preparando

**Parte A, adelantada (la necesita U6) — hecha.** Sonnet preparó y el
líder confirmó los datos (2026-10-13): las siete claves con sus ficheros
fijados a *commit*, tamaños y `sha256` comprobados por dos fuentes, y las
licencias citadas en `docs/ai-licences.md`. Decisiones del líder:
`ZIMAGE_WEB` queda **no disponible** (la exportación ONNX publicada no
trae codificador del VAE; lo exporta X3); codificador de texto oficial
Qwen3-4B, Qwen2.5-VL de ggml-org y klein Q4_K_M de Unsloth, los tres a
probar en la parte B; almacenamiento por `sha256` para no descargar dos
veces lo compartido. No encajó con la tabla: SD 1.5 pesa 3,6 GB y no
3,1 (faltaban codificador y VAE) y Qwen-Edit 19 GB (faltaba el proyector
de visión); la "LoRA de iluminación" no tiene fichero elegido y sale de
la descripción. El JSON entra en el repositorio con P2.

Lo que se pidió: Sonnet prepara y Fable confirma `src/data/ai-models.json`: para cada clave de `AI-POST.md` §2.4,
el repositorio de origen, cada fichero con su URL de descarga directa,
tamaño exacto y `sha256`, la licencia con su texto citado y su URL, y la
regla de recomendación como tabla de datos. Sin medidas todavía: los
umbrales son los de la tabla, marcados *provisionales*.

**Parte B, tras X3c.** `AI-POST.md` §2: releer y citar al pie de la letra las licencias
de Z-Image-Turbo, su codificador, su VAE y su ControlNet, y de FLUX.2
klein 4B, y la de stable-diffusion.cpp y ggml; Sonnet prepara una
**herramienta** que genera la hoja comparativa (8 renders del motor
—producto e interior—, 3 intervenciones, los dos modelos, con las
métricas de la guarda de §3.2, el tiempo y el pico de memoria, en Vulkan
y en CPU) y que el usuario ejecuta **en su equipo** (aquí no hay GPU); con
esa hoja **Fable elige** el modelo y fija las tolerancias iniciales
(ΔE₀₀, bordes, nitidez) y los umbrales de la regla de §2.4. Los `sha256`
de la web (q4f16) los fija X3d.

**Depende de.** X3c (la tubería tiene que existir para medir).

## X2 · Pases del motor para la IA — **Opus** — hecha

**Qué.** Contrato en `AI-POST.md` §7.4 y `src/core/passes.ts`. En
`rt-core`: pases de albedo (primer rebote no especular), normal,
profundidad, id de pieza, id de material y mapa de desenfoque (círculo de
confusión de la lente fina), con máscara de pases en `RNDR`; exportación
en `rt-wasm`, acumulación en el pool de E4 y lectura en TypeScript; en el
lanzador, `passes=…` en `/api/render` para los trabajos finales, que los
guarda por id para la tubería, y `GET /api/render/<id>/passes`. Coincide
con la parte de pases de N2 y la adelanta.

**Depende de.** E4, y **E5 fusionada** (los dos tocan el integrador).

**Criterio.** Tests: el id de pieza de cada píxel coincide con el `pick`
del centro del píxel; el albedo de un material difuso es su color; el
mapa de desenfoque es cero en el plano de enfoque y crece con la
distancia según la fórmula de lente fina (±1 %); pedir pases no cambia
ni un píxel de la imagen; determinismo y paridad nativo/wasm intactos.

**Hecho** (2026-10-13). `rt_core::passes` con el contrato de §7.4:
`RNDR.passes` (40 B; los RSB anteriores no piden ninguno, los bits
desconocidos se conservan), `render_tile_exact` (normal, profundidad,
ids y círculo de confusión de **un rayo por el centro del píxel y de la
lente**, `render::centre_ray`, una vez por baldosa) y `render_tile_albedo`
(el rayo de cámara de cada muestra de la imagen, sumado en `f32` en orden
de muestra y dividido como `Film::resolve`), sobre `integrator::first_hit`
(lo más cercano entre geometría y suelo; un panel de luz visible a cámara
cruzado antes es fondo) y `PassFilm`/`Passes`. El suelo del estudio
(visible o atrapasombras) es `FLOOR_ID` en los dos ids; el fondo, 0 y
+∞. Los pases tienen rayos propios: la imagen conserva sus *hash*
(`0x223515c3`, `0xbf8abd5b`, `0x2fcb098a`) con todos los pases
intercalados. *Hash* fijados de los seis planos del ejemplo (albedo
`0x43571da9`, normal `0x0aabfd24`, profundidad `0x25f8dd11`, ids
`0xccd3d6c7` los dos, `coc` `0xdf87494c`) y del ejemplo de E5 (`0xace93461`,
`0x714253d6`, `0x9b1b61c8`, `0x2c21fa55` ×2, `0x73bf76f1`), iguales en
escalar, SSE2 y AVX2, en las dos pasadas de WASI, en el `rt.wasm` real
(escalar y `simd128`, `tools/wasm-parity.mjs --expect-passes`, en CI),
por la API del lanzador con 1 y 4 hilos y por el código de la página
(`tests/passes-engine.test.ts`). `rt-wasm`: `rt_render_tile_passes` y
`rt_render_tile_albedo`; el pool los pide con la máscara del trabajo y los
junta con `PassAccumulator` (`src/render/pass-planes.ts`), y
`renderPixels` devuelve `RenderPasses`. Lanzador: `passes=` en los
finales (400 si nombra un pase que no existe o en el visor), almacén de
los **cuatro últimos** renders con pases por id (imagen lineal y pases;
los de más de 64 MiB en `<datos>/cache/ai/<id>.rpx` y `.rpp`, que se
limpia al arrancar; `DELETE` del trabajo no los borra), servido como
`RPP1` en `GET /api/render/<id>/passes` (404 si no existe o se desalojó,
409 mientras se renderiza), `Engine::kept` para X3c; `native.ts` lo pide
y lo lee con `parsePasses` y devuelve también `renderId`. El círculo de
confusión es el de `lens-coc.ts` (los dos lados leen
`tests/fixtures/lens-coc.json`) y coincide dentro de 1 % (en la práctica,
1e-5) con el desenfoque medido de la lente de `Camera::generate_ray`.
Los pases de three.js de X4 coinciden con los del motor en ids y
profundidad en su escena de prueba (comparados en
`tests/ai-passes-browser.test.ts` con el `rt.wasm` real), salvo el
suelo. Tests: 22 nuevos en Rust (15 de `rt-core`, 1 de `rt-wasm` y 6 del
lanzador: almacén, formato `RPP1`, trabajos y API) y 12 de vitest; 19
mutaciones comprobadas (cada test falla si se rompe lo que guarda).

**No encajó con el plan.** (1) **El suelo en los pases de three.js**: el
contrato corregido (suelo = `FLOOR_ID`) lo cumple el motor; la vista
previa de X4 todavía lo dibuja como fondo (0, +∞). No se toca aquí:
§7.4 se lo da a X3c, y el test del navegador acepta hoy 0 en los píxeles
del suelo y lo anota. (2) Decisiones donde el contrato no decía nada,
anotadas en §7.4: el albedo de un emisor es su `base_color`; el del
suelo, `FLOR.color` también en el atrapasombras (que no lo usa para
pintar); con profundidad de campo el albedo sigue cada muestra por la
lente y se emborrona como la imagen (la comparación de X2 con la
referencia de X4 solo exige el color exacto donde `coc` < 0,25 px); un
recorte o un vidrio paran el rayo de los pases, como `pick`; una
instancia con índice de material fuera de rango lleva `materialId` 0.
(3) En el ejemplo y en el de E5 la instancia *i* lleva el material *i*, así
que sus planos de ids tienen el mismo *hash*: el orden de los dos planos
lo vigilan el fichero `tests/fixtures/passes-3x2.rpp` (lo escribe el
lanzador y lo lee la página) y la escena de X4, donde no coinciden.
(4) La máscara viaja por dos sitios en el lanzador (`RNDR.passes` y
`passes=`): un final renderiza la unión. (5) Los rayos de los pases
cuentan en los rayos del trabajo (`rays` de la trama): uno por píxel para
los exactos y uno por muestra para el albedo. (6) `engine/README.md` está
entero en inglés; su sección de pases también, para no partir el
fichero. (7) **Con P3a** (fusionada después): los pases se renderizan con
los hilos o los workers que tenga el render, también cuando el visor
sigue vivo en su parte (`share=`, los carriles del pool), y salen los
mismos bits (lo prueban el lanzador y el pool); un final cancelado, huérfano
(su página dejó de preguntar) o fallido no guarda nada; `native.ts` lee los
pases con la señal de cancelación del render y antes de soltar el
trabajo (`DELETE`, `pagehide`), y `GET /api/render/state` da la máscara de
cada trabajo.

## X3 · Tubería de post-procesado y guarda — partida en X3a–X3d

Decisión del líder (`AI-POST.md` §7): en escritorio todo nativo (la
página solo envía ajustes y recibe resultados), la guarda en un *crate*
propio sin dependencias, y la web detrás.

### X3a · `rt-post`: la guarda y los píxeles — **Opus** — hecha

**Qué.** `AI-POST.md` §3.2 y §7.2: `engine/crates/rt-post` (solo `std`,
`f32`, determinista, sin `unsafe`) con condicionamiento (bordes de los
cambios de id y normal, profundidad normalizada), plan de mosaicos con
solape y fusión, relleno a múltiplo de 16 y recorte, la **guarda**
completa (transferencia de sombreado, separación de frecuencias, regiones
por id con ΔE₀₀, nitidez frente al mapa de desenfoque), las
comprobaciones y la máquina de pasos con retroceso; `rt-post-wasm` →
`public/engine/post.wasm`; en `src/ai/`, la envoltura TypeScript de ese
wasm y el *prompt* desde materiales y luces (`prompt.ts`). Informe con la
forma de `GuardReport` (`src/core/ai.ts`).

**Depende de.** Nada (los pases se sintetizan en los tests).

**Criterio.** La guarda, probada con un "modelo" sintético que hace
cosas prohibidas (mueve una arista, cambia el color de un material,
emborrona lo enfocado, enfoca lo desenfocado, cambia el tamaño, toca
fuera de las regiones): cada una se detecta y se corrige o se rechaza;
con intervención 0 la salida es idéntica bit a bit a la entrada sin
llamar al modelo; la resolución de salida es siempre la del trabajo;
mismo resultado en nativo y en wasm, bit a bit; puertas del motor
(`fmt`, `clippy`, sin dependencias en `Cargo.lock`).

**Hecho.** `engine/crates/rt-post` (`#![forbid(unsafe_code)]`, solo
`std` y `rt-core` para `fmath` y las curvas de tono) con la máquina de
pasos `plan(&job) → Plan` (mosaicos de ≤ 1024² con solape ≥ 128 px y
mismo tamaño, relleno a múltiplo de 16 repitiendo el borde; sin mosaicos
si Intervención es 0 o todos los aspectos están a 0, y entonces la salida
es la entrada bit a bit sin llamar al modelo), `tile_input` (la imagen del
motor con su exposición y su curva, sRGB de 8 bits), `conditioning`
(bordes 255 a los dos lados de cada cambio de `partId`, `materialId` o
normal de más de 30°; profundidad normalizada sobre toda la imagen, cerca
255, la superficie más lejana 16, fondo 0) y `accept(&plan, &original,
&passes, &salidas, intento) → Accepted{image, report} | Retry{strength,
attempt, reason} | Rejected{report}`; `run` es el conductor para un
modelo dado como función. La guarda multiplica siempre la imagen del
motor por una ganancia: (a) transferencia `ln blur(modelo) − ln
blur(motor)` (gaussiana normalizada sobre las regiones abiertas,
σ = 16·√MP entre 8 y 32, calculada en una rejilla hasta 8 veces más
gruesa y devuelta con B-spline cúbica), llevada a luz de escena por la
pendiente local de la curva de tono y partida en cambio común (Fuerza
del estilo), luminancia local (Luz, ganancia gris) y color local
(Rebotes), cada parte por su control y topada por control × fuerza del
intento; (b) banda media del modelo (σ 3 px a σ baja) solo en materiales
con desgaste, enfocados (cdc ≤ 1 px, nada a ≥ 3 px) y a más de 8 px de
una arista; (c) fondo y materiales bloqueados intactos y el cambio de
color de cada material rebajado hasta que su ΔE₀₀ medio y p95 queden en
el 80 % de la tolerancia. Comprobaciones independientes de cómo se hizo
el resultado: tamaño, píxeles cambiados fuera de lo permitido (bit a
bit), desplazamiento de aristas (pico del gradiente con refinamiento
parabólico, en el canal de mayor salto), SSIM de la banda alta, nitidez
por bloque de 32² frente al mapa de desenfoque y ΔE₀₀ por material
(CIEDE2000 de Sharma, Wu y Dalal 2005, probado con sus 34 pares).
Tolerancias **provisionales** en un solo `struct` (`Tolerances`, claves
estables, se pueden pasar en el trabajo para calibrar): ΔE medio ≤ 2,
p95 ≤ 3, aristas ≤ 1,5 px, SSIM alta ≥ 0,98, enfoque ≤ 15 %, topes de
Luz 0,3, Rebotes 0,15, Estilo 0,2 y Desgaste 0,15 (logaritmo natural, a
control e intervención 100). Informe JSON escrito a mano con la forma
exacta de `GuardReport`. `rt-post-wasm` → `public/engine/post.wasm`
(189 KB, sin importaciones) desde `npm run engine:build`; `src/ai/post-wasm.ts`
(`PostGuard`, `PostSession`, `runGuarded`, `encodeJob`; worker y Node,
comprueba los tamaños antes de pasar punteros) y `src/ai/prompt.ts`
(`buildPrompt`, negativo fijo, `guardMaterials`); `AiGuardMaterial`
añadido a `src/core/ai.ts`. 50 tests de Rust (47 de `rt-post`, 3 del ABI)
y 16 de vitest; el "modelo" sintético mueve aristas, cambia el color de
un material, emborrona lo enfocado, enfoca lo desenfocado, toca el fondo,
mete desgaste en todas partes y devuelve otro tamaño, y cada test falla
si se apaga el paso que lo cubre (comprobado apagándolos uno a uno en el
código). Paridad: `tests/fixtures/ai-guard.json` (cinco escenarios:
intacto, prohibido, fuerte, limitado, rechazado) lo fija el test nativo y
el `post.wasm` real lo reproduce bit a bit (imagen, entradas del modelo y
JSON), también en CI. Rendimiento nativo de un hilo: ≈ 2,3 s por intento
a 1 MP y 7 s a 4 MP.

Lo que no encajaba con el plan: (1) "Transferencia en dominio
logarítmico" se hizo como logaritmo de la razón de los desenfoques (de
luz, no de logaritmos: desenfocar logaritmos convierte un texto
emborronado en un cambio de luz, por la desigualdad de Jensen), como dice
§3.2. (2) La guarda trabaja en luz de escena: el cambio que el modelo
hace en pantalla se pasa a escena por la pendiente de la curva, y la Luz
es una ganancia gris de escena (como más luz en el motor); en el hombro
de la curva eso desatura un poco, así que el ΔE₀₀ por material se mide
contra la imagen del motor **con el cambio permitido** (estilo y
luminancia dentro de los topes) vista por la misma curva: mide el cambio
del color del material, no el de la luz. **Fable debe confirmar ese
criterio** en X1b. (3) Nitidez, detalle y aristas se miden en luz de
escena (la curva comprime el contraste de las altas luces como lo haría
un render más claro, y eso no es desenfoque), y detalle y enfoque miran
el interior de las regiones (a 4 px de una arista, el salto de una
silueta cambia al reiluminar un solo lado; las aristas tienen su propia
comprobación). El SSIM de la banda alta excluye además los píxeles donde
Desgaste puede añadir detalle. (4) Comprobación de aristas por canal
(máximo de los tres): con solo luminancia, reiluminar una pieza hasta la
luminancia del fondo "borraba" una arista que sigue viéndose por el
color. (5) Un mosaico de otro tamaño rechaza a la primera (una fuerza
menor no lo arreglaría) y entrega la imagen del motor. (6) Reglas
provisionales que deja anotadas para X1b: admite desgaste toda familia
con tipos de desgaste en el catálogo (todas menos la emisiva; quizá el
vidrio no debería), los emisores quedan bloqueados, profundidad de
superficie más lejana 16. (7) `AiPostRequest` no lleva la tabla de
materiales de la guarda ni el orden de materiales del RSB: X3c tendrá
que añadir `materials?: AiGuardMaterial[]` (o derivarla en el lanzador)
y `io/rsb.ts` exportar el orden (`guardMaterials(state, orden)` ya lo
espera); el código de la curva de tono (`tonemapFor`) también vive en
`io/`, así que el trabajo lo recibe como número. (8) La razón de un
LIMITED dice cuánto se rebajó, no por qué falló el primer intento; el
motivo de cada reintento sale en `Retry.reason` para el registro. (9)
Las alineaciones: el ABI de `post.wasm` recibe bytes *little-endian*, no
`f32` alineados, para no exigir alineación de punteros.

### X3b · stable-diffusion.cpp en escritorio — **Opus** — hecha

**Qué.** `AI-POST.md` §7.1: `src/data/ai-runtimes.json` con las
compilaciones oficiales fijadas (Vulkan y CPU, Windows y Linux x86_64:
URL, tamaño, `sha256`, licencia citada, versión, `supports` comprobado),
la regla de elección (Vulkan con GPU, CPU sin ella) evaluada igual por la
interfaz y el lanzador, descarga e instalación desde *Ajustes ▸
Post-procesado IA* (fila *Motor de ejecución*, con progreso, reanudación
y `sha256`, a `<datos>/ai/runtimes/<sha256>/`), el proceso auxiliar en
`rt-app` (arranque, argumentos por clave de modelo, progreso,
cancelación, tiempo límite, cierre con la aplicación, sin ventana de
consola en Windows) y la API `/api/ai/runtime` (estado como
`AiRuntimeStatus`) y `/api/ai/run` (una inferencia *img2img* sin guarda:
imagen, control, *prompt*, fuerza, semilla).

**Depende de.** P2.

**Criterio.** Tests con un proceso auxiliar **falso** (un binario de
prueba que habla el mismo protocolo): argumentos exactos por clave,
progreso, cancelación, tiempo límite, proceso colgado, salida de tamaño
distinto rechazada; un `sha256` que no coincide no se instala. Con la
compilación real de Linux CPU, `--help`/versión se leen y la fila de
*Ajustes* lo muestra. Sin descargar pesos de varios GB en este entorno: la
primera imagen real se hace en el equipo del usuario.

**Hecho.** `src/data/ai-runtimes.json` fija la *release* oficial
**`master-959-d637cfb`** de stable-diffusion.cpp (*commit* `d637cfb9…`,
2026-10-12; ggml `d25b121c…`): `SDCPP_WIN_VULKAN` (30 139 117 B),
`SDCPP_WIN_CPU` (17 558 769 B), `SDCPP_LINUX_VULKAN` (37 009 067 B) y
`SDCPP_LINUX_CPU` (26 143 940 B), cada zip descargado una vez para medirlo
y calcular su `sha256`; licencias MIT citadas en `docs/ai-licences.md` §7.
`supports`: las seis claves de escritorio según la documentación del *tag*
y los argumentos que construimos; `verified: []`. En el mismo JSON, como
datos que X1 puede corregir sin tocar código: la **regla de elección**
(filas `choice`, evaluadas igual por `src/core/ai-runtimes.ts` y
`rt-app/src/ai/catalogue.rs`, las dos contra
`tests/fixtures/ai-runtime-cases.json`) y los **perfiles por familia**
(argumentos de carga con `@rol`, pasos, cfg, muestreador, *flow shift*,
imagen como `init` o `init+ref`, ControlNets). En `rt-app/src/ai/`, solo
`std`: *inflate* (RFC 1951) y zip (APPNOTE, Zip64) propios, lector PNG
completo (todos los tipos, filtros, Adam7), base64; el almacén de motores
(`<datos>/ai/runtimes/<sha256>/`, `sha256` antes de instalar, descompresión
segura, `--version` y `--list-devices`); el **modo servidor** (`sd-server`,
API nativa `/sdcpp/v1/img_gen`, el modelo queda cargado) en una dirección
de bucle local aleatoria, con progreso leído de la salida estándar,
cancelación, tiempo límite, detección de cuelgue, caída, rechazo de
tamaño distinto, liberación por inactividad y al cerrar, y limpieza del
que dejara un arranque anterior; la API `/api/ai/runtime`,
`/api/ai/runtimes/<clave>/…` y `/api/ai/run`. Interfaz: `src/io/ai-runtime.ts`
y la fila *Motor de ejecución* de *Ajustes* con *Ejecutar con*
(`ai.backend`). Pruebas con `rt-fake-sd`, un binario de prueba que habla
el mismo protocolo, y con el `curl` real contra un servidor local. **De
verdad**, aquí: los cuatro zips descomprimidos por nuestro lector salen
idénticos fichero a fichero a los de `zipfile` de Python; la compilación
real de Linux CPU se instala por el lanzador y responde `--version`
(*stable-diffusion.cpp version unknown, commit d637cfb*), `--list-devices`
y `--help`, y la fila lo muestra; la descarga real desde GitHub con pausa a
4,7 MB y reanudación tarda 4,3 s; y un *img2img* real con `SD15_LIGHT` en
CPU (512², 8 pasos × fuerza 0,5 = 5 pasos de muestreo, pesos fijados
comprobados por `sha256` y borrados después) dio una imagen correcta en
**1307 s** de punta a punta (la máquina compartida con otros agentes, con
carga media de 10 a 15 en 4 vCPU: 1 s en arrancar el servidor, 3,5 min
leyendo pesos en el primer uso, 6 min hasta el primer paso (codificar la
imagen), de 2,5 a 3 min por paso y 3,5 min en decodificar; no es una
medida de rendimiento, que es de X1 parte B).

**No encajó con el plan.** (1) La descarga no puede hacerla la página
como la de los modelos: las descargas de *releases* de GitHub no mandan
cabeceras CORS. La hace el lanzador con el `curl` del sistema (en Windows
desde 10 1803), con el mismo progreso, pausa, reanudación y `sha256`; sin
`curl`, *Instalar desde un archivo…*. (2) No hay compilación «AVX2»
oficial: la de CPU lleva todas las variantes x86-64 de ggml y elige en
tiempo de ejecución. (3) Las de Windows necesitan el entorno de Visual C++
2015–2022 (no lo traen): si falta, la fila dice qué DLL; el instalador
(P2) debería instalarlo. Las de Linux necesitan glibc 2.38 (Ubuntu 24.04
o posterior). (4) `sd-server` refleja cualquier `Origin` y numera sus
trabajos: por eso la dirección aleatoria `127.a.b.c`. (5) Carga los pesos
en el primer uso: el primer trabajo enseña *Cargando*. (6) Las de edición
(klein, Qwen-Edit) van como *img2img* más imagen de referencia
(`init+ref`): construcción nuestra, sin probar. (7) `ai.gpu` (qué GPU) no
se pasa: no hay correspondencia fiable con los índices de Vulkan; elige
stable-diffusion.cpp. (8) Los límites (carga 30 min, imagen 60 min,
silencio 10 min, inactividad 5 min) son de partida, para X1. (9) El
catálogo de compilaciones es siempre el incluido; las pruebas ponen el
suyo con `server::Options` al construir el servidor, campo que la
aplicación no rellena nunca. (10) *Acerca de* no lista aún
stable-diffusion.cpp y ggml: sus textos van en la carpeta del motor y en
`docs/ai-licences.md`.

**Corrección tras fusionar (CI en *release*).** La primera versión leía
`<datos>/ai/runtimes-override.json` solo en depuración, y las pruebas
entraban por ahí. El trabajo del motor en CI también corre
`cargo test --workspace --release`, y allí 9 de las 11 pruebas de
`tests/ai.rs` fallaban: las pruebas eran más permisivas que el binario
de verdad. Ahora el catálogo y el descargador de prueba entran por
`server::Options { ai_runtimes }` (`Server::start_with`). `Ai::new` ya no
lee nada de la carpeta de datos en ninguna compilación, y lo comprueba
`a_catalogue_in_the_data_folder_is_never_read`, que falla si vuelve la
lectura. Había un segundo supuesto de depuración: la prueba de pausa y
reanudación esperaba más de 1 MB descargado, y en *release* el falso
ocupa menos de 600 kB. El archivo lleva ahora 8 MiB de relleno y la
pausa se pide a 1/8 del total. Se pasan las dos: `cargo test --workspace`
y `cargo test --workspace --release`.

**Segunda corrección (CI, el servidor huérfano).** En el ejecutor de
GitHub, `a_server_left_by_a_previous_launch_is_stopped_at_start` fallaba
una de cada dos veces con «the orphan still runs». La causa estaba en la
prueba. Arrancaba el servidor falso un instante antes de la limpieza.
`posix_spawn` es un *vfork*, y Linux deja seguir al padre antes de que
termine el `execve` del hijo, cuando el hijo aún usa la memoria del
padre. En ese momento `/proc/<pid>/exe` todavía nombra el ejecutable de
la prueba, así que la limpieza acertaba al no matarlo. Se reprodujo en
local reteniendo el `exec_update_lock` del hijo (`/proc/<pid>/syscall`):
el `exe` leído era el binario de la prueba. Ahora la prueba espera, por
condición y con un plazo de 60 s, a que el falso haya creado `args.log`
(eso lo hace su propio código), y lo mata al terminar aunque falle. Con
el bloqueo retenido pasa 20 de 20 veces; la forma anterior fallaba 2 de
20. Al revisar cómo se reconoce el proceso apareció un huérfano real:
la limpieza comparaba la ruta tal cual estaba escrita, y si la carpeta de
datos está detrás de un enlace simbólico, el núcleo da la ruta con el
enlace resuelto. Un servidor dejado ahí no se paraba nunca. Ahora se
compara el archivo (dispositivo e inodo, `proc::runs_server`), o la ruta
con los enlaces resueltos cuando el archivo ya no existe. Lo comprueban
`a_server_left_in_a_data_folder_behind_a_link_is_stopped_too` y la
prueba unitaria `a_server_is_recognised_through_a_link`; las dos fallan
con la comparación anterior.

### X3c · La tubería completa de escritorio — **Opus** — hecha

**Qué.** `AI-POST.md` §7.3: `/api/ai/post` en el lanzador (pases
guardados del render → `rt-post` → stable-diffusion.cpp por mosaico →
`rt-post` → reintentos), progreso y cancelación; el `AiPostService` de
escritorio en `src/io/`; integración en la cola (el trabajo guarda las
dos imágenes y el informe; el historial las conserva); `AI_AVAILABLE`
pasa a ser lo que diga `status()`. Además, lo que dejaron anotado X3a y X4: el suelo con `FLOOR_ID`
(`AI-POST.md` §7.4) en la guarda, el servicio sintético y los pases de
three.js; la tabla de materiales de la guarda en `AiPostRequest` y el
orden de materiales exportado por `io/rsb.ts`; el *prompt* real de
`src/ai/prompt.ts`; la fuente `RENDER` en la cola; las bibliotecas de
Visual C++ que necesita stable-diffusion.cpp en Windows (junto al
ejecutable o en el instalador); stable-diffusion.cpp y ggml en *Acerca de*.

**Depende de.** X2, X3a, X3b; X4 para verlo de punta a punta.

**Criterio.** De punta a punta con el proceso auxiliar falso: un render
final con IA deja dos imágenes y el informe en el historial; con
intervención 0, la imagen de la IA es la del motor bit a bit; cancelar a
mitad deja la del motor; un modelo que la compilación no carga sale con
el motivo. Lista corta de comprobación para el equipo del usuario (Vulkan,
una imagen de 1024², tiempo anotado).

**Hecho** (2026-10-13). **Lanzador** (`rt-app/src/ai/post.rs`, que enlaza ahora `rt-post`):
`POST /api/ai/post` con `{source: {kind: RENDER, renderId}, settings, prompt, negative, modelKey,
materials}` o, para la vista previa, el cuerpo binario `RPI1` (JSON, imagen `RPL1`, pases `RPP1`,
≤ 512 px); `GET /api/ai/post/<id>?after=n` (estado, `stage`, mosaico y intento desde 1, fracción
que no retrocede, `calls`, el `GuardReport` al terminar), `GET …/image` (`RPL1`, lineal con alfa
recto) y `DELETE`; `aiPost: 1` en `/api/info`. El conductor nativo es la máquina de pasos de X3a
(`plan` → `tile_input` y `control_planes` por mosaico → el `sd-server` de X3b, cargado entre
llamadas → `accept` → reintentos a `RETRY_FACTOR` hasta `MAX_ATTEMPTS`); con Intervención 0 el plan
no tiene mosaicos, no se prepara ni se arranca el motor de ejecución (funciona sin él instalado) y
la imagen es la del motor bit a bit; un mosaico de otro tamaño llega a la guarda como tal (la
comprobación `size`) y rechaza a la primera; un post por el que nadie pregunta en 2 min se para.
El almacén de X2 guarda con cada render su exposición y su curva (`Look`, también en disco), y la
imagen lineal es la conversión de la página (`linear_of`: las sumas por `fround(1/n)`, el color entre
la cobertura donde no es opaca, el umbral `1 − 1e-6` en `f64` como el número de JavaScript; un
umbral `f32` habría llamado opaco al `f32` justo por debajo, y la prueba lo vigila). El falso
`rt-fake-sd` gana un modo `gain` (aclara con suavidad, como un modelo que obedece) y `acceptMs` (un motor que tarda en tomar el trabajo, para ver el estado de inicio de cada mosaico). **Visual C++**:
`proc::missing_dll`, `Probe.dllMissing` y `needs_vc_runtime` (Windows, una DLL que falta y alguna del
entorno de Visual C++ ausente de la carpeta del motor y de `System32`) → `vcRuntime: "missing"` y
`vcRuntimeUrl` en la fila; la interfaz enseña *Instalar el entorno de Microsoft Visual C++…* (la página
oficial de Microsoft con `openExternal`: no redistribuimos sus DLL) y *Comprobar de nuevo*.
*Acerca de* lista stable-diffusion.cpp y ggml con sus textos MIT, copiados byte a byte de los *commits*
fijados (`tools/third-party/`, `tools/licences.mjs`). **Página**: `src/io/ai-post.ts`
(`DesktopAiService`: `status()` es `/api/ai/runtime` con los ajustes de la persona y el modelo activo,
`aiRuntimeQuery` de `src/ui/ai-query.ts`; `post()` manda, sigue, lee la imagen y olvida; un aborto manda `DELETE`); `main.ts` lo
usa cuando el lanzador dice `aiPost`, la web sigue con `notBuiltService` y `?ai=synthetic` con el
sintético; **`AI_AVAILABLE` ya no existe**. La cola pide al render que deje los pases de la guarda en el
lanzador (`aiPasses`, `passesInLauncher`: ni siquiera vuelven a la página; sin albedo, que la guarda no
usa y cuesta un rayo por muestra), manda la fuente `RENDER` con la tabla de materiales
(`guardMaterials` sobre `ProjectScene.materialOrder`) y el *prompt* de `src/ai/prompt.ts`, enseña el
progreso por mosaico en la fila (*IA · mosaico 2 de 4 · intento 2*, `RenderProgress.ai`) y escribe la
imagen de la IA desde la luz lineal con la exposición y la curva del render (`straightBytes`,
`straightWords16`, `straightExr`: PNG de 8 y 16 bits bit a bit con el del motor, EXR en cada píxel opaco);
detener o pausar durante la IA conserva la imagen del motor en el historial y, con *Pausar*, el trabajo
vuelve a esperar como en P3a. **El suelo, `FLOOR_ID`**: en la guarda era casi una región, pero
`FLOOR_ID` es `u32::MAX`, el mismo valor con el que empezaba la caché de regiones, así que un suelo visto
antes que cualquier pieza se quedaba como fondo; ahora es una región de verdad, que se reilumina y tiene
su comprobación de color (*Floor*, sin desgaste); la profundidad del control se normaliza sobre las piezas
y el suelo se dibuja a esa escala, recortado (su plano llega al horizonte); el servicio sintético lo nombra;
los pases de three.js lo encuentran con los rayos centrales del motor (`floorHits`, perspectiva y
ortográfica, también desde debajo del suelo) y coinciden con los del motor en cada píxel del suelo,
horizonte incluido. **De verdad aquí**: el lanzador real con todo el código de la página (motor nativo,
cola, servicio de escritorio) contra el falso instalado donde iría la compilación fijada de Linux
(`tests/ai-desktop.test.ts`); y una vez la tubería entera con stable-diffusion.cpp real y SD 1.5 con su
ControlNet de profundidad en CPU (`real_post_with_sd15_and_its_depth_controlnet_on_the_cpu`, ignorada sin los pesos): el ejemplo de 256 × 192 con el suelo, Intervención 100 y 10 pasos (5 de muestreo a fuerza 0,4), **53 s** en 4 núcleos (13 s de carga de pesos, ~6,5 s por paso), aceptada al primer intento: detalle 0,998, bordes 0,02, ΔE₉₅ 1,9 en el coral y 1,6 en el azul; el suelo llegó a 2,2 y la guarda dejó su cambio de color al 71 %. Los pesos se borraron después. **Con el falso**: todo lo demás. Pruebas: 13 nuevas en
Rust (3 de `rt-post`, 3 unitarias de `rt-app` y 9 de `tests/ai_post.rs`, una más ignorada con los pesos
reales) y 29 de vitest (14 del servicio y de lo que se le pregunta, 4 contra el lanzador real, 4 de la cola, 3 de los pases, 1 del
sintético, 3 de la fila del motor y *Acerca de*), más las de X2 y X4 que cambian con el suelo; 26
mutaciones comprobadas, cada prueba falla si se rompe lo que guarda.

**No encajó con el plan.** (1) **El control**: §3.2 pide bordes y profundidad al ControlNet, y *tile*
para salidas grandes; `sd-server` lleva un solo ControlNet cargado y solo SD 1.5 tiene alguno en los
perfiles (*tile* y *depth*), así que se manda la profundidad de los pases (la primera de `depth`, `tile`
que tenga la familia) en vista previa y en final por igual, para no reiniciar el servidor entre una y
otra; los bordes no tienen ControlNet en los perfiles. Decisión provisional para X1b. (2) **La profundidad
con suelo**: §7.2 dice «normalizada sobre toda la imagen»; con el suelo como superficie, su plano hasta
el horizonte dejaba el producto en unos pocos niveles, así que la escala es la de las piezas y el suelo se
recorta a ella (sin piezas, el suelo marca la escala). Pendiente de Fable en X1b. (3) **EXR en el
visor**: el historial guarda la imagen de la IA de un trabajo EXR tal cual (EXR) y los navegadores no la
muestran: la miniatura sale de una copia de 8 bits, pero el visor no compara *Render | IA* en EXR (haría
falta una segunda imagen de vista en el historial, como el `display` del motor; queda anotado). (4)
**Pausar durante la IA**: el trabajo vuelve a esperar (P3a: un render no se reanuda a medias) y la imagen
del motor ya está en el historial, así que *Reanudar* deja un segundo resultado del mismo trabajo. (5)
**`AiPostRequest`** gana `materials?` (añadido); el resto del contrato añadido va fuera de `core/ai.ts`:
`FrameRequest.aiPasses`, `FrameResult.renderId` y `tone`, `AiEncodeOptions.tone`, `AiPort.materials` y
`renderSource`, `AiPort.scenePrompt(state, settings?)`, `RenderProgress.ai`, `PassIds.floor`,
`RenderOptions.passesInLauncher`, `AI_GUARD_PASSES` (`core/ai-post.ts`). (6) La fracción de la IA ocupa la
barra del trabajo en su lugar (el render ya terminó): la fila dice qué mide. (7) Las Visual C++ no van
junto al ejecutable ni en el instalador: no se redistribuyen; el botón lleva a Microsoft. (8) *Ajustes ▸
Post-procesado IA* ya no dice *llega en una próxima versión* donde el servicio no dice `NOT_BUILT`.
(9) Apagar el interruptor libera el modelo (`DELETE /api/ai/sidecar`, que no hace nada si un trabajo lo
usa). (10) La tolerancia `detailSsim` (y las demás) se puede pasar en la petición (`tolerances`) para
calibrar en X1b; las pruebas lo usan para forzar reintentos. (11) Con el motor real, la primera
llamada dice *inferencia* medio segundo antes de que `sd-server` pinte su barra de carga (el trabajo ya
está `generating` y aún no hay barra); la fracción no retrocede y luego dice *cargando*: cosmético,
anotado para X3b. (12) **El modelo activo en la ventana de render**: sin un modelo elegido a mano, el activo
es la recomendación para el equipo, y la detección del equipo solo la lanzaba *Ajustes*; con el servicio de
escritorio, el interruptor decía *No hay ningún modelo descargado* y llevaba a *Ajustes* aunque el modelo
estuviera instalado (lo enseñaron las capturas contra el lanzador real). Ahora el escritorio con `aiPost`
detecta el equipo al arrancar, la sección también la lanza, y la sección vuelve a preguntar cuando cambia lo
que pregunta (`aiStatusKey`: el dispositivo, el *backend*, el modelo activo, los modelos instalados), con su
prueba. (13) **La cabecera del visor de resultados** apretaba el informe de la guarda en una columna estrecha
junto al título, una o dos palabras por línea (la barra de botones no cedía sitio): ahora el informe tiene su
línea propia a todo lo ancho (una sola, con puntos suspensivos y el texto entero en el aviso), la barra pasa bajo
el título cuando no caben juntos y *Cerrar* se queda en la esquina. `tools/ai-post-check.mjs` (j) lo mide a
1600, 1280 y 960 px en inglés y en español (solapes, salidas de la cabecera, una línea, a todo lo ancho, el
título entero) y falla con la cabecera de antes; capturas `docs/ui/ai-results-viewer.png` y
`ai-results-light.png` rehechas.

### X3d · La web — **Opus**

**Qué.** `AI-POST.md` §2.3: ONNX Runtime Web (MIT) con WebGPU en
workers por etapa, **exportar el codificador del VAE a ONNX** desde el
`ae.safetensors` Apache-2.0 para que exista `ZIMAGE_WEB` (con sus
`sha256`), caché en OPFS con `persist()`, fragmentos de ≤ 1 GiB, el
conductor de la máquina de pasos en un worker con `post.wasm`.
Dependencia nueva anotada en `ARCHITECTURE.md` §1.

**Depende de.** X3c.

**Criterio.** El mismo de X3c con el servicio web; sin WebGPU, el
interruptor queda deshabilitado con el motivo.

## X4 · Interfaz del post-procesado — **Sonnet** — hecha

**Qué.** `AI-POST.md` §4 y §7.5: interruptor, configurador de seis
controles, fichas de protecciones, *Otra variación*, vista previa en modo
Rápido con divisor (los pases de §7.4 dibujados con three.js al tamaño de
la vista previa), actualización al soltar con el tiempo medido, opción
de vista previa con el motor completo, informe de la guarda en el visor
de resultados con el divisor de U5, y las dos miniaturas en la cola; los
ajustes en el *store* (§7.5). Todo contra `AiPostService`
(`src/core/ai.ts`) con un **servicio sintético** (determinista, sin
modelo) hasta que X3c conecte el real; mientras, el interruptor dice
*próximamente* fuera de los tests.

**Depende de.** U5, U6; el contrato de `src/core/ai.ts`.

**Criterio.** Cada control a 0 no cambia su aspecto (test con el servicio
sintético); la vista previa no se recalcula durante un arrastre; los
pases de three.js coinciden con los del motor en ids y profundidad en una
escena de prueba; capturas de la sección y del visor con el divisor.

**Hecho.** *Store* (§7.5): `RenderSettings.ai` es `{ enabled, previewFullEngine }
& AiPipelineSettings` con `DEFAULT_AI`; `normaliseAi` deja los controles en
enteros 0..100, un estilo desconocido en `NATURAL` y la semilla en u32, y
devuelve el mismo objeto cuando nada cambia; un proyecto antiguo (`{ enabled }`)
se abre con los valores por defecto; cada control es una acción de `render/set`
deshacible (arrastrar un control, un paso), *Otra variación* cambia la semilla
(`nextSeed`, congruencial sin repetición), los trabajos copian los ajustes y
la intervención por defecto de Ajustes llega a los proyectos nuevos. **Ventana
de render** (`ui/panels/ai-post.ts`): interruptor con la línea del modelo en
uso (datos del gestor de Ajustes), motivo de `AiUnavailableReason` cuando no
puede, y abrir Ajustes cuando falta modelo o motor; los seis controles con su
frase, las seis fichas con candado sin interruptor y *Otra variación*; vista
previa del modo Rápido a 384–512 px con el divisor de U5, **al soltar** (el
cerebro está en `ui/ai-preview.ts`, sin DOM: `hold`/`touch`/`release`, el
fotograma se reutiliza mientras solo cambian los controles, una vista previa
vieja se abandona), tiempo **medido** alrededor de la llamada a la tubería,
la nota del modo Rápido y la opción del motor completo. **Pases con three.js**
(`render/preview-passes.ts`, `PreviewEngine.aiFrame`): albedo, normal en el
mundo con Z arriba, profundidad a lo largo del eje, ids de pieza y de material
(índice RSB + 1, que `projectScene` entrega ahora en `ids`) empaquetados en
bytes en un blanco de 8 bits sin filtro ni *multisample*, y el círculo de
confusión de la lente fina (`core/lens-coc.ts`). **Servicio sintético**
(`ai/synthetic.ts`): una ganancia suave sobre la imagen del motor (la luz sube
las sombras, los rebotes calientan las bajas frecuencias, el estilo tiñe, el
desgaste no añade nada, la semilla solo ondula), todo a 0 devuelve la entrada
bit a bit, informe de la guarda **medido** (tamaño, píxeles fuera, desplazamiento
de bordes, SSIM de la banda alta, nitidez por mosaico, ΔE₀₀ por material con
CIEDE2000) y la regla de reintentos de §7.2 (`LIMITED`, `REJECTED`). Solo corre
con `?ai=synthetic`; sin él el interruptor dice *próximamente*. **Visor y
cola**: el trabajo guarda la imagen del motor y, al lado, la de la IA
(`…_AI.png`); el resultado conserva las dos y el informe (`ResultMeta.ai`,
solo campos añadidos); el visor abre *Render | IA* con el divisor, la línea
*Comprobado: …*, *La IA se limitó al N %* o la frase del rechazo, y guarda
cada imagen por separado; la cola y el historial enseñan las dos miniaturas.
**Almacenamiento de la segunda imagen**: un cuarto parámetro opcional `ai` de
`ResultsStore.add` y `ai?` en lo que devuelve `get`; IndexedDB la guarda en el
mismo registro de blobs y el escritorio, por el asiento de P3e, como
`<datos>/results/<id>.ai.<ext>` con `PUT`/`GET /api/store/results/<id>/ai`
(cambio pequeño en `rt-app/src/appdata.rs`, su prueba y el README del
*crate*); ningún acceso nuevo al almacenamiento del navegador en el
escritorio. Tests: 1.390 de vitest (98 de X4, 6 de ellos en un Chromium con SwiftShader
que se salta donde no hay navegador: tres.js contra el rayo de la CPU con las
reglas del motor) y una prueba nueva del lanzador (`rt-app`, 9 de `appdata`);
8 mutaciones comprobadas; 25 comprobaciones del navegador en
`tools/ai-post-check.mjs` (y siguen verdes las de U5 y U6).
Capturas: `docs/ui/ai-section-dark.png`, `ai-section-light.png`,
`ai-results-viewer.png`, `ai-results-light.png` y `ai-queue.png`.

**No encajó con el plan.** (1) `AI_AVAILABLE` ya no lo lee el *store*:
`patchSettings` dejaba `enabled` en falso mientras la constante lo fuera, y
con un servicio que dice `available` eso no se sostiene; el interruptor y la
cola miran `AiPostService.status()` (el test de U5 *«video and AI stay off»*
cambió a *«video stays off…»*). (2) Hasta X3c la entrada de la IA en la cola
es **INLINE**: se decodifica la imagen de 8 bits que ya se ha guardado
(`display ?? file`) y los pases se dibujan con three.js al tamaño del
trabajo, en lugar de la fuente `RENDER` que guardará el lanzador con la
imagen lineal; por eso la imagen de la IA sale con la calidad de 8 bits, aun
en un trabajo EXR o PNG de 16 bits. La vista previa trata la imagen del modo
Rápido (con su curva de tono) como luz lineal decodificada con sRGB; qué curva
ve el modelo real lo decide X3c. (3) El `coc` sigue `Camera::generate_ray`
(sensor a la distancia focal, apertura `focal/fstop`, plano de enfoque a
`focusDist`): la huella de un píxel en el plano de enfoque es
`sensor/ladoLargo × focusDist/focal`; la lente fina exacta cambia `focusDist`
por `focusDist − focal`. **X2 debe emitir la misma fórmula.** (4) Los pases de
three.js son una aproximación del contrato: el albedo es el color base del
primer impacto (no sigue los rebotes especulares), el suelo y los paneles de
luz no cuentan (fondo 0 / +∞), las dos caras de un triángulo cuentan y la
normal se da orientada hacia quien mira; X2 tiene que decidir lo mismo o se
anota la diferencia. (5) *ΔE máx* es el mayor ΔE₀₀ **medio** de un material, y
*geometría ✓* reúne bordes, píxeles fuera y detalle de banda alta; si la guarda
real reparte las comprobaciones de otro modo, cambia `reportItems`. (6) El
servicio sintético usa como límites los valores de fábrica de Ajustes ▸
Avanzado, no los de X1. (7) Las animaciones no pasan por la IA (el interruptor
queda deshabilitado en *Animación*, con *próximamente*); la imagen de la IA se
guarda sola junto a la del motor, con el sufijo `_AI`, para que un lote la
tenga sin abrir cada resultado. (8) `numberField` y `slider` ganan `onHold` y
`onRelease`, y el deslizador **sigue ahora al valor al deshacer** aunque tenga
el foco (antes la perilla se quedaba donde estaba mientras el campo cambiaba:
lo encontró la comprobación del navegador, que ahora lo vigila). (9) El
*prompt* es un hueco (`AiPort.scenePrompt`: vacío y el negativo fijo de §3.2)
hasta que X3a traiga `src/ai/prompt.ts`; `rw.aiWhy.NO_WEBGPU` entra en
`WEB_ONLY_STRINGS` (nombra el navegador y solo puede darse en la web).

**Espera a X3c.** Conectar el servicio real (hoy `main.ts` elige entre el
sintético y `notBuiltService`), cambiar la entrada de la cola a la fuente
`RENDER` con los pases que guarda el lanzador, el progreso por mosaico en el
trabajo (hoy se ignora `onProgress` en la cola), el *prompt* de X3a, quitar
`AI_AVAILABLE`, y que las dos imágenes del historial salgan de la imagen
lineal del motor. Y X2: los mismos ids, la misma profundidad y el mismo `coc`
que dibuja la vista previa (el test del navegador es la vara de medir).

## X4b · Prompt propio y variantes — **Opus** — hecha

**Petición del usuario (2026-10-13):** «si lo soporta el modelo, que deje
un prompt de texto en la configuración del render en cuestión, y que se
puedan hacer unas cuantas variantes; por defecto, una sola».

**Decisiones del líder.**
- **Prompt propio** en la sección *Post-procesado IA* de la ventana de
  render (es del trabajo: se guarda en el proyecto, se deshace y cada
  trabajo de la cola lleva el suyo): un campo de varias líneas, vacío por
  defecto, de hasta 400 caracteres, con la nota *Describe la luz o el
  ambiente; la geometría, los materiales y el enfoque siguen protegidos*.
  Se **añade** al *prompt* que se genera de la escena (`src/ai/prompt.ts`),
  nunca lo sustituye, y el negativo fijo sigue. Solo aparece si el modelo
  activo lo admite: una capacidad nueva `textPrompt` en
  `src/data/ai-models.json` (se añade, no se renombra nada; los modelos de
  origen la tienen; un importado la declara en su `model.repackshot.json`);
  si no, el campo se ve deshabilitado con el motivo.
- **Variantes**: un número de 1 a 8, **1 por defecto**, junto a *Otra
  variación*. Un trabajo con N variantes hace **un solo render del motor**
  y N pasadas de IA con semillas consecutivas (semilla, semilla + 1…),
  con el modelo cargado una vez; la cola dice *IA · variante 2 de 4 ·
  mosaico 3 de 4*; cada variante lleva su informe de la guarda. La vista
  previa sigue siendo de una sola variante. Se avisa del tiempo estimado
  (N × lo medido) cuando hay medida.
- **Resultados**: un resultado guarda el render y sus N imágenes de IA
  (en escritorio, `<id>.ai.<n>.<ext>` en la carpeta de resultados; el
  `ai` de antes se lee como la variante 1); el visor muestra una tira de
  miniaturas para elegir variante, el divisor compara la elegida con el
  render y se puede *Guardar esta variante* o *Guardar todas*; el
  historial y la cola muestran cuántas hay. Nombres de archivo con el
  sufijo `_AI`, `_AI_2`, `_AI_3`…

- **Prompt del sistema** (petición del usuario, 2026-10-13): en *Ajustes ▸
  Post-procesado IA* un apartado *Prompt del sistema*, general para todas
  las imágenes (es un ajuste de la aplicación, no del proyecto), con un
  campo de varias líneas, *Restablecer el predeterminado* y la nota de que
  las protecciones de la guarda no dependen de él. Orden al componer:
  **sistema → escena → propio del trabajo**; el negativo fijo, aparte. El
  predeterminado lo fija el líder, en inglés (los codificadores de texto
  de los modelos rinden mejor en inglés):

  > Photorealistic product photograph. Keep the image exactly as rendered:
  > the same composition, framing, geometry, proportions, edges,
  > materials, colours, labels, text and logos. Respect the existing
  > lighting: the direction, size, softness and colour of every light,
  > and the shadows and reflections they cast. Respect the existing depth
  > of field: what is in focus stays sharp, what is out of focus stays
  > soft. Improve only realism and naturalness: subtle light falloff,
  > soft contact shadows, natural bounce light and colour bleeding,
  > believable highlight roll-off, fine surface micro-detail and gentle,
  > plausible imperfections. True-to-life tones, as if shot with a
  > high-end camera and lens. No stylisation, no added objects or props,
  > no change of background.

  Para modelos con límite de longitud del *prompt* (SD 1.5: 77 *tokens*
  de CLIP; una capacidad `maxPromptTokens` en `ai-models.json`), se usa
  la versión corta, también del líder, y el resto se recorta en este
  orden (lo propio del trabajo primero, luego la escena, luego el
  sistema), avisando de lo recortado:

  > photorealistic product photo, same composition, geometry, materials
  > and labels, same lighting and depth of field, natural soft shadows,
  > subtle bounce light, realistic highlights, fine micro-detail,
  > true-to-life colours, nothing added

**Criterio.** Tests: el prompt propio llega al modelo tras el de la escena
y el negativo fijo intacto; sin capacidad `textPrompt`, no se envía y el
campo lo dice; N variantes = un render del motor y N llamadas con
semillas consecutivas, y cancelar a mitad deja el render y las variantes
terminadas; guardar y abrir (proyecto y resultados, también los de una
sola `ai` de antes); deshacer del prompt (un cambio de texto es una
entrada al salir del campo) y del número; cadenas en `es` y `en`; cromo
acromático; capturas de la sección y del visor con varias variantes.

**Hecho** (2026-10-13). **Prompt propio**: `AiPipelineSettings.userPrompt` (recortado, hasta
`MAX_USER_PROMPT` = 400 caracteres) en la sección de la ventana de render, bajo los seis controles: un
campo de varias líneas (`textArea` de `ui/components/controls.ts`) con contador y la nota del líder; se
guarda al dejar de escribir (700 ms) y al salir del campo, y todo lo de una visita lleva el mismo gesto,
así que es **una** entrada de deshacer (*Post-procesado IA: Prompt propio*); mientras tiene el foco, lo que
vuelve del *store* no pisa lo que se escribe (el recorte de un espacio final no se lo come). Va en el
proyecto y cada trabajo lleva el suyo; un proyecto anterior abre sin él. Se compone **sistema → escena →
propio** (`composePrompt`, `src/core/ai-prompt.ts`; `buildPrompt(state, settings, context?)` en
`src/ai/prompt.ts`, que sin contexto sigue dando solo el de la escena) y el negativo fijo va aparte, igual.
**Capacidades**: `capabilities: { textPrompt, maxPromptTokens? }` en cada modelo de `ai-models.json` (todos
con `textPrompt`; `SD15_LIGHT` con 77) y en el manifiesto de un importado (el formulario de importar lo
pregunta); `ModelView.textPrompt`/`maxPromptTokens`; manda el modelo que el servicio dice activo
(`promptCaps`; el sintético lo admite todo, uno desconocido nada). Sin `textPrompt` el campo se ve
deshabilitado con el motivo y no se envía. **Prompt del sistema** (`ai.systemPrompt`, *Ajustes ▸
Post-procesado IA ▸ Prompt del sistema*): el texto del líder por defecto, campo de varias líneas,
contador, *Restablecer el predeterminado* y la nota de que la guarda no depende de él; puede quedarse
vacío; en escritorio va en `settings.json` como todo ajuste (prueba con el espía de P3e). Con
`maxPromptTokens` se usa la **versión corta** mientras el texto sea el predeterminado (los mismos
espacios o no) y se recorta palabra a palabra desde el final, **el propio, luego la escena, luego el
sistema**, con una estimación prudente documentada en `AI-POST.md` §4; la línea bajo el campo de la
ventana dice qué se queda fuera, y la de Ajustes qué recibe el modelo en uso. **Variantes**:
`AiPipelineSettings.variants` (1–8, 1 por defecto) junto a *Otra variación*, deshacible, con la línea
de las semillas y el tiempo estimado; cambiarlo no rehace la vista previa (sigue siendo una imagen). En la
cola, `aiStep` hace **un render** y N peticiones del mismo origen (el `renderId` guardado, o la imagen
decodificada una sola vez) con `variantSettings` (semilla + n − 1), cada imagen con su informe y
`aiFileName(nombre, n)` (`_AI`, `_AI_2`…); la fila dice *IA · variante 2 de 4 · mosaico 3 de 4* y la barra
mide las variantes juntas; detener a mitad conserva el render y las terminadas; una rechazada queda con
su informe y sin imagen; si una falla, se quedan las anteriores. **Resultados**: `ResultMeta.aiMore` (la
primera sigue en `ai`), `aiVariantsOf`/`aiImagesOf`, `ResultsStore.add(…, ai, aiMore)` en memoria, en el
registro de IndexedDB y en el lanzador como `<id>.ai.<n>.<ext>` con `PUT/GET /api/store/results/<id>/ai/<n>`
(`appdata.rs`, aditivo: `aiVariants` en el índice; el `<id>.ai.<ext>` de antes se lee como la variante 1 y
`…/ai` sigue); la migración desde el navegador las copia. El visor tiene la **tira de miniaturas** (una
línea propia entre la cabecera y la imagen), el divisor compara la elegida sin perder el zum
(`SplitCompare.setB`), su informe en la línea, *Guardar esta variante* y *Guardar todas*; la cola y el
historial ponen *×4* y la cola *IA × 4*; el pie de la ventana, *IA activada · 4 variantes*. Pruebas: 39
nuevas de vitest (22 del *prompt*, las capacidades, el sistema y el *store*; 15 de variantes contra el
sintético, un servicio como el del lanzador y el `DesktopAiService` contra un lanzador de pega; 1 de
persistencia del ajuste en escritorio; 1 de punta a punta con el lanzador real y el `rt-fake-sd`: tres
variantes, un render, semillas 20, 21 y 22 en el registro del motor falso, que no vuelve a arrancar), más
las que cambiaron (el doble del lanzador aprende `…/ai/<n>` tan estricto como el de verdad); 1 de Rust
(`appdata`); 10 comprobaciones nuevas del navegador en `tools/ai-post-check.mjs` (k, l y la tira en j;
36 en total, todas en verde);
18 mutaciones comprobadas. Capturas: `docs/ui/ai-section-prompt.png`, `ai-results-variants.png` y
`settings-ai-prompt.png`.

**No encajó con el plan.** (1) `userPrompt` y `variants` son **opcionales** en el contrato
(`AiPipelineSettings`, para no romper a quien construye uno sin ellos) y obligatorios en el *store*
(`AiSettings` es `Required<…>`); el lanzador no los lee: cada petición es una imagen con su semilla y el
*prompt* ya compuesto. (2) La composición y la cuenta viven en `src/core/ai-prompt.ts` (puras, para que
Ajustes las use sin el puerto de la IA) y `src/ai/prompt.ts` las llama. (3) En escritorio la variante 1
nueva se escribe `<id>.ai.1.<ext>`, como pide el plan; `<id>.ai.<ext>` queda para leer los de antes. (4) La
estimación de *tokens* es prudente de verdad: la versión corta cuenta 65 de los 77 (con CLIP real, unos
45), así que con SD 1.5 el *prompt* propio casi nunca entra; afinarla (o traer el vocabulario de CLIP,
1,6 MB) queda para X1b. (5) El prompt del sistema y el de la escena se mandan también a un modelo sin
`textPrompt` (como antes el de la escena); solo se retiene el propio del trabajo. Un importado `sd15` o
`sdxl` sin `maxPromptTokens` lee 77. Z-Image, FLUX.2 klein y Qwen no llevan límite: sus codificadores
leen cientos de *tokens* y lo compuesto más largo cabe; X1b lo confirma. (6) **El tiempo estimado** es N ×
los píxeles del trabajo / la velocidad de la IA medida alrededor de cada petición del último trabajo con IA
de este equipo (`UiState.aiThroughput`), no N × la medida de la vista previa (a 512 px no dice nada de los
mosaicos de un final); sin medida, la línea dice que se mide con el primero; incluye la carga del modelo
si la hubo, así que tira por arriba. (7) Al comparar con otro resultado (*Comparar con…*) la tira solo
cambia la línea del informe: el divisor compara los dos resultados. (8) `src/main.ts` no pasaba la lista
de variantes al historial (`results.add` con cuatro argumentos): lo encontró la lectura antes que una
prueba; lo vigila la comprobación del navegador (k), que es la que pasa por `main.ts`.

## X5 · Ajustes y modelos — absorbida en U6

El gestor de modelos, el selector y la detección del equipo llegan en
**U6**, porque no necesitan la tubería. Lo que sí la necesita (comprobar
en vivo que el modelo activo cabe y una prueba de una imagen desde
*Ajustes*) pasa a X4.

## K1 · Tipo de escena, luz de interior y Doctor de interiores — **Sonnet** — hecha

**Qué.** `scene.type ∈ {PRODUCT, INTERIOR, CATALOGUE}` en el *store* y en
la sección *Producto* del inspector, con la tabla de valores por defecto
de `INTERIORS.md` §3.1 aplicada al cambiarlo (solo defaults: ningún
control desaparece); nuevo estilo **Interior** en `LIGHT_STYLES` y
`LIGHT_SETUPS` (*Ventana de mañana*, *de mediodía*, *de tarde*,
*Nublado*, *Lámparas de noche*, *Hora azul*, *Sala blanca de estudio*),
cada receta con `world` y exposición, sin tocar las 72 existentes; los
chequeos de escena del Doctor de interiores de `INTERIORS.md` §3.6 que
no dependen del motor (escala y unidades, abertura ausente con sol o
cielo, vidrio grueso, óptica < 18 mm, altura de ojo, recorte cercano,
normales invertidas) con su arreglo.

**Depende de.** U1, L4.

**Criterio.** Cambiar de tipo y volver deja el estado idéntico salvo lo
que el usuario tocó (test); los montajes nuevos pasan los tests de
recuento y normalización; cada chequeo nuevo detecta su caso y su arreglo
lo limpia; captura con el tipo *Interior* activo.

**Hecho.**

*Tipo de escena.* `ProjectState.scene.type` (`PRODUCT` · `INTERIOR` · `CATALOGUE`, `Producto` por defecto) y la
acción `scene/setType`, una sola entrada de deshacer. Los valores son datos (`src/data/scene-types.ts`, `SCENE_TYPES`:
clave estable, etiqueta e intención en los dos idiomas, y los valores por defecto de cada tipo) y lo que los aplica es
`src/core/scene-type.ts`. En la sección *Producto* del inspector, encima de *Tipo de producto*, un control segmentado
*Producto · Interior · Catálogo* con la intención de cada tipo en su ayuda y una nota que dice que ningún control se mueve;
la sección *Luz* salta al estilo *Interior* al elegirlo (estado de interfaz, no del proyecto) y vuelve a *Todos* al
dejarlo. **Cambiar de tipo y volver deja el proyecto como estaba salvo lo que se tocó entre medias**: cada valor que un
tipo escribe es una *casilla* (10 fijas y una por cámara, `camera.focal:<id>`) con lo que había (`base`) y lo que el tipo
puso (`applied`), guardado en `scene.typeBase`. Al cambiar, una casilla cuyo valor sigue siendo `applied` no la tocó nadie
y vuelve a `base` antes de que el tipo nuevo escriba la suya; una que ya no lo es la tocó la persona, y su valor es el `base`
nuevo. Un tipo que pone lo que ya había no recuerda nada, y volver a Producto no deja memoria (`scene.typeBase` desaparece).
Un HDRI cargado no lo sustituye ningún tipo (es el «o HDRI interior» de la tabla, y `worldFor` también lo deja ganar) y una
cámara bloqueada conserva su óptica. **Proyecto**: se guarda `scene.type` y, mientras no sea Producto, `scene.typeBase`; el
esquema sigue en 2; un proyecto anterior no tiene ninguno y abre como Producto, un tipo que esta versión no conoce abre como
Producto y de la memoria se conservan solo las casillas que esta versión conoce y con valores que esa casilla admite
(`normalizeSceneType`, `normalizeTypeBase`).

*La tabla de `INTERIORS.md` §3.1, tal como está aplicada* (lo que no escribe Producto es lo que el proyecto ya tiene; las
filas que nombran algo que no existe aún están en «Qué no encajó»):

| Fila | Producto | Interior | Catálogo |
| --- | --- | --- | --- |
| Entorno | no escribe | tipo de entorno *Cielo* (sol y cielo) | *Cúpula de estudio* y fondo de color blanco `[1, 1, 1, 1]` |
| Rebotes | no escribe (los del nivel de calidad) | 16 (`render.advanced.maxBounces`) | 8 |
| Cáusticas | no escribe (Automático) | Apagadas | Apagadas |
| Sombra de suelo | no escribe | sin sombra de contacto (`studio.shadow` apagado) | sombra de contacto encendida y suave (`environment.groundShadow` 0,35) |
| Transformada | no escribe | AgX | Estándar |
| Muestras objetivo | no escribe (256) | 512 (el nivel pasa a *Personalizado*), terminar por ruido y *denoise* en visor y render | 256 (el nivel *Vista previa*) |
| Cámara | no escribe | 28 mm en cada cámara que no esté bloqueada | 50 mm |

*Estilo Interior.* `LIGHT_STYLES` pasa de 9 a 10 entradas (`INTERIOR` la última) y `LIGHT_SETUPS` de 88 a 95: las siete
recetas están **al final**, así que ninguna clave ni ningún orden anterior se movió (los 72 montajes de EZ Packshot y los
16 sets, intactos: un test compara los 71 rigs con el fixture de antes de L6). Cada receta es un set sin decoración:
elige su mundo (`SKY` con un foco de sol que coloca el sol del cielo, o `STUDIO`), y trae su desvío de exposición
(`exposureEv`) y la intensidad del entorno (`envStrength`), porque la hora del día **es** el brillo de la imagen y aquí,
a diferencia del resto de montajes, elegir una sí cambia el aspecto. Los focos están normalizados al nivel del tipo de
producto como todos (un test con los 16 tipos: error < 10⁻⁶). Una receta que mezcla un sol con paneles lleva *shares* en
la escala de `specIrradiance` (un sol cuenta su irradiancia en W/m² y un panel sus vatios sobre 4π d²): el *share* de un
panel que da `r` veces lo que el sol es 4 d² r veces el del sol (por eso las ventanas llevan 5 a 14 frente al 1 del sol; el
cálculo está en el comentario de `light-setups.ts`). Las cifras de las siete recetas son una propuesta (◆ pendiente de Fable: la
tabla está en «Qué no encajó», 1). Mirando las miniaturas (`SPHERES`, 256 × 256, 96 muestras) la mañana tira a cálido, el mediodía es
neutro, la tarde es ámbar, *Nublado* y *Sala blanca* son suaves y claras, las lámparas dejan la sala a oscuras y la hora
azul parte cálido a la izquierda y azul a la derecha. **Miniaturas**: las siete se han renderizado con el motor nativo
(`node tools/setup-thumbs.mjs --keys INT_WINDOW_MORNING,…`: 21 s de render en total) y están en
`public/thumbs/setups/` (`thumb_int_*.png` y `setup_int_*.png`) y en `manifest.json`, que pasa a 95 entradas (el test que
reconstruye cada escena con el código y compara su hash lo comprueba); `tests/set-heroes.ts` pone `SPHERES` de objeto del
estilo.

*Dos arreglos en `core/sets.ts`, con su prueba cada uno.* Una receta es un set sin decoración, y eso destapó tres cosas que
un set con decoración no hacía notar: (1) `applySet` encendía el suelo y la sombra de contacto con cualquier set, también
con uno que no trae nada que apoyar (contra el *Interior* que no lleva sombra propia); ahora solo con decoración
(`hasDecoration`: fondo, suelo, charco o tarjetas, los 16 sets la tienen). (2) Una receta elegida tras un set con fondo
dejaba **el fondo del set** en el marco (lo vio la miniatura: el fondo claro del barrido detrás de las esferas); ahora el
fondo vuelve al del tipo de producto, como al elegir cualquier otro montaje. (3) Dejar una receta por otro montaje
restauraba el fondo del tipo de producto aunque la receta nunca lo tocó, pisando el fondo de la persona (el blanco de
*Catálogo*); ahora solo lo restaura quien dejó un fondo (`presetLook(…, background)`). Mutaciones: las tres se
reintroducen y `tests/interior-setups.test.ts` falla (la segunda también el test de las miniaturas, porque el hash de la
escena cambia).

*Doctor de interiores.* `core/doctor-interior.ts` (lógica) y `data/doctor-interior.ts` (descriptores en los dos idiomas,
`INTERIOR_DOCTOR_CHECKS`), enchufados al Doctor en pocas líneas: `runDoctor` añade `runInteriorDoctor(state)`, el `default`
de `fixDoctor` llama a `fixInterior`, `doctorCheck(key)` conoce los dos listados y la ventana del Doctor busca el
descriptor con `doctorCheck`. **Solo corren con el tipo *Interior***: en una escena de producto no están en los resultados
(y `DOCTOR_CHECKS`, el listado del Doctor, no se toca). Siete claves estables: `interiorScale`, `interiorOpening`,
`interiorGlass`, `interiorLens`, `interiorEye`, `interiorClip`, `interiorNormals`. Todos con arreglo, que es una acción
normal del *store* (una entrada de deshacer):

| Chequeo | Detección | Arreglo | Prueba | Mutaciones |
| --- | --- | --- | --- | --- |
| Escala y unidades | el tamaño mayor de la escena (la caja de las piezas que no son decoración) fuera de 100 mm–30 m | reescala por el factor del importador (metros, micrómetros) si cae en el rango; si no, por la potencia de diez más pequeña que lo logra; si ninguna, hasta el límite; el factor del importador se gasta | «escala y unidades» (5 pruebas: los límites, ×10, ×100, ×1000, ÷1000, lo más absurdo, el importador y el tamaño del tipo de producto) | 6 |
| Abertura para el sol y el cielo | la cámara activa dentro de la caja de la escena (de más de 1,5 m por cada lado), el cielo o un sol encendido la ilumina y ninguna pieza visible lleva un material de vidrio, con `transmission` ≥ 0,5 u `opacity` ≤ 0,5 | pone el montaje *Sala blanca de estudio* (paneles y lámparas en lugar de sol y cielo) | «una abertura para el sol y el cielo» (5) | 9 |
| Vidrio de ventana | una pieza visible, plana (grosor ≤ 12 % de su lado mayor, con dos lados grandes y el mayor ≥ 300 mm, medido en su caja propia por la escala de su matriz: una pieza girada o estirada de un cubo es igual de plana) con un material `GLASS` de paredes `SOLID` | pone `walls` a `THIN` (el mismo `material/setParam` de la interfaz); si el material lo comparte una pieza que no es un panel, un `material/detach` da a los paneles una copia y solo ella queda fina | «vidrio de ventana» (5) | 8 |
| Óptica | una cámara en perspectiva con menos de 18 mm | 24 mm y sin preset de óptica, en todas las que lo pasan | «una óptica más ancha de 18 mm» (3) | 7 |
| Altura de ojo | una cámara en perspectiva, no bloqueada, a menos de 0,3 m o más de 2,2 m sobre el suelo (z = 0) | 1,5 m: cambia la elevación mirando al mismo punto por el mismo lado a la misma distancia; si no llega a ese ángulo razonable (80°), retrocede y arrastra el enfoque | «altura de ojo» (5) | 8 |
| Recorte cercano | una cámara en perspectiva dentro de la caja de la escena cuyo `clipStart` llega a la cara más cercana de esa caja (la pared) | `clipStart` a la mitad de esa distancia (mínimo 0,01 mm) | «el recorte cercano contra la pared» (4) | 6 |
| Normales | una superficie cerrada (`solidOrientation`, nueva en `core/solid.ts`) que mira hacia fuera con la cámara dentro de su caja, o hacia dentro con la cámara fuera (un sólido al revés, una habitación con las paredes al exterior; una pieza reflejada se mira como queda en el mundo); y, con la cámara en la habitación, una pared plana (de más de 1 m y delgada como el 2 %) cuyas caras no miran a la cámara; con un presupuesto de 500 000 triángulos por pasada, en el orden del árbol | `scene/flipNormals` de esas piezas | «normales invertidas» (7, una el presupuesto de triángulos) + 3 de `solid.ts` | 11 |

Hay 57 mutaciones del Doctor (2 de ellas, del tipo de escena: que corra o arregle en una escena de producto; la detección
de cada chequeo apagada, cada arreglo vacío, cada umbral y cada condición, el resto) y 1 de `solidOrientation`; todas las detecta alguna prueba (dos sobrevivieron a la primera ronda, el giro del
cristal y el preset de la óptica, y su prueba se arregló). La comprobación de escala del propio Doctor
(`scale`) no compara una escena *Interior* con el tamaño del tipo de producto (un salón de 5 m frente a los 200 mm de
*Estándar* da veinticinco veces): sigue preguntando por el tamaño declarado.

*Pruebas.* Nuevas: `tests/scene-type.test.ts` (32: la tabla de cada tipo, los cinco recorridos de ida y vuelta con un
proyecto nuevo y con todas las casillas tocadas a mano, lo que la persona tocó, el HDRI, la cámara bloqueada, cada cámara con
la suya, el mismo tipo sin cambio, un solo deshacer, el proyecto guardado y abierto, uno anterior, un tipo desconocido, la
memoria dañada, el comando y sus cadenas), `tests/interior-setups.test.ts` (14: el estilo, los mundos, las recetas como sets
sin decoración, el sol del cielo donde dice la luz, la normalización con los 16 tipos, elegir y dejar una receta),
`tests/doctor-interior.test.ts` (41) y 3 en `tests/solid.test.ts`. Actualizadas con sus números nuevos, sin tocar lo que no
cambia: `data.test.ts` (95 montajes y 10 estilos, 7 mundos `SKY`, 7 soles), `rig.test.ts` (78 montajes normalizados con los
16 tipos), `sets.test.ts` (los 72 de antes sin campos de L6; 95 escenas en el manifiesto) y `palette.test.ts` (95
montajes). Mutaciones del tipo de escena: 5 (no restaurar, restaurar todo, no guardar la memoria, no normalizar el tipo,
escribir una cámara bloqueada), todas detectadas. En el navegador: `tools/scene-type-check.mjs` (Playwright, *Rápido*: el
control, que el inspector tiene los mismos controles con cada tipo, *Interior* en una entrada de deshacer con sus siete
recetas y sus miniaturas cargadas, la sombra de contacto apagada y AgX, las siete filas del Doctor, una receta, *Catálogo*,
volver a *Producto*); captura `docs/ui/scene-type-interior.png`.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de Fable: queda anotado, no decidido).

1. ◆ **Las cifras de las siete recetas** son una propuesta mía, **pendiente de Fable**: altura, azimut y temperatura del sol,
   peso de la ventana y del rebote, intensidad del cielo y desvío de exposición. Siguen los órdenes de magnitud de la
   fotografía de interiores y están normalizadas como el resto, pero son decisiones fotográficas y no las he tomado. El
   comentario de `light-setups.ts` lo dice. La propuesta, receta a receta (azimuts relativos a la cámara; tamaños en
   tamaños de pieza, a la distancia dicha; *share* en la escala de `specIrradiance`, ver arriba):

   | Receta | Etiqueta | Mundo | Intensidad del entorno | Exposición (EV) | Luces: tipo az/el/temperatura, tamaño en tamaños de pieza a su distancia, *share* |
   | --- | --- | --- | --- | --- | --- |
   | `INT_WINDOW_MORNING` | Ventana de mañana | `SKY` | 0,12 | +0,2 | sol −65°/20°/4300 K ×1; panel −70°/30°/7200 K 5×4 a 2,6 ×12,2; panel 70°/12°/5200 K 4×4 a 3,5 ×5,9 |
   | `INT_WINDOW_NOON` | Ventana de mediodía | `SKY` | 0,15 | +0,2 | sol −55°/62°/5600 K ×1; panel −75°/40°/6800 K 5×4 a 2,6 ×8,1; panel 70°/12°/5600 K 4×4 a 3,5 ×4,9 |
   | `INT_WINDOW_AFTERNOON` | Ventana de tarde | `SKY` | 0,11 | 0 | sol 70°/14°/3200 K ×1; panel 75°/24°/5600 K 5×4 a 2,6 ×10,8; panel −70°/10°/4600 K 4×4 a 3,5 ×7,4 |
   | `INT_OVERCAST` | Nublado | `STUDIO` | 0,8 | +0,3 | panel −75°/38°/7000 K 7×5 a 3 ×0,5; panel 0°/82°/6800 K 6×6 a 2,8 ×0,25; panel 75°/14°/6800 K 5×5 a 3,6 ×0,25 |
   | `INT_NIGHT_LAMPS` | Lámparas de noche | `STUDIO` | 0,04 | −0,7 | disco −110°/28°/2600 K 0,7 a 2,2 ×0,45; disco 125°/48°/2400 K 0,5 a 2,8 ×0,25; cuadrado 0°/80°/2900 K 1,4 a 2,8 ×0,2; panel 60°/12°/8500 K 4×4 a 3,5 ×0,1 |
   | `INT_BLUE_HOUR` | Hora azul | `SKY` | 0,45 | −0,5 | sol 115°/3°/2300 K ×0,15; disco −100°/28°/2700 K 0,7 a 2,2 ×20; disco 135°/45°/2500 K 0,5 a 2,8 ×12; panel 75°/25°/10500 K 5×4 a 2,6 ×14; panel −35°/12°/7500 K 4×4 a 3,5 ×7 |
   | `INT_WHITE_ROOM` | Sala blanca de estudio | `STUDIO` | 1 | +0,5 | panel 0°/85°/5600 K 6×5 a 2,6 ×0,3; panel −80°/28°/5600 K 6×5 a 2,8 ×0,3; panel 80°/22°/5600 K 5×5 a 3,2 ×0,2; panel 0°/15°/5600 K 4×4 a 3,5 ×0,2 |

   Los azimuts son relativos a la cámara (`LightSpec.az`). Los órdenes de magnitud: el sol de 2 a 4 veces el cielo a mediodía y
   de 1,5 a 2 al atardecer (la intensidad del entorno sale de que el cielo da la irradiancia de la cúpula de estudio, unos 2 por unidad
   de intensidad en las unidades del normalizador, y el sol `sen(altura)` por su energía), lámparas de tungsteno a 2400–2900 K, un cielo claro a través de un
   vidrio a 6500–10 500 K.
2. ◆ **Los umbrales del Doctor de interiores**, propuesta mía **pendiente de Fable** (`INTERIORS.md` §3.6 nombra los
   chequeos, no las cifras); son constantes exportadas de `core/doctor-interior.ts`:

   | Constante | Valor | Para qué |
   | --- | --- | --- |
   | `INTERIOR_MIN_MM`, `INTERIOR_MAX_MM` | 100 mm y 30 m | tamaño de la escena que es un mueble o una habitación (un jarrón y un loft) |
   | `WIDE_LENS_MM` | 18 mm | óptica que estira los bordes (la cifra es la de §3.4) |
   | `INTERIOR_LENS_MM` | 24 mm | lo que pone el arreglo: la más ancha de las ópticas de interior de §3.4 |
   | `EYE_MIN_MM`, `EYE_MAX_MM` | 0,3 m y 2,2 m | altura de ojo plausible sobre el suelo (z = 0) |
   | `EYE_STANDING_MM` | 1,5 m | lo que pone el arreglo: una persona de pie (§3.4) |
   | habitación, panel, pared | 1,5 m por lado; grosor ≤ 12 % y ≥ 300 mm; ≤ 2 % y ≥ 1 m | qué caja es una habitación, qué pieza es un cristal de ventana, qué pieza plana es una pared |
   | recorte | la mitad de la distancia a la pared (≥ 0,01 mm) | lo que pone el arreglo |
   | `INTERIOR_NORMALS_TRIANGLES` | 500 000 | presupuesto de triángulos de la comprobación de normales por pasada |

3. ◆ **Valores de la tabla de §3.1 que son un número donde el documento da un intervalo o una palabra**: *Rebotes* «16–24» es
   16 (el límite bajo; el *Final* podría pedir 24); *sombra de contacto suave* es una opacidad de 0,35 en el visor (la sombra
   de contacto del motor no tiene intensidad: es el atrapasombras, y su suavidad la da el tamaño de las luces); *cúpula
   blanca* es la cúpula de estudio con un fondo de color blanco puro. El tipo de escena **no cambia el montaje de luz**: elige
   el entorno, y la sección *Luz* se abre en las recetas de *Interior*, pero cuál de las siete es la de partida es una
   decisión de fotógrafo que no tomé.
4. **Filas de §3.1 que no se aplican porque nombran algo que aún no existe o que no es del proyecto.** *Entorno*: el ciclorama
   del catálogo (K2). *Exposición*: la automática con su mando EV (K3; la exposición queda en la del tipo de producto y el
   desvío de la receta). *Cámara*: la altura de ojo de 1,5 m y las verticales rectas (K3), y «alzado o tres cuartos» (una
   vista, no un valor: se queda la que hay). *Transformada*: «rodillo largo» y *Low contrast* — el mapeo de tonos no tiene
   parámetro de rodillo y *Contraste* se guarda pero el motor aún no lo aplica (`image.postSoon`), así que solo se pone AgX
   (y, de paso, `INTERIORS.md` §3.5 pide una curva por receta: `LightSetup` no tiene campo para ella). *Unidades mostradas*:
   es una preferencia de la aplicación (*Ajustes ▸ General*), no del proyecto, y moverla con el tipo rompería «toda mutación
   pasa por el *store* y es deshacible» y la ida y vuelta; el Doctor sí habla en mm y metros. «**HDRI interior**»: no hay
   recetas de entorno propias todavía (`STUDIO-TOOLS.md` §2); se respeta el HDRI que la persona haya cargado.
5. **La tabla dice «Producto (hoy): Estándar / AgX» y el proyecto nuevo arranca en *Fílmica*.** Producto no escribe nada, así
   que no hay conflicto; la fila de la tabla no es lo que el proyecto trae.
6. **La bruma del cielo por receta** (la turbidez es `environment.skyTurbidity`, no del montaje) **no está**: `LightSetup`
   no tiene el campo y dejarlo exige una regla de qué devolver al salir de la receta. Las recetas de día usan la bruma que
   haya (3 por defecto); *Nublado* es la cúpula de estudio con una ventana difusa, no un cielo cubierto (no hay modelo de
   nubes). ◆
7. **Sin el nodo `ROOM` de K2 el Doctor usa lo que hay.** «Habitación cerrada» es la cámara dentro de la caja de las piezas;
   «abertura» es un material de vidrio o transparente; «pared» es una cara de esa caja. K2 sustituye lo primero y lo segundo
   por las aberturas de la habitación; los chequeos y los arreglos se quedan. **El arreglo de la abertura es un sustituto**:
   los focos de la receta *Sala blanca* están alrededor del producto a distancias en tamaños de pieza, así que en una
   habitación importada de verdad cerrada quedan fuera de sus paredes; el arreglo bueno (*añadir una ventana*) es de K2.
8. **Normales: solo superficies cerradas y paredes planas con la cámara dentro.** Una malla abierta que no es una pared (más
   de 1 m, 2 % de grosor) no se mira, ni las piezas que pasan de un presupuesto de 500 000 triángulos por pasada, en el orden
   del árbol (la primera vez que se mira una malla se sueldan sus vértices y una sala amueblada entera pararía el primer
   cambio de la escena; se cuentan triángulos y no lo que está en la caché, así que la misma escena da siempre la misma
   respuesta), ni se detecta lo de «una cara» (una pared sin grosor por donde la luz se cuela en las esquinas); un caso borde conocido: una habitación
   cerrada vista **desde fuera** con las caras hacia dentro (un corte) da aviso.
9. **Los chequeos de interior no están en `DOCTOR_CHECKS`** (los 17 que ya tenía el Doctor) sino en el suyo,
   `INTERIOR_DOCTOR_CHECKS`, para no mover ese listado (otra fase, D1, añade sus chequeos de motor) ni el orden de los
   resultados de una escena de producto; `doctorCheck(clave)` los conoce a los dos.
10. **Cambiar a *Interior* no mueve la cámara**: pone 28 mm y la pieza se ve más pequeña hasta que K3 traiga la altura de ojo
    y el encuadre de interiores. *Crear estudio* vuelve a escribir de su tipo de producto la calidad y las muestras (como
    siempre) y no reaplica los valores del tipo de escena.
11. La mezcla de un sol con paneles en una receta (que `specIrradiance` mide en unidades distintas) obliga a *shares* de 5 a 20
    en las ventanas y las lámparas de la hora azul; los que son solo de paneles suman 1 como los demás. Es la escala del
    normalizador de siempre, no una nueva: está explicada en el comentario.

## K2 · Habitación, portales y vista exterior — **Opus**

**Qué.** Nodo `ROOM` paramétrico de `INTERIORS.md` §3.2 (ancho, fondo,
alto; aberturas con posición, tamaño y alféizar; material por superficie;
zócalo; *ocultar pared del lado de la cámara*; variante ciclorama con el
perfil de EZ Packshot), editable en el inspector y en el visor (asas en
las aberturas), guardado en el proyecto y exportado al RSB como mallas
más una sección `PORT` por abertura; **portales automáticos** también
para habitaciones importadas (heurística: cuadriláteros de vidrio o
transparentes en la envolvente), sin jerga en la interfaz; material
*Vidrio de ventana* fino no refractivo; **vista exterior** como imagen
en un plano detrás de cada ventana con paralaje opcional (sección RSB de
imagen de M2). Habitación de ejemplo procedural (*Cargar sala de
ejemplo*) con un sofá y una lámpara.

**Depende de.** U3, I3, M2 (para la imagen de la vista).

**Criterio.** Tests de geometría (aberturas recortadas con el número de
triángulos esperado, portales con el área exacta de cada hueco, pared
oculta solo en cámara); la heurística marca el vidrio de un fixture de
habitación importada y no marca un vaso; captura de la sala de ejemplo
en la vista previa.

## K3 · Cámara de interiores — **Opus**

**Qué.** `INTERIORS.md` §3.4: *shift* con cálculo automático
(*verticales rectas*, apagable), altura de ojo con presets, ópticas de
interior, **visibilidad a cámara por objeto** (en vista previa y en el
RSB), ortográfica para alzados y planta, cámara **panorámica**
equirectangular 2:1 y *fisheye* (en la vista previa, por seis caras; en
el motor, por franjas), **exposición automática** con mando EV y presets
y el multiplicador de exterior en el rayo de cámara, recorrido WASD con
altura fija. Exposición y curva como pases del estado `image`.

**Depende de.** U1, E3.

**Criterio.** Test de *shift*: con la cámara inclinada 10° las verticales
de un cubo quedan paralelas en la proyección (±0,1 px a 1080p); la
panorámica de la vista previa coincide con la del motor en seis
direcciones de prueba; la planta no muestra el techo y la habitación
sigue iluminada por él (comparación de medias); capturas.

## K4 · Motor para interiores, conjunto mínimo — **Opus**

**Qué.** `INTERIORS.md` §4, puntos 1 a 7, en `rt-core`: desplazamiento
de origen por ULP (Wächter y Binder) y BVH de dos niveles con instancias;
sol como disco con muestreo de cono y excluido del entorno; cielo
físico (hecho en E5c: la forma de Hošek–Wilkie con coeficientes propios,
sin sus tablas) e HDRI con CDF 2D; rectángulos y discos por ángulo sólido;
vidrio fino; **portales** (sección `PORT`) con tabla de área sumada por
portal y MIS; **árbol de luces** (Conty y Kulla, nodo compacto como
pbrt-v4; todas las luces si ≤ 8); *clamping* de directo e indirecto en
unidades de exposición, regularización, ruleta; **muestreo adaptativo**
por dos medios búferes en bloques; AOV (albedo, normal, profundidad,
varianza, recuento) y **denoise** à-trous demodulado guiado por varianza
al final y en previas; ajustes de *Interior* del tipo de escena pasados
por RSB.

**Depende de.** E5, K2.

**Criterio.** Escenas de prueba propias (una sala cerrada con una
ventana, una sala con doce lámparas, una mesa de cristal) con tests
numéricos: con portales el error cuadrático a 64 muestras baja al menos
a la mitad frente a sin ellos; el árbol de luces da la misma media que
muestrear todas (±1 %) con menos varianza; la imagen sin *clamping* y
con él difieren menos del 2 % en media; el *denoise* a 64 muestras queda
más cerca de la referencia de 4096 que la de 256 sin *denoise* (PSNR);
determinismo y paridad nativo/wasm intactos; hoja de contactos de las
siete recetas de interior con media, quemados y tapados.

## K5 · Guiado de caminos — **Opus**, con visto bueno **Fable**

**Qué.** Árbol SD de Müller, Gross y Novák 2017 implementado **desde el
artículo** (la referencia es GPL y no se mira): árbol espacial binario
con cuadtrees direccionales en las hojas, iteraciones que doblan las
muestras, estructura congelada por iteración y sumada entre workers sin
memoria compartida, MIS con el muestreo explícito de luz y los portales;
presupuesto de memoria configurable; encendido por defecto en *Interior*.
Portales automáticos por mapa de visibilidad como subproducto.

**Depende de.** K4.

**Criterio.** En la sala con una ventana, la misma calidad (PSNR frente a
referencia) con al menos 1,5× menos muestras que K4; sin pérdida en la
botella de producto (±2 % de tiempo); memoria del árbol por debajo del
presupuesto en las tres escenas de prueba.

## K6 · Entregables de mobiliario — **Sonnet**

**Qué.** `INTERIORS.md` §3.7 sobre N2: silo sobre blanco con alfa y con
cotas (dimensiones de la caja envolvente dibujadas en una capa), hoja de
**variantes** de tela y acabado de una escena (lista de materiales ×
piezas → lote), panorámica por franjas en el navegador, alzados y planta
como trabajos de lote, plantilla de nombre con variante.

**Depende de.** K3, N2.

**Criterio.** Un lote de 3 variantes × 2 vistas produce 6 imágenes con
nombres correctos; la panorámica 4096 × 2048 se ensambla sin costuras
(test de continuidad en los bordes de franja); captura de una hoja de
variantes.

## K7 · Activos de ejemplo e interiores en CI — **Sonnet**

**Qué.** Habitación de ejemplo procedural con sofá y lámpara (K2) y, como
activos descargables bajo demanda y nunca en el paquete base, una
selección de Poly Haven (modelos de mobiliario, CC0) y ambientCG
(texturas, CC0) con **licencia y origen registrados por archivo** en un
`assets.json`; **ningún HDRI de terceros** (decisión del usuario,
`STUDIO-TOOLS.md` §2: los entornos son recetas propias); nada de Quaternius ni 3D Warehouse;
atribución para Khronos si se usa. Hoja de contactos de interiores en CI
con `rt`.

**Depende de.** K2, K4.

**Criterio.** Test que falla si un activo no tiene licencia registrada o
si su licencia no está en la lista permitida; la hoja de contactos sale
en CI.

## K8 · Grupos de luz tras el render — **Opus**

**Qué.** Al estilo *LightMix*: cada luz (y el sol, el cielo y los
emisores) pertenece a un **grupo**; el motor emite un pase por grupo
(suma lineal) y la interfaz ofrece, tras el render o en el visor, un
mezclador con intensidad y color por grupo cuya salida es una
combinación lineal; guardar la mezcla como ajuste de la escena (aplica
los factores a las luces reales) y como variantes (*día*, *atardecer*,
*noche*) para la cola.

**Depende de.** K4.

**Criterio.** La suma de los pases por grupo es igual al render completo
(±1e-4); una mezcla guardada y re-renderizada coincide con la mezcla
(±2 %); captura del mezclador.

## P1 · Releases y demo pública — **Haiku** — hecha (v0.1.0)

**Qué.** Petición del usuario: la primera release con **Windows
portable**, **Linux portable** e **instalador de Windows**. Mientras
GitHub Actions no tenga minutos, la release se construye **en local** con
`npm run release` (de P2: `packaging/release.mjs`), que deja en
`out/release/` los tres paquetes, sus `sha256` en `SHA256SUMS.txt` y las
notas. Versión en `package.json` y en el workspace del motor, etiqueta
`vX.Y.Z` creada al publicar, `docs/CHANGELOG.md` desde el principio,
notas de la release en inglés (qué hay, qué no, requisitos: Windows 10/11
x64 con Edge, Linux x86_64 con un navegador Chromium, aviso de
SmartScreen por no estar firmado). Se deja escrito el workflow
`release.yml` que hará lo mismo en CI al subir una etiqueta, y el de
GitHub Pages para la demo, para cuando vuelva a haber minutos.

**Depende de.** P2.

**Criterio.** `npm run release` reproduce los tres paquetes desde un
árbol limpio; `SHA256SUMS.txt` cuadra; la etiqueta apunta al commit de la
release; el CHANGELOG lista las fases hechas.

**Hecho.** `docs/CHANGELOG.md` con la v0.1.0 y sus limitaciones,
notas en inglés en `docs/release-notes/v0.1.0.md` (la ruta que lee
`release.yml`), y `npm run release` desde el commit etiquetado `v0.1.0`:
Windows portable, Linux portable e instalador de Windows, comprobados
con `packaging/smoke.mjs` (nativo y bajo Wine, *hash* fijado) y
`sha256sum -c`. La release se publica a mano desde la etiqueta mientras
no haya minutos de Actions. El motor conserva su propia versión (0.3.0);
la de la aplicación es la de `package.json`.

**Cómo se publica ahora (desde la 0.1.4).** Con minutos de Actions, la
release la publica `release.yml` lanzado a mano (*workflow_dispatch*)
**en `main`**, con `tag` = `vX.Y.Z` (la versión de `package.json`) y
`commit` vacío o un commit que ya esté en `main`: construye, crea la
etiqueta y la release en ese commit y sube los cuatro archivos. La sesión
no necesita subir etiquetas. Lanzado desde otra rama, GitHub rechazó crear
la release con *Resource not accessible by integration* (dos veces, con la
0.1.4); desde `main` salió a la primera. El workflow ahora se para en el
primer paso si una publicación no se lanza en la rama por defecto. Sin
`tag`, cualquier rama sirve para construir el artefacto de prueba.

**Con un plugin (desde la 0.1.6).** El paquete `.rpk` que nombra
`src/data/plugins.json` (su `url` apunta a los *assets* de la release de esa
versión) se sube a mano a la release una vez publicada, con la API REST
(`gh release upload <tag> <archivo>`), y se comprueba contra el `sha256` y
los `bytes` del registro; la clave de activación no se sube a ningún sitio
(`docs/release-notes/plugins.md`).

**Con las capturas de la versión.** Las notas de cada release
(`docs/release-notes/vX.Y.Z.md`) llevan las capturas nuevas de esa versión:
las que `docs/GALERIA.md` guarda bajo *Sin publicar*, que el PR de versión
mueve bajo la versión nueva. El cuerpo de una release se lee fuera del
repositorio y no resuelve rutas relativas, así que cada imagen va con URL
absoluta y la etiqueta de esa misma versión (se crea al publicar):
`https://github.com/Grohle-developer/Repackshot/raw/vX.Y.Z/docs/ui/<archivo>.png`.

## P2 · Escritorio: lanzador propio, portables e instalador — **Opus** — hecha

**Decisión tomada (Fable), sustituye a la de Tauri.** El escritorio es
un **lanzador propio en Rust solo con `std`** (`engine/crates/rt-app`,
binario `repackshot`), descrito en `ARCHITECTURE.md` §5.5: servidor local
de la interfaz con *token* y comprobación de `Host`, ventana de
aplicación de Edge o Chromium con perfil propio, **motor nativo** con
todos los hilos, carpeta de datos (o `data/` en modo portable), almacén
de modelos con SHA-256 propio y detección del equipo. Tauri se descarta
porque necesita crates.io (bloqueado aquí) y compilar en Windows (sin
minutos de Actions), y el lanzador propio mantiene el proyecto sin
dependencias en Rust.

**Qué.**
- `rt-app`: servidor HTTP/1.1 mínimo (estáticos con tipos MIME, `Range`,
  API con *token*), apertura de la ventana y fin de la aplicación al
  cerrarla, instancia única, registro en la carpeta de datos; API:
  `/api/info`, `/api/render` (RSB → pasadas acumuladas en `f32`, con
  cancelación), `/api/models/*` (listar, escribir por trozos con
  desplazamiento, reanudar, comprobar, borrar, servir con `Range`),
  `/api/hardware`, `/api/open-folder`; línea de órdenes `--hardware
  <fichero>` (INI que lee el instalador), `--serve-only` (sin ventana,
  para pruebas) y `--version`. SHA-256 propio con los vectores del NIST.
  La regla de recomendación evaluada sobre `src/data/ai-models.json` con
  el mismo fichero de casos que el test de TypeScript.
- En `src/`: `render/native.ts` (`RenderEngine` contra `/api/render`,
  elegido cuando `/api/info` responde; el modo Completo y el Render lo
  usan) y `io/native.ts` (almacén de modelos y carpeta de datos del
  lanzador) detrás de las mismas interfaces que la web; sin más cambios.
- `packaging/`: `release.mjs` (construye la interfaz y los dos wasm,
  compila `repackshot` para `x86_64-pc-windows-gnu` con mingw-w64 y para
  `x86_64-unknown-linux-musl` estático, y monta los paquetes), el
  **portable de Windows** (`Repackshot-<v>-windows-x64-portable.zip`:
  `repackshot.exe`, `app/`, `portable.txt`, licencias), el **portable de
  Linux** (`Repackshot-<v>-linux-x64-portable.tar.gz`, igual, más un
  `.desktop` de ejemplo; AppImage si la herramienta se puede obtener con
  licencia permisiva) y el **instalador de Windows** con NSIS
  (`Repackshot-<v>-windows-x64-setup.exe`): por usuario, sin permisos de
  administrador, en `%LOCALAPPDATA%\Programs\Repackshot`, con licencia,
  carpeta, accesos en Inicio y opcional en el escritorio, desinstalador
  registrado, el paso **Modelos de IA** (`AI-POST.md` §2.2: lee el INI de
  `repackshot --hardware`, marca el recomendado, uno, varios o ninguno,
  licencia visible, y deja la elección para que la aplicación la
  descargue) y *Abrir Repackshot* al terminar. Icono de la aplicación
  acromático, generado desde `docs/media/logo.svg`.

**Depende de.** U5, U6 para el paso de modelos y el almacén; puede
empezar antes por el lanzador y el motor nativo.

**Criterio.** Tests de `rt-app` (`cargo test`): SHA-256 con los vectores
del NIST; el servidor rechaza un `Host` ajeno y una API sin *token*;
`Range` devuelve los bytes pedidos; un modelo escrito por trozos
desordenados y reanudado da el `sha256` esperado; la regla de
recomendación con el fichero de casos. Paridad: la misma escena por
`/api/render` y por el wasm da el mismo *hash*. El `.exe` arranca bajo
Wine con `--serve-only` y sirve la interfaz (comprobación de humo; la
ventana real se prueba en Windows por el usuario). El portable de Linux
arranca, abre la ventana con el Chromium local y renderiza en nativo
(captura `docs/ui/desktop-linux.png`). El instalador se construye con
`makensis` sin avisos.

**Hecho.** `engine/crates/rt-app` (binario `repackshot`, solo `std`, sin
`unsafe`): servidor HTTP/1.1 en `127.0.0.1` con comprobación de `Host`
(421), *token* de 128 bits por arranque en el fragmento de la URL (401) y
`Origin` ajeno rechazado (403); ventana de Edge o Chromium con perfil
propio, instancia única y fin al cerrar o al faltar el latido; **motor
nativo** por `/api/render` que repite el bucle de `rt` y da el mismo
*hash* que `rt` y el pool wasm (`0x223515c3` en el ejemplo, con 1 y 4
hilos, también el `.exe` bajo Wine), con *Terminar por* muestras, tiempo
o lo primero, cancelación y sumas `f32` para PNG de 16 bits y EXR;
almacén de modelos **por `sha256`** con SHA-256 propio, escritura por
trozos desordenados y reanudación; detección del equipo y la regla de
recomendación en Rust y TypeScript sobre el mismo fichero de 36 casos,
con la memoria leída como *medida / 0,94*. `packaging/release.mjs`
(`npm run release`): Windows portable (zip), Linux portable (tar.gz,
binario musl estático) e instalador NSIS (por usuario, inglés y español,
paso de modelos de IA, desinstalador), con icono propio acromático,
avisos de terceros (three, rhino3dm, occt-import-js con sus licencias y
fuentes) y `SHA256SUMS.txt`; tres construcciones dan los mismos bytes.
846 tests web y 241 del motor. Captura `docs/ui/desktop-linux.png`.

No encajó con el plan: AppImage solo bajo demanda (su *runtime* enlaza
libfuse LGPL); instalador solo de 64 bits; en las filas del instalador no
caben resumen, calidad ni velocidad; en Windows `--version` solo se ve
redirigido (subsistema gráfico); sin probar en un Windows real (Edge por
App Paths, VRAM con drivers reales, el instalador pulsado a mano,
SmartScreen: el `.exe` no está firmado).

## Q1 · Vista en sección — **Sonnet** — hecha

**Qué.** Plano de corte por clic + eje, por dos puntos, o animado como un
movimiento más (`MOVE_KINDS` gana `SECTION`); se implementa en el
integrador (descartar la parte del plano, tapar con el color del
material) y en la vista previa con `clippingPlanes` de three.

**Depende de.** E3, N1.

**Criterio.** Una comparación por regiones como la de
`tests/textures-full-browser.test.ts`: la botella de ejemplo cortada por
la mitad, con el `rt.wasm` real por el escritor de la página frente a
*Rápido* (three.js en Chromium), y el acuerdo dicho en números. Tests que
fallan sin la función: plano desde clic + eje y desde dos puntos, ida y
vuelta por RSB, el motor descarta el lado quitado y tapa las mallas
cerradas (una caja cortada por la mitad: área y color de la tapa),
interpolación de `SECTION`, deshacer y rehacer, determinismo con 1, 4 y
16 hilos, paridad wasm (`rt --write-q1-example` con su *hash* fijado y un
bloque en `.github/workflows/engine.yml`).

**Hecho.** (1) *Dato*: `state.section` (`core/section.ts`), un solo plano
por proyecto: `{ enabled, point, normal, cap }` con la normal hacia el
lado que **se quita**; acciones `section/set|patch|enable|flip|clear` por
el *store* (deshacibles, un arrastre es una entrada, nada para lo que no
cambia), guardado en el proyecto (un archivo anterior se abre sin plano).
Se pone de tres maneras: **clic en la pieza + eje** (X, Y, Z o la normal
de la superficie; se quita el lado que mira al espectador), **dos
puntos** (el plano contiene los dos y la dirección de la vista; se quita
lo que queda a la izquierda de la línea del primero al segundo) y
**números** (punto y normal); más *Cambiar de lado*, *Tapar el corte* y el
interruptor, que sin plano hace uno por el centro del producto, de cara a
la cámara. (2) *Animación*: `SECTION` es un movimiento más de
`MOVE_KINDS`, sobre la escena (`{ kind: 'SCENE' }`, como `HDRI`): su
cantidad es el desplazamiento del plano a lo largo de su normal en
tamaños de pieza (negativa corta más adentro, positiva descubre; por
defecto −0,5), con la curva del clip, suma con otros clips y se parte sin
salto; `Pose.sectionOffsetMm` lo lleva a los dos motores. (3) *Motor*
(`geometry/section.rs`, `geometry/solid.rs`): el plano vive **dentro de
`Geometry`**, así que cámara, reflejos, refracciones, sombras, fotones,
selección y pases ven lo mismo sin tocar los núcleos SIMD ni el
integrador: un rayo se recorta al intervalo en que está en el lado que
queda (un semiespacio corta un rayo en un intervalo, y `t` es el mismo en
el mundo y en el espacio de la malla) y es un rayo corriente con otro
`t_min` y `t_max`. **La tapa** va donde el corte pasa por dentro de un
sólido cerrado: la primera superficie que el rayo encuentra tras el plano
se ve **por detrás** (`Solid::inside_before`), y entonces el cruce estaba
dentro; el impacto es plano, sobre el plano, con la normal del plano de
cara al rayo y el material del sólido (sin textura, dibujo, programa ni
bisel: el color liso). El análisis de sólido (soldar vértices por
posición y luego con tolerancia, cada arista compartida por exactamente
dos triángulos en sentido contrario, volumen con signo para el sentido)
se hace una vez por malla (`SolidCache`) y lo repite en TypeScript
`core/solid.ts` para que *Rápido* tape las mismas piezas. (4) *Formato*:
sección `SECT` nueva (20 B: `u32 flags` con el bit 0 = tapar, `f32
normal[3]`, `f32 distance`), a lo sumo una, después de `FXAM` y antes de
`IMGS`, `BMAP` y `ENVR`; sin plano no se escribe (los bytes de antes);
bit nuevo de `rt_features` (4) y de `/api/info`. (5) *Vista previa*
(`render/section-preview.ts`): un `THREE.Plane` compartido por todos los
materiales del modelo (lejos cuando no hay sección: los *shaders* no
cambian al encenderla), tapa con una copia de la geometría de cada pieza
cerrada que pinta solo las caras de atrás con el material de la pieza y
la normal del plano (el equivalente al *stencil*), materiales a doble
cara mientras se corta, y la selección, la caja de selección (que mira los vértices cuando
la caja de la pieza queda cortada), el contorno y el cardán (que se oculta
para una selección que el corte se ha llevado entera) ignoran lo quitado. (6) *Interfaz*: sección **Sección** del
inspector de Escena (decisión y por qué abajo), modos de clic con
aviso en el visor y `Esc`, acciones de la paleta *Vista en sección:
activar o desactivar* y *cambiar de lado*, frases del movimiento, todo en
`es` y `en`. (7) *El estudio no se corta*: las piezas de un set
(*Backdrop*, *Floor*, tarjetas) no son el modelo; el escritor las marca
con el bit 1 de `INST.flags` (`INSTANCE_NO_SECTION`, solo mientras corta
un plano) y el motor las busca también en el lado quitado, saltando
las superficies del modelo cortado (como mucho 48; una escena sin
instancias marcadas no toma ese camino); *Rápido* les da una copia del
material sin plano.

*Medido.* **Región** (`tests/section-full-browser.test.ts`, botella
cortada por el eje con un plano a través de la cámara, 300 × 220, 32
muestras; el motor es el `rt.wasm` real por `projectScene` + `writeRsb`):
el acuerdo por píxel en lo que ambas imágenes dan por asentado es de
**1,000** (8 903 píxeles), la unión de las secciones de cuerpo, tapón,
collar y núcleo se solapa en **0,963** (IoU) y, por clase, cuerpo 0,962,
tapón 0,948, collar 0,839 (un anillo de unos milímetros) y el disco del
núcleo escondido dentro del cuerpo 0,977 (solo la primera superficie
tras el plano puede decirlo). Sin tapas el corte deja de ser plano en las
dos imágenes (irregularidad del brillo 0,054 frente a 0,027 en *Rápido*,
0,100 frente a 0,034 en el motor) y por tono coinciden en 1,000. Los
controles se caen como deben: el plano del motor movido 15 mm deja el
núcleo en 20 píxeles frente a los 1 954 de *Rápido* (acuerdo 0,74) y
cambiado de lado, 19 (acuerdo 0,46). El **estudio**: un suelo de set bajo
la botella tiene 31 335 píxeles en *Rápido* y 31 317 en el motor
(IoU 0,996) y llena la franja de abajo del cuadro (1,00 y 1,00); el mismo
suelo como pieza corriente se corta en las dos (20 512 y 20 809,
IoU 0,983; franja de abajo 0,00 y 0,00); el cardán y la selección en caja
no alcanzan la etiqueta que el corte se llevó entera y sí el cuerpo y el
tapón. Capturas: `docs/ui/section-fast.png` y `docs/ui/section-full.png`
(`tools/section-check.mjs`). **Fijado**:
`PINNED_Q1_SECTION_4SPP = 0x7a4182ea` (la escena de E5 cortada por `x = 0`,
con su suelo lacado como estudio, igual en escalar, SSE2 y AVX2, con 1, 4 y
16 hilos, en wasm escalar y `simd128`); ningún *hash* de antes se movió
(la escena sin plano es la de E5 bit a bit). **Coste**: a 640 × 480 y 32
muestras con 4 hilos, la escena cortada da 4,99 Mrayos/s frente a 4,74 de
la de E5 sin plano (con la mitad quitada baja de 7,1 s a 6,4 s); el
camino del estudio no se nota.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
Fable: queda anotado, no decidido).

1. ◆ **Dónde vive el control**: en el **inspector de Escena**, entre
   *Ambiente* y *Cámara*, plegado y con el interruptor en la cabecera, y
   no en la barra del visor. Es un objeto de la escena guardado y
   animado, como el entorno y el ambiente; las herramientas de la barra
   son de navegación y transformación. Los modos de clic sí avisan en el
   visor. El recorrido guiado no lista *Ambiente* ni *Sección*, así que no
   gana paso.
2. ◆ **Tapa de un vidrio.** En el motor un sólido de vidrio cortado tiene
   una tapa que **refracta** (físicamente es un vidrio cortado, que se
   ve a su través); *Rápido* la dibuja como vidrio transparente. Una
   tapa **opaca** del color del vidrio sería una opción de cara al
   fotógrafo; no se hizo. La interfaz lo dice en una nota.
3. ◆ **El estudio no se corta.** El brief decía "un lado del modelo"; se
   entendió así (un suelo cortado deja el producto flotando sobre el
   fondo). Cualquier otro uso del plano sobre el estudio (cortar el
   fondo para ver detrás) no se puede pedir hoy: no hay interruptor por
   pieza.
4. **Mallas abiertas, sólidos al revés y piezas con material por cara.**
   Una malla abierta no tiene dentro: el corte enseña su interior (y se
   dice en una nota con las piezas). Un sólido cerrado con las caras al
   revés lo tapa el motor (decide por el signo del volumen) y *Rápido* no
   (lo trata como abierto). Una pieza con un material por cara no se tapa
   en ninguno (el motor ve cada grupo como una lámina) y un vidrio de
   pared fina tampoco.
5. **Límites conocidos del motor**: un rayo de `t_max` finito que entra
   en el lado que queda dentro de un sólido y acaba antes de salir no ve
   la tapa (la siguiente superficie queda más allá de su final), y una
   malla emisiva muestreada como luz sigue alumbrando desde su parte
   quitada.
6. **Pases de *Rápido* para la IA** (profundidad, normales,
   identificadores) no conocen el plano; el color sí. La IA del
   post-procesado recibiría la pieza entera con el color cortado.
7. **El abierto en *Rápido* y en el motor** no se pinta igual: la copa de
   la base, que es una malla abierta, se ve por dentro en los dos pero
   con 509 píxeles amarillos frente a 339 (IoU 0,24 en esa clase: el
   interior de una copa fina depende del sombreado de cada uno); lo que
   se compara de las mallas abiertas es que el corte deje de ser plano.
8. `FEATURE_SECTION` (bit 4) lo publican el módulo y el lanzador, pero la
   interfaz no lo usa: los dos motores que se publican cortan. Un
   `rt.wasm` viejo en `public/engine/` mostraría la pieza entera en
   *Completo* sin avisar (se arregla con `npm run engine:build`).

---

## H1 · Accesibilidad e i18n — **Haiku**

**Qué.** Orden de foco de todos los paneles, `aria-label` en cada icono,
contraste ≥ 7:1 verificado por test sobre los *tokens*, `prefers-reduced-motion`,
revisión de las cadenas `es` (acentos, tono) y `en`, documentación
sincronizada con lo hecho (README, SPEC) tras cada hito.

**Depende de.** U1; se repite al cierre de cada versión.

**Pasada v0.1.16** (2026-10-17). **Hecho:**

- **Contraste** (`tests/ui-contrast.test.ts`): cada texto (`ink-0` a `ink-3`, y `inv-ink`) medido sobre sus superficies en los cuatro temas, con la razón WCAG de los tokens. `ink-0`, `ink-1` y el invertido pasan 7:1 en todas. **36 pares** quedan por debajo y están listados como pendientes: `ink-2` (claro 3,8–5,3:1; oscuro 5,1–6,9:1) e `ink-3` (claro 2,0–2,8:1; oscuro 2,7–3,6:1) sobre todas las superficies, y `ink-3` en alto contraste (claro 5,1–6,6:1; oscuro 5,5–6,3:1). Ningún token cambia; el test falla ante un par nuevo por debajo de 7:1 y ante un par pendiente que ya llega.
- **Nombres** (`tests/a11y-browser.test.ts`): en Chromium, 20 estados de la interfaz (paneles, cajones, ventanas, Ajustes, guía, recorrido, Doctor, editor de materiales, menús y paleta) en español y en inglés. Cada botón sin texto tiene su nombre de `strings.ts`. No faltaba ninguno; el test quita el nombre de *Deshacer* y falla con 16 botones.
- **Foco.** La paleta sacaba el foco con Tab y Escape no funcionaba fuera del campo: ahora Tab se queda en ella, Escape la cierra desde cualquier sitio y el foco vuelve al control que la abrió. Menús y confirmaciones dan vueltas con Tab y devuelven el foco al botón que los abrió; una ventana abierta desde el menú principal (*Ajustes*) lo devuelve al botón del menú. Sin `tabindex` positivo; el orden de Tab no vuelve atrás en ninguna columna (`tests/a11y-static.test.ts`).
- **Movimiento.** *Reducir movimiento* no apagaba el desplazamiento suave del tira de plugins de la ventana de render: ahora sí (`theme.css`). Con la preferencia emulada, ningún elemento transiciona ni se anima. La interfaz no tiene animación en JavaScript: el guía y el recorrido solo siguen posiciones.
- **Cadenas.** Revisadas las 2.997 cadenas en los dos idiomas: sin acentos que falten, sin signos de apertura que falten, sin erratas detectables, y el español usa tú en todo. Un cambio: *Center* pasa a *Centre*. Dos guardas en `tests/strings.test.ts`.
- **Documentación.** SPEC §6 (accesibilidad), README (una línea y los dos tests nuevos), CHANGELOG (*Sin publicar*).

**Qué no encajó:**

- **Decisión Fable: grises auxiliares.** Para 7:1 sobre todas sus superficies, `ink-2` e `ink-3` tendrían que ser `#434343` o más oscuros en claro y `#b5b5b5` o más claros en oscuro; eso iguala los tres grises y la jerarquía pasa a depender del peso y del tamaño. Alternativa: 7:1 solo sobre `bg-0`, `bg-1` y el *hover*, con `ink-2` de `#4e4e4e` o más oscuro en claro y `#afafaf` o más claro en oscuro, y sin texto sobre `bg-2`, `bg-3`, *soft* ni *overlay*. En alto contraste, `ink-3` de `#434343` o más oscuro (claro) y `#c1c1c1` o más claro (oscuro). Al cambiar un token, se quitan sus pares de `PENDING` en el test.
- Las cadenas en inglés con espacio antes del % (`10 %`) siguen la convención SI que usa también el español: se dejan.
- El README está en inglés en su conjunto; el párrafo nuevo también, para no mezclar idiomas en el archivo.
- **Sin auditar en el navegador, pendiente para una pasada posterior.** Los nombres de los botones se comprueban en la ventana de render (*imagen* y *animación*), el editor de materiales y Ajustes (*General* y *Motor*); el foco no se comprueba en ninguna de estas. Quedan fuera por completo: la hoja de importación; el visor de resultados (necesita un render terminado); las subsecciones de Ajustes distintas de *General* y *Motor*; y las confirmaciones de *Liberar* en el almacenamiento (necesitan modelos instalados). La ventana de render y el editor de materiales no son modales a propósito: no atrapan el foco, y su Escape no se ha verificado.
- **Para N1** (animación, no tocado): `src/ui/panels/anim-props.ts:327` da `role="listitem"` a los botones de los presets, con lo que dejan de anunciarse como botones; `src/ui/panels/animation.ts:115` pone `role="tree"` en el contenedor de filas enfocable (las filas sí son `treeitem`). Arreglo pequeño: un botón con su propio rol dentro de la lista.

---

## Decisiones pendientes de Fable (no adelantar)

- **I2**: decidido: `occt-import-js` (LGPL-2.1) como única excepción
  LGPL, aislada con las condiciones de `ARCHITECTURE.md` §1. Pendiente:
  el **eje arriba** de STEP e IGES (hoy Z); SolidWorks y Creo exportan
  con Y arriba, así que se valora leer `originating_system` de la
  cabecera del STEP para elegirlo, y el **aspecto de catálogo** para los
  colores CAD (hoy SIMPLE, rugosidad 0,5).
- **Escritorio**: decidido: lanzador propio solo con `std` en lugar de
  Tauri (`ARCHITECTURE.md` §5.5); instalador NSIS; el instalador elige
  los modelos y la aplicación los descarga (`AI-POST.md` §2.2).
- **Post-procesado IA** (`AI-POST.md`): el modelo por defecto
  (provisional: Z-Image-Turbo) y las tolerancias de la guarda, tras la
  comparación de X1.
- **Interiores** (`INTERIORS.md`): ~~licencia exacta de las tablas de
  Hošek–Wilkie~~ (resuelto en E5c: no se usan; cielo propio con la forma
  publicada y coeficientes ajustados a nuestro simulador); si se activa el aislamiento
  de origen cruzado para compartir la escena entre workers; número de
  luces a partir del cual entra el árbol.
- **Formatos nativos** (`.bip`, `.ksp`, `.sldprt`, `.ma`, `.ztl`, `.f3d`):
  decidido que **no** se leen (propietarios, sin especificación pública;
  leerlos exigiría analizar sus binarios, que las reglas de sala limpia
  prohíben). La entrada es lo que cada programa exporta (`SPEC.md` §5).
  Se revisa solo si aparece una especificación pública o una biblioteca
  MIT/Apache que los lea.
- **E4**: decidido por el usuario: dos modos explícitos, *Rápido*
  (three.js) y *Completo* (trazador siempre, a menos resolución durante
  los gestos), con conmutador en la cabecera; *Render* siempre con el
  trazador. Queda por decidir solo el umbral de resolución reducida.
- **E8**: cómo renderiza `rt` una animación (portar `evaluate` a Rust o
  un RSB por fotograma).
- **L3**: los números de las recetas sobre el motor propio.
- **E7**: umbrales del desgaste sobre la hoja de contactos.
- **UI**: si tras U1 el inspector contextual necesita una pestaña
  *Biblioteca* separada (la decisión de `UI.md` es que no; se revisa con
  uso real).

---

## Tras probar v0.1.0: arreglos de escritorio y todo lo *próximamente*

Petición del usuario (2026-10-13), tras probar el instalador en Windows:
el modo Completo se queda parado al rato de hacer cambios; la cola no se
pausa ni se reanuda; no se puede arrastrar un material a una pieza; elegir
carpeta falla (*no se puede abrir esta carpeta porque contiene archivos del
sistema*); y la ventana se comporta como una web (ofrece traducir, no sale
el logo, el clic derecho y la selección de texto sacan menús del
navegador). **Decisión: en escritorio no aparece nada que no sea nuestra
interfaz**, la interfaz sigue en HTML y todo lo demás (diálogos de archivo,
escritura de archivos, motor) lo hace el lanzador en Rust. Además: **se
integra todo lo que la interfaz marca *próximamente***.

| Fase | Responsable | Qué |
| --- | --- | --- |
| **P3a** (hecha) | Opus | Modo Completo que no se para (reproducir con una sesión larga de cambios contra el lanzador y arreglar la causa), *Pausar* / *Reanudar* / *Iniciar cola* que funcionan en web y escritorio |
| **P3b** | Opus | Escritorio sin rastro de navegador: diálogos nativos de carpeta y archivo desde el lanzador (PowerShell en Windows, `zenity`/`kdialog` en Linux, sin `unsafe`), escritura de renders, proyectos y modelos por el lanzador, menú contextual, selección, traducción, zoom, recarga, impresión, búsqueda y navegación del navegador desactivados, icono y título propios; estudio de WebView2 para Windows |
| **P3c** | Opus | **Ventana propia en Windows** (decisión del líder tras la captura del aviso «¿Desea salir de la aplicación?» de Edge: *todos los avisos y ventanas con nuestra interfaz, nada de avisos web; producto cerrado y profesional*): ventana Win32 sin marco con **WebView2** (el motor de Edge que trae Windows 10/11) y barra de título dibujada por nosotros (título, minimizar, maximizar, cerrar, arrastre), menús contextuales, atajos, barra de estado, zoom, autorrelleno, traducción, descargas y diálogos de script del navegador **desactivados por la API**, y el cierre (botón, `Alt F4`, barra de tareas) **interceptado** para preguntar con nuestra propia ventana si hay cambios sin guardar; Edge `--app` solo como respaldo automático si falta el *runtime*. En Linux sigue Chromium en modo aplicación con el endurecimiento de P3b hasta P3d (ventana propia con WebKitGTK, que exige un binario glibc y no el musl estático) |
| **P3e** | Opus | **Escritorio: todo sobre el lanzador** (decisión del líder tras «se pisa el texto» y «dice no pillar la GPU por ser browser»: *en escritorio la página es solo interfaz*): una costura de plataforma con implementación web y de lanzador; ajustes, biblioteca, historial, miniaturas, equipo y espacio usado en la carpeta de datos por el lanzador; puerto estable por carpeta de datos; ni una fila que hable del navegador; filas de Ajustes que no se pisan |
| **U7** (hecha) | Sonnet | Arrastrar un material (miniatura del catálogo o de *Míos*) sobre una pieza del visor o del árbol, con resaltado (`UI.md` §2.3), y **M1** (cara CAD entera y *Separar por caras CAD*), más selección por caja con `Ctrl/⌘` + arrastrar. Ver U7 y M1 más arriba |
| **E5** | Opus | Ya descrita: vidrio y transmisión, barniz, emisores reales, cielo, HDRI, imagen de fondo |
| **E5b** | Opus | Reflejo del suelo, efectos de imagen (halo, nitidez, saturación, contraste, viñeta), región de render, pases (alfa, profundidad, normales, id de pieza), cáusticas y *denoise* propio |
| **E5c** (hecha) | Opus | Cielo físico propio en sala limpia: la forma de Hošek–Wilkie con coeficientes ajustados a nuestro simulador de atmósfera (`rt-sky`), *Físico · Clásico* en *Entorno*. Ver E5c más arriba |
| **E6**, **E7** | Sonnet, Opus | Ya descritas: madera, tela, bisel, subsuperficie (la anisotropía llegó con E5); desgaste visible en motor y visor |
| **L4**, **L5** | Opus, Sonnet | Ya descritas: focos propios (área, punto, foco, sol) con todas sus operaciones; IES |
| **M2** | Opus | Ya descrita: texturas de imagen y etiquetas |
| **N1**, **N2** | Opus, Sonnet | Vídeo codificado (WebCodecs y muxers MP4 y WebM propios) y lo que quede de pases y lotes |
| **U8** | Sonnet | Lo pequeño de la interfaz: copia automática y recuperación, letras de acceso en menús, cambiar atajos, *Buscar actualizaciones*, los chequeos del Doctor que faltan y sus *Arreglar* (**D1**) |
| **X1b–X4** | Fable, Opus, Sonnet | Ya descritas: el post-procesado IA completo (X3 partida en X3a–X3d, `AI-POST.md` §7) |

**P3a hecha.** Reproducido de verdad con una sesión larga de cambios
contra el lanzador (`tools/viewport-stress.mjs`, nuevo): en la v0.1.0, a
los 90–300 s ninguna petición a `/api/render` volvía a contestarse, y
`gdb` mostraba los hilos HTTP del lanzador bloqueados escribiendo tramas
que nadie leía. **Causa principal (solo nativo)**: al sustituir una vista,
la página abandonaba el sondeo de la anterior sin leer ni cancelar su
respuesta; cada respuesta sin leer retiene una de las seis conexiones
HTTP/1.1 que Chromium (y WebView2) abre al lanzador, y con las seis
retenidas todas las peticiones esperan para siempre. Eso explica los tres
síntomas que vio el usuario (la imagen vieja con el contorno nuevo encima;
*Rápido → Completo* en gris con «0 muestras»; un render que no acaba nunca,
con *Completo · en pausa mientras se renderiza*) y la mitad nativa de la
cola que no se pausa (*Pausar* no llegaba al lanzador). Otras causas, cada
una con su test: las peticiones de *Render* no llevaban la señal de
cancelación; una vista que el lanzador olvidaba (404) o rechazaba (503) no
se volvía a pedir, y a resolución reducida su «fotograma en vuelo» quedaba
marcado para siempre; dos vistas podían salir a la vez y llegar al revés;
en el pool, pasar a *Rápido* durante un fotograma reducido dejaba esa misma
marca puesta y *Completo* no volvía a arrancar; en el lanzador, una
escritura fallida se vaciaba otra vez con el plazo de 120 s, los trabajos
de páginas que se fueron seguían renderizando, las recargas llenaban los 8
sitios de ventana (`503 busy`, lo que encontró P3e), un render que entrase
en pánico no terminaba nunca y un trabajo atascado bloqueaba al siguiente;
y el bucle de animación de `main.ts` se paraba para siempre con cualquier
excepción.

Arreglos: en `render/native.ts`, toda respuesta se lee, se cancela o se
aborta; una vista cada vez, numerada (`seq`); las rechazadas o perdidas se
piden otra vez con espera creciente y el medidor dice por qué; todas las
peticiones llevan la señal; la página cancela sus trabajos en `pagehide`.
En el lanzador: `409 stale` para una vista que llega tarde, la escritura de
una trama sin leer se corta a los 10 s, los trabajos por los que nadie
pregunta se paran solos (visor 10 s, final 20 s), con los 8 sitios
ocupados una ventana que lleva 3 s callada cede el suyo, un pánico termina
el trabajo como fallido y suelta la puerta, y `GET /api/render/state` da el
diagnóstico (con `log=1`, también al registro). Un *watchdog* en los dos
motores (`render/watchdog.ts`) vuelve a arrancar la vista si el lanzador
deja de contestar, si no llegan pasadas o si llegan y no se pintan, lo
dice en la consola y en el registro del lanzador, y el medidor dice el
motivo: nunca «0 muestras» en silencio.

**Decisión del líder** (con la captura del usuario: el visor estaba *en
pausa mientras se renderiza*): **el visor sigue vivo mientras se
renderiza**, compartiendo el equipo. En nativo se queda con la cuarta
parte de los hilos (al menos uno) y el render con el resto, o con todos
cuando el visor ha convergido; en el pool, con la cuarta parte de los
workers. El medidor lo dice (*Completo · compartido con el render · 4 de 16
hilos*) y *Ajustes ▸ Motor de render ▸ Mientras se renderiza* lo elige
(*Mantener el visor vivo (compartido)*, por defecto, · *Pausar el visor
(render más rápido)*). El render da los mismos bits con o sin visor (tests
en Rust, también contra el *hash* fijado con 16 hilos, y en el navegador
el mismo archivo `4e3aa886…` en los dos motores).

**La cola**: el botón de la v0.1.0 pasaba a *Iniciar cola* en cuanto se
pulsaba *Pausar*, con el trabajo aún terminándose, y un *Reanudar* pulsado
entonces se perdía. Ahora hay un estado *En pausa*: el botón dice *Pausar*
mientras corre, *Reanudar* tras una pausa e *Iniciar cola* si no
(desactivado sin nada en espera); *Pausar* para el trabajo y libera el
motor (473 ms hasta que el lanzador no tiene ningún final; 167 ms en el
pool) y *Reanudar* sigue con lo pausado (solo el trabajo de *Render* si era
eso; el trabajo pausado vuelve a empezar).

Tests: 23 nuevos en la web, con un lanzador simulado que modela las seis
conexiones (los simulados de antes contestaban todo al momento, y por eso
se escapó), y 13 nuevos o rehechos en Rust (4, 16 y 32 hilos); cada
arreglo, quitado de uno en uno, hace fallar su test (18 mutaciones en
TypeScript y 15 en Rust). El test de tiempos de un final en cola mide el
reloj del propio trabajo y no lo que tarda la máquina (10 de 10 con otra
compilación en marcha). Sesiones de 10 minutos de
`tools/viewport-stress.mjs` (determinismo, cola y sesión larga con ráfagas
de órbita, soltar y mover una pieza, comprobando que el lienzo muestra la
escena actual):

| Motor, 10 min | Acciones | Renders | Paradas | Imagen vieja | *Watchdog* | Cola |
| --- | --- | --- | --- | --- | --- | --- |
| Nativo, 16 hilos, 1.ª | 171 | 1 (cancelado por deshacer) | 0 | 0 de 15 | 0 | 10 de 10 |
| Nativo, 16 hilos, 2.ª | 163 | 6 (5 terminados, 1 cancelado por deshacer) | 0 | 0 de 16 | 0 | — |
| Pool, 3 workers | 143 | 5 (3 terminados, 2 cancelados por deshacer) | 0 | 0 de 6 | 0 | 10 de 10 |

Lo que no encajó con el plan: con la máquina muy cargada por otros agentes
(carga de 10 a 47 en 4 núcleos), unas 16 acciones por minuto y no
*docenas*; la sesión de 5 minutos del pool contra la v0.1.0 no concluye
(un clic perdido la dejó en *Rápido*), así que el fallo propio del pool lo
prueba su test y no la sesión; un *deshacer* que se lleva el trabajo de la
cola sigue cancelando su render (lo decidido en U5); en el pool, al
terminar un render el visor vuelve a empezar para recuperar todos los
workers (pierde las muestras de esa vista); y como en escritorio los
renders los escribe el lanzador (P3b), la comprobación espera el archivo
en su carpeta de *Descargas* (`XDG_DOWNLOAD_DIR`) y no una descarga del
navegador. Sin probar en un Windows real.

**P3b hecha.** Diálogos del sistema (carpeta, abrir, guardar) desde el
lanzador con PowerShell en Windows y `zenity`/`kdialog` en Linux, y API
de archivos que solo toca lo que la persona eligió en un diálogo durante
ese arranque (carpetas de salida solo para archivos nuevos, nunca se
sobrescribe; extensiones permitidas; *Descargas* y el último proyecto
como únicas excepciones del lanzador); renders, proyectos, importaciones,
exportaciones y modelos pasan por ahí y la burbuja de descargas no
aparece. Interruptores de endurecimiento y preferencias de perfil para
Edge/Chromium en una sola constante que reutiliza P3c; la página bloquea
el menú contextual, la selección del cromo, la traducción, el zoom, la
recarga, la impresión, la búsqueda y la navegación del navegador
(`src/ui/guards.ts`), sin romper ningún atajo propio; `Ctrl W`/`Ctrl Q`
pasan por nuestra pregunta; los enlaces externos salen por un único
`openExternal` (lanzador en escritorio) y un test impide `alert`,
`confirm`, `prompt`, `print` y `window.open`; favicon, iconos y
manifiesto propios. Sin probar en Windows real: que los diálogos salgan
delante de la ventana y que el minimenú de Edge desaparezca del todo (lo
garantiza P3c).

**P3c hecha.** Ventana Win32 propia con WebView2 en Windows
(`engine/crates/rt-app/src/platform/`, el único sitio del lanzador con
`unsafe`, cada bloque con su porqué): COM escrito a mano (tablas virtuales
transcritas del IDL del SDK, con su número de métodos y la posición de
cada método usado comprobados en los tests), el cargador
`WebView2Loader.dll` de Microsoft junto al ejecutable (NuGet
`Microsoft.Web.WebView2` 1.0.4258.31, licencia de estilo BSD que permite
redistribuirlo con su aviso; SHA-256 del paquete y de la DLL fijados en
`packaging/lib/webview2.mjs`) y el *runtime* Evergreen del sistema; perfil
en `webview2/` de la carpeta de datos (portable incluido). Todo lo que no
es nuestra interfaz, apagado por la API: menús contextuales, diálogos de
script, atajos del navegador, barra de estado, zoom, pellizco, deslizar
para volver, autorrelleno, contraseñas, SmartScreen, página de error y,
en *release*, herramientas de desarrollo; navegación solo a nuestro
origen, enlaces `https` pulsados al navegador del sistema, ninguna
ventana nueva, descargas canceladas sin su panel (y la página no descarga
nunca en esa ventana: lo comprueba un test), permisos denegados salvo los
archivos que la persona eligió y el almacenamiento persistente. Cerrar
(botón, `Alt F4`, barra de tareas, menú del sistema) llega a la página
como `close-requested` y pasa por la misma pregunta que `Ctrl W`
(`requestCloseWindow`, *Guardar · No guardar · Cancelar*), sin
`beforeunload`. Icono propio, título `Repackshot — <proyecto>`, barra de
título oscura con el tema oscuro, AppUserModelID `Repackshot.App` (y el
mismo en los accesos directos del instalador, con `repackshot
--shortcut-id`), tamaño, posición y tema recordados en `window.json`, y
los diálogos de archivo de P3b con la ventana como dueña. Si falta el
cargador o el *runtime*, o falla cualquier paso, se apunta en el registro
y se abre la ventana `--app` de Edge; *Ajustes ▸ Escritorio* dice qué
ventana es y por qué, y `--window=webview2|browser` la fuerza. En la
cabecera, el logotipo con una flecha hacia abajo en lugar de las tres
rayas (web y escritorio). Linux sin cambios.

Lo que no encajó con el plan: por decisión del líder, tras compararlo con
NesTube, la ventana usa la barra de título **del sistema** y no una
dibujada por la página (la versión sin marco, con el borde superior y
*Snap Layouts* sobre nuestro botón de maximizar, se hizo, se probó bajo
Wine y se quitó). A WebView2 se le pasan las `DISABLED_FEATURES` y los
interruptores contra la ralentización de `browser.rs` (una sola fuente),
pero no los `HARDENING_SWITCHES`: son de la interfaz del propio navegador,
que WebView2 no tiene o que su API ya apaga, y no están documentados para
WebView2. Bajo Wine no se puede leer de vuelta el AppUserModelID de un
acceso directo (su almacén de propiedades es un esbozo), así que eso, y
todo lo de WebView2, queda por probar en Windows real. El puerto
aleatorio por arranque, que hace perder `localStorage` entre arranques
(en la ventana de Edge y en la propia), queda para P3e.

**P3e hecha.** En escritorio la página es solo la interfaz. Una costura
`Platform` (`src/io/platform.ts`), elegida una vez al arrancar, con dos
implementaciones detrás de la misma interfaz: la web (`platform-web.ts`:
localStorage, IndexedDB, OPFS, WebGPU, como hasta ahora) y la del lanzador
(`platform-desktop.ts`), donde cada servicio y cada byte de estado son del
lanzador: ajustes en `settings.json` de la carpeta de datos, cosas pequeñas
recordadas en `state/`, biblioteca en `library/`, historial de resultados
como archivos en `results/` con su índice, miniaturas en `cache/thumbs/`,
modelos (ya lo eran), equipo siempre por `/api/hardware` y espacio usado
medido por el lanzador (`/api/storage/usage`), con *Liberar* a través de
él. Rutas nuevas `/api/store/*` y `/api/storage/usage`
(`rt-app/src/appdata.rs`) con el *token*, `Host` y `Origin` de siempre,
nombres en minúscula confinados a la carpeta de datos (ni enlaces ni
nombres de dispositivo de Windows), escrituras atómicas, y un documento
que no se pudo leer al arrancar nunca se sobrescribe. **Puerto estable por
carpeta de datos** (`launcher.json`, `rt-app/src/port.rs`): el origen de la
ventana ya no cambia en cada arranque, que era por lo que en v0.1.x se
perdían ajustes, biblioteca e historial al cerrar. Migración, una sola vez
por carpeta de datos (marca `state/migration.json`), de lo que quede en el
almacenamiento del navegador del origen actual; para quien venga de v0.1.x
suele estar vacío (cada arranque tenía otro puerto) y solo deja la marca.
Ninguna fila habla del navegador en escritorio: las cadenas que lo
nombraban tienen su versión de escritorio (`DESKTOP_TABLE` de
`strings.ts`) o su fila oculta (`webOnly`: *Almacenamiento persistente*;
WebGPU, cuota y memoria del navegador solo en la web), *Ventana dibujada
por* dice un nombre (*Ventana de aplicación de Microsoft Edge*, y ya lee el
`window` de P3c para *Ventana nativa (WebView2 x.y)*), la fila GPU lista
las tarjetas del lanzador y sigue a la detección aunque llegue después, el
distintivo *Solo en la aplicación de escritorio* no sale dentro de ella y
el modelo solo para navegador no se lista. Filas de Ajustes que no se pisan
a ningún ancho ni tamaño de interfaz: columna de etiqueta con mínimo,
controles y distintivos que se parten, filas apiladas para valores largos
(rutas en monoespaciado partidas donde haga falta, botón debajo, título con
el texto entero) y consultas de contenedor que lo apilan todo en ventanas
estrechas. Tests: la costura elige el lanzador y entonces no toca
`localStorage`, `indexedDB` ni `navigator.storage` (espías), la migración
una vez y con el origen vacío, escrituras en orden, resultados con sus
límites, las cadenas del navegador cubiertas; en Rust, `tests/appdata.rs`
(seguridad, confinamiento, enlaces, límites, petición cortada, resultados,
caché, espacio, otro arranque) y `tests/port.rs`. Comprobación
`tools/desktop-platform-check.mjs` contra el lanzador real (ajustes que
sobreviven a reiniciar en un perfil de navegador nuevo, el mismo puerto,
nada en el almacenamiento del navegador, un render en `results/`, las GPU
del lanzador, ninguna mención del navegador en los dos idiomas, *Liberar*
por el lanzador, y ningún solape en todas las secciones a 1600, 1280 y
960 px, 90–150 %, dos idiomas, oscuro, claro y contraste alto); capturas
`settings-desktop-paths.png`, `settings-storage-desktop.png`,
`settings-ai-desktop.png`. Con P3b y P3c unidas, 1044 tests web y 309 del
motor.

Unida con P3b y P3c: las carpetas de salida, los proyectos (con el último
que recuerda el lanzador) y los diálogos de importar y exportar salen
también de la plataforma (en escritorio, los de P3b; nunca los selectores
ni los *handles* del navegador), las carpetas elegidas se recuerdan en
`state/desktop.folders.json` y no en `localStorage`, y *Ventana dibujada
por* es una sola función (la de P3c, con sus motivos) que dice *La ventana
propia de Repackshot (WebView2 x.y)* y nunca el nombre de un ejecutable
(sin ventana del lanzador, `--serve-only`, ya no dice *El navegador por
defecto*). La comprobación del lanzador real suma que *Elegir carpeta…* y
*Guardar proyecto* pasan por los diálogos del lanzador (un `zenity` de
prueba) sin tocar los selectores del navegador, que la carpeta queda en
los datos y que *Descargas* lo escribe el lanzador. Al unir: la carpeta
de salida elegida, que P3b muestra por su ruta, se salía de su fila; el
botón dice su nombre y la ruta entera va debajo. Arreglado de paso un
fallo intermitente del test de paridad (`tests/parity.rs`: si la última
pasada llegaba entre dos consultas, el marco devuelto no venía marcado
como terminado).

No encajó con el plan: el *token* sigue en `sessionStorage` (es el secreto
del arranque, no estado).
La copia automática no existe todavía (U8): cuando llegue, a la carpeta de
datos por la plataforma. `REPACKSHOT_TEST_GPUS` (tarjetas falsas, solo para
pruebas) la lee también el binario de *release*. En Windows, si el puerto
recordado está aún en `TIME_WAIT` al reabrir, se toma otro una vez y se
recuerda. Encontrado de paso (de P3a): un trabajo de visor nativo de una
página que se recarga sigue vivo hasta el tope de 8 (`503 busy`). Sin
probar en un Windows real.

**Corrección tras probar v0.1.2.** En Windows de verdad el lanzador no
encontraba ninguna tarjeta gráfica en ningún equipo, solo la CPU, y de eso
dependen *Ajustes ▸ Post-procesado IA ▸ Equipo*, la fila *GPU* y la elección
Vulkan/CPU del motor de IA. Causa: `reg query <clase de pantalla> /s` llega a
la subclave `Properties`, que da «Acceso denegado» («ERROR: Acceso
denegado.» en español), y `reg` sale con 1; `process::output` tiraba la
salida de cualquier programa que no saliera con 0, con los adaptadores
dentro. El test del analizador le pasaba el texto directamente, sin código
de salida: era más permisivo que la realidad, y se ha arreglado con él.
Ahora `process::output_any` devuelve lo impreso junto con el código (y
`output` sigue estricto para las consultas de una sola clave de
`browser.rs` y `files.rs`, donde salir con 1 es «no está»), y las tarjetas
salen de cuatro fuentes: **DXGI** (`rt-app/src/platform/dxgi.rs`, COM a mano
como el de P3c: `CreateDXGIFactory1`, `EnumAdapters1`, `GetDesc1`; VRAM
dedicada exacta de 64 bits, sin el adaptador de software ni los de
Microsoft, `dxgi.dll` solo de `System32`), **el registro** (una consulta
para listar las subclaves y otra por adaptador, nunca `/s` ni `Properties`,
leídas sea cual sea su código), **CIM** (`Win32_VideoController` en la misma
ejecución de PowerShell que la RAM) y **wmic** si PowerShell no contesta.
Se mezclan por adaptador: manda la primera que lista solo lo que hay ahora
(DXGI, si no CIM, si no wmic), porque el registro guarda la clave de una
tarjeta que ya se quitó, y gana la VRAM exacta sobre la de 32 bits, que se
queda en 4 GiB. Cada fuente deja en `logs/repackshot.log` qué encontró o por
qué falló, `/api/hardware` lo da en `gpuSources` y `gpuDetection`, y la
interfaz distingue «No se han podido leer las tarjetas gráficas: mira los
registros» de «No se ha encontrado ninguna tarjeta gráfica». Los programas
del sistema van por su ruta absoluta en `System32` (`reg.exe`,
`powershell.exe`, `WMIC.exe`, también en `browser.rs`, `files.rs` y
`dialogs.rs`). Tests, cada uno comprobado fallando sin su arreglo: un
programa que imprime y sale con 1 se lee (`sh` en Linux, `cmd` bajo Wine),
la fuente del registro con un `reg` falso y con programas de verdad que
salen con 1, el analizador con «Access is denied» y «Acceso denegado.»
entre claves, CIM y `wmic`, la mezcla (la tarjeta quitada, dos tarjetas
iguales, «sin tarjeta» frente a «no se pudo preguntar»), las vtables y
`DXGI_ADAPTER_DESC1` contra el IDL, y la interfaz. Bajo Wine con `xvfb-run`
DXGI lista su adaptador (*NVIDIA GeForce GTX 470*, 15,7 GiB, lo que Wine
inventa), el registro de Wine lo llama *Wine Adapter* sin VRAM, el
PowerShell de Wine no contesta y `wmic` da el mismo nombre que DXGI: queda
una tarjeta, la de DXGI. Encontrado al pasarlo todo bajo Wine: un test de
`rt-app/tests/ai.rs` daba por hecho que el equipo no tiene GPU (una petición
sin `"device":"cpu"` pedía la compilación Vulkan, que no está instalada, y se
rechazaba por eso antes de leer la imagen); fallaba igual en Linux con una
GPU (`REPACKSHOT_TEST_GPUS`) y ya pide la CPU como las demás. No encajó: sigue sin probarse en un Windows real
(si aún falla, `logs/repackshot.log` dice qué contestó cada fuente); que
`reg /s` se pare en el primer error no está comprobado, por eso se consulta
clave a clave; el instalador lee el mismo `--hardware` y ya ve las tarjetas,
pero su página de modelos no distingue «no se pudo leer» de «no hay» (el
INI no cambia).

Orden: oleada 1 **P3a**, **P3b**, **U7**, **E5** en paralelo; oleada 2
**E5b**, **E6**, **L4**, **N1**, **U8**; oleada 3 **E7**, **M2**, **L5**,
**N2**. El post-procesado IA, **adelantado a petición del usuario (2026-10-13)**: **X3a**, **X3b**, **X4**, **X2** y **X3c** ya; **X3d** y **X1b** detrás (`AI-POST.md` §7.6). Cada fase quita sus
*próximamente* y no deja ninguno nuevo sin anotarlo aquí.

## Herramientas de estudio (óptica, entorno, luz, cámara, partículas)

Plan completo en `docs/STUDIO-TOOLS.md`. Fases, por oleadas a partir de la
2 (la DoF de E5b pasa a O1):

| Fase | Responsable | Qué |
| --- | --- | --- |
| **A6** — hecha | Sonnet | Assets sin motor nuevo: `lenses.json` (16 prescripciones con test paraxial), `bokeh.json` (20 tipos), máscaras de diafragma y gobos generados, `camera-moves.json` |
| **O1** | Opus | Lente fina mejorada: diafragma poligonal y por máscara, perfiles de pupila, obstrucción, ojo de gato aproximado, anamórfico, *tilt-shift*, *split diopter*, CA por canal; selector de bokeh |
| **O2** | Opus | Lente trazada: prescripciones, intersección estable, límites de pupila, autoenfoque, respiración; las 16 lentes |
| **O3** | Opus | CA por tres bandas, coatings (transmisión, tinte, T-stop), velo |
| **O4** | Opus | Flare con fantasmas, estrella de difracción, bloom y halación, polvo y rayas |
| **O5** | Sonnet | Editor de lentes: carácter, corte en SVG, ajustes no físicos marcados, *Guardar lente como…* |
| **W1** | Opus | Evaluador de pines en el motor con muestreo por importancia; editor de pines; *Colocar brillo* |
| **W2** | Sonnet | Biblioteca de 39 entornos (recetas, miniaturas, *hash*), exportar HDR/EXR, interiores horneados |
| **L6** | Sonnet | Colocación *Reflejo · Directo · Órbita*, normal suavizada, obstáculos, potencia automática |
| **L7** | Opus | Emisores con perfil procedural, gobos, banderas, reflectores |
| **L8** | Opus | Difuso/especular por luz, enlazado de luz y sombra, solo, parpadeo |
| **L9** | Sonnet | Falso color por zonas, fotómetro, hornear el montaje a entorno |
| **N4** | Sonnet | Biblioteca de movimientos de cámara, cámara en mano, rampas, proporciones |
| **N5** | Opus | Dibujar y grabar recorridos, bloqueo de objetivo, desenfoque de movimiento |
| **S0** | Fable | Decisiones de partículas: dónde vive el simulador, formato de caché, secciones RSB |
| **S4a** — hecha | Opus | Ambiente: partículas de aire sin estado (`rt-sim`, `FXAM`, esferas, discos y cápsulas, la sección *Ambiente* de *Escena*); valores de los presets aceptados; lo que sigue, en S4b |
| **S4b** — hecha | Opus | Partículas: el coste a las densidades de los presets, medido (la rejilla de pantalla de los rayos de cámara, porque la lluvia pasaba de 1,3×); un lóbulo hacia delante (Henyey–Greenstein) para polvo, polen y polvareda; gotas sin cáusticas; la cuota del lóbulo y el coste de la lluvia, para el veredicto |
| **S1**–**S10** | Opus, Sonnet | Dispersión e instancias; caída y reposo; gotas y condensación; emisores sin estado; volúmenes; humo; líquidos; pelo y césped; telas; mejoras (detalle en `docs/research/particles.md` §6) |

### A6 · Assets sin motor nuevo — **Sonnet** — hecha

**Hecho.** Todos los assets de las herramientas de estudio que no necesitan
motor nuevo, sin marcas ni nombres de fabricante y generados por código del
repositorio (nada sale de modelos de imagen por IA):

- `src/data/lenses.json` (+ cargador tipado en `lenses.ts`, que conserva
  `LENS_PRESETS`): las 16 prescripciones de `docs/research/optics.md` §2.3 en
  el registro de §5 (superficies con radio, espesor, vidrio `nd`/`vd`,
  semiapertura, tipo, diafragma y *coating*; focal de referencia, número f,
  campo, círculo de imagen, foco y gaps móviles, iris), con la patente o el
  libro en `source`. `tests/lenses.test.ts` traza un rayo paraxial propio y
  reproduce focal y tiraje de cada lente dentro del 0,05 % de lo que trazó el
  informe y del 1 % de lo que dice la patente (también la respiración del
  teleobjetivo, el elemento flotante del macro, el recorrido del hueco del
  blando, el aumento 1/2 del adaptador y la imagen detrás del espejo del
  catadióptrico); el diafragma existe una sola vez en cada lente, las claves
  son únicas y estables, ninguna marca ni vidrio de catálogo aparece, y todo
  vidrio tiene `nd` en [1,4; 2,1] y `vd` en [15; 100]. Una relectura
  independiente de la tabla del informe no encontró diferencias con lo
  transcrito (salvo el hueco simbólico `dB0` y los `vd` estimados).
- `src/data/bokeh.json` (+ `bokeh.ts`): los 20 tipos de `optics.md` §1 con
  claves estables, nombres y descripciones en es/en y los parámetros del
  modo de lente fina (láminas, redondez, giro, máscara, perfil de pupila,
  obstrucción, ojo de gato, compresión anamórfica, CA, remolino, anillos,
  textura), o la lente trazada que los da (`requires: "traced"`), o `requires:
  "wave"` para el anillo de difracción (próximamente). Un test comprueba que
  todo resuelve a máscaras y lentes que existen.
- `tools/assets/` (`common.mjs`, `aperture-masks.mjs`, `gobos.mjs`) y
  `public/assets/aperture/` (45 máscaras de 512²: polígonos de 3 a 18 láminas
  rectos y curvos, estrellas, corazón, varios agujeros, anillos con
  obstrucción 0,3 y 0,5, anillos de cebolla, polvo, rayas, malla) y
  `public/assets/gobo/` (12 patrones de 1024²: ventanas, persianas, hojas,
  luz moteada, puntos, líneas, ráfaga radial, rotura suave), cada uno con
  receta, semilla y *hash* en su `index.json`. El *hash* canónico es el de los
  píxeles (los bytes de un flujo de zlib pueden cambiar entre versiones);
  `tests/assets.test.ts` regenera todo con las funciones puras del generador y
  compara. El generador usa solo `+ − × ÷` y `sqrt` y funciones propias.
- `src/data/camera-moves.json` (+ `camera-moves.ts` y `src/core/camera-moves.ts`):
  14 movimientos (los 13 de STUDIO-TOOLS §4 con la espiral en dos) como listas
  de los tipos de animación que ya existen, en unidades relativas al producto
  (grados, % de la distancia de encuadre, tamaños de pieza, factores de focal y
  de foco), y 3 presets de cámara en mano. `tests/camera-moves.test.ts` expande
  cada uno en barras, las evalúa con `evaluate` en t = 0 y t = fin (finitas y
  deterministas, y a t = 0 nada se ha movido), y comprueba que el contra-zoom
  conserva focal / distancia, que el plato giratorio da una vuelta, etc.
- **Servidor de escritorio** (`engine/crates/rt-app/src/static_files.rs`): hasta
  ahora todo `/assets/` salía con `Cache-Control: immutable` de un año porque
  Vite nombra ahí todo por *hash*; los assets nuevos no llevan *hash* y un
  fichero regenerado con el mismo nombre se habría visto viejo para siempre. Ahora
  solo es inmutable lo que está directamente en `/assets/` y se llama
  `nombre-XXXXXXXX.ext` (el patrón de 8 caracteres base64url que emite Vite 8);
  lo demás sale con `no-cache` y un ETag del SHA-256 de sus bytes (los ficheros
  de hasta 8 MiB; responde 304 si no cambió, y un fichero regenerado con el mismo
  tamaño y la misma hora ya no se confunde con el anterior). Tests de Rust que
  fallan si algo sin *hash* se sirve inmutable (con los nombres que emitió esta
  misma build y los de `aperture/` y `gobo/`). `tests/chunks.test.ts` ya no lee las
  carpetas de `dist/assets/` como si fueran ficheros.

**Valores provisionales, a la espera de O1 (regla 11, criterio visual de
Fable).** Los *coatings* por época de las lentes (antes de 1935 sin tratar,
hasta 1969 monocapa, después multicapa), los valores por defecto del
diafragma (círculo, f/22 como máximo), los valores de partida de los tipos de
bokeh (remolino 0,7, fuerza de los perfiles de pupila, obstrucción 0,49 del
catadióptrico…), el significado de `profileParam` en cada perfil y las
amplitudes de la cámara en mano (sutil, medio, fuerte) son puntos de partida
con las claves como contrato; O1 los juzgará con renders. También quedan para
O1 las miniaturas de bokeh renderizadas por el motor.

**No encajó con el plan:** el tipo de animación `PAN` no existe todavía (SPEC
§3.7), así que el barrido rápido es una órbita rápida con curva fuerte y el plato
giratorio es `SPIN` sobre el modelo; el nombre «retrofoco» fue una marca y la
lente se llama *gran angular de telefoto invertido*; `CAMERA_MOVES` ya existía en
`animation.ts` (el conjunto de tipos solo de cámara) y la biblioteca es
`CAMERA_MOVE_LIBRARY`; hizo falta un expansor en `src/core/camera-moves.ts` que
el plan no nombraba (N4 lo amplía); la posición del diafragma solo la dan la
fuente para 6 de las 16 lentes (`stopBasis`) y para 9 se supone en el medio del
hueco que el informe nombra; el informe no da número f ni semiaperturas del macro,
ni semiaperturas de casi ninguna lente, así que esos campos quedan vacíos o
derivados y marcados.

### S0 · Decisiones de partículas — **Fable** — hecha

Petición del usuario: simulación de partículas del ambiente (lluvia,
polvo en suspensión y cómo refleja las luces, nieve, polvareda…) como
una opción más dentro de *Escena*, completamente configurable y simulada
en 3D. Es la clase **sin estado** de `STUDIO-TOOLS.md` §5 y de
`docs/research/particles.md` (§2.1, §2.6, §3.2, §4, §5): no necesita
caché ni horneado, y entra ahora como **S4a**. Decisiones que valen para
toda la familia S:

1. **Dónde vive el simulador.** Un *crate* nuevo `engine/crates/rt-sim`,
   solo `std`, sin `unsafe`, sin APIs del sistema, con el contrato de
   determinismo del motor (`f32`, `fmath`, hash contador
   `mix64(seed ^ id)`): la misma semilla y el mismo instante dan las
   mismas partículas en nativo y en wasm (test con *hash* de posiciones).
   Lo usan `rt-core` (el render), `rt-wasm` (el visor Rápido, por una
   exportación `particles_eval`) y `rt` nativo. **No hay puerto a
   TypeScript**: sin wasm, el visor pinta solo la caja del emisor y el
   medidor lo dice (regla 10).
2. **Modelo de tiempo.** Cada partícula es función pura de (semilla, id,
   tiempo): nacimiento = fase propia dentro de su vida (régimen
   estacionario, la escena «llena» desde el primer instante), movimiento
   de forma cerrada (velocidad terminal `v = v₀ + (v_t − v₀)(1 − e^{−t/τ})`
   integrada, sin pasos; viento constante; deriva de *curl noise* como
   **desplazamiento** `d(x₀, t)` sin divergencia, no como velocidad
   integrada: así cualquier `t` cuesta lo mismo). Sin colisiones salvo
   el suelo (mueren bajo `z = 0` y renacen por fase). *Congelar en* el
   instante `time` del efecto; la animación N1 lo moverá más adelante.
3. **Qué viaja al motor.** Los **parámetros**, no las partículas: sección
   RSB `FXAM` (≤ 256 B por efecto, varias permitidas, ignorada por un
   motor viejo), y el motor evalúa las partículas al cargar la escena y
   construye su BVH. Un RSB con 1 M de partículas serían 24 MB por
   trabajador en el navegador; así son 256 B.
4. **Primitivas** en `rt-core`: esfera (intersección estable), disco
   orientado (copo) y cápsula (esfera barrida: la estela de la lluvia sin
   desenfoque de movimiento), con BVH plana propia sobre el conjunto y un
   único nodo en la TLAS. Materiales del catálogo por clave (`MATL` ya
   existente), con variación de tinte por partícula desde su semilla.
   **Tamaño mínimo en pantalla**: una partícula más fina que 0,35 px se
   ensancha a eso para los rayos de cámara y su radiancia se escala por
   (área real / área ensanchada), así la energía no cambia (test).
5. **Lo que no entra en S4a.** Calima, haces de luz, niebla baja y la
   polvareda como volumen (medio participante con seguimiento delta): S5,
   después de E9b (medios dispersores), y en la lista de S4a aparecen
   como *próximamente*. Desenfoque de movimiento (N5). Colisiones con
   las piezas, caché y horneado (S2). Lectura de `.vdb`: no.
6. **Coste.** Con 200 k partículas, ≤ 1,3× el tiempo por muestra de la
   misma escena sin ellas; tope por defecto 100 k en el navegador y 1 M
   en nativo, en *Ajustes ▸ Motor de renderizado*.

### S4a · Ambiente: partículas de aire sin estado — **Opus**, veredicto **Fable** — hecha

**Qué.** En la pestaña *Escena*, una sección nueva **Ambiente** (en la
lista de secciones, tras *Luz* y antes de *Cámara*) con una lista de
efectos (0..n; *Añadir* abre una galería de tarjetas) y, por efecto:

- **Tipo / preset** (claves estables en `src/data/effects.ts`, nombres
  es/en): `DUST_MOTES` Motas de polvo, `POLLEN` Polen, `RAIN` Lluvia,
  `SNOW` Nieve, `DUST_CLOUD` Polvareda, `ASH` Ceniza, `BUBBLES` Burbujas
  que suben, `CONFETTI` Confeti que cae; y, atenuados con *próximamente*
  (S5): `HAZE` Calima, `LIGHT_SHAFTS` Haces de luz, `GROUND_FOG` Niebla
  baja. Valores de partida de cada preset: los pongo yo con la hoja (regla
  11); el agente propone unos en el JSON y los anota como propuesta.
- **Ocho mandos de fotógrafo** (siempre visibles): Cantidad, Tamaño,
  Energía (velocidad), Caos (dispersión + turbulencia), Viento (fuerza y
  dirección en grados), Gravedad, Variación, Semilla (con barajar).
- **Avanzado** (plegado): región (caja alrededor de la escena con margen
  en mm; o caja propia con centro y tamaño; banda de alturas), densidad
  (partículas/m³) o cuenta, forma (punto/esfera, copo/disco, estela/
  cápsula), tamaño mm ± variación, velocidad de caída (terminal) ±
  variación, giro, viento (vector), turbulencia (fuerza, escala, velocidad),
  envolvente de nube (centro, radio, suavidad, para la polvareda),
  material (clave del catálogo; por defecto el del preset: polvo = difuso
  claro con un poco de especular; lluvia = vidrio; nieve = difuso blanco
  con `absorption` corto; polen = difuso amarillento; confeti = lista de
  tintes), variación de tinte, instante (*Congelar en*, s), visible a
  cámara / en reflejos / proyecta sombra (como las luces), y el tope de
  partículas.
- Todo en `ProjectState` (nuevo campo `effects: AmbientEffect[]`), por el
  *store* y deshacible, guardado con el proyecto (U2), Doctor avisa si
  hay más partículas que el tope.
- **Visor Rápido**: `THREE.Points` (polvo, nieve) o `InstancedMesh`
  (cápsulas de lluvia) con las posiciones que devuelve `particles_eval`
  del wasm, hasta 50 k; selección del efecto muestra la caja de su
  región. **Completo y render**: el motor, por `FXAM`.
- **Luz sobre las partículas.** Nada especial: son geometría con su
  material, así que el polvo a contraluz brilla por el especular y la
  NEE las ilumina como a todo; un foco detrás del producto hace el
  «polvo en el haz». La hoja lo tiene que enseñar.

**Motor.** `rt-sim` (S0 §1–2), `FXAM` en `rt-core::scene::rsb` (campos:
`kind u32`, `seed u32`, `time f32`, `count u32`, región (centro, mitad de
tamaño, banda), tamaño y variación, forma, velocidad terminal y
variación, viento xyz, turbulencia (fuerza, escala, velocidad), nube
(centro, radio, suavidad), `material_id`, `tint_var`, `flags` (cámara,
reflejos, sombra), estela (longitud como multiplicador de la velocidad);
los que sobren, cero), las tres primitivas con intersección estable en
`geometry/` y una BVH plana (S0 §4), `Film` y pases sin cambios
(`partId` de una partícula = el id del efecto; `materialId` el suyo).
`rt-wasm` exporta `particles_eval(params, max) → f32[]` (xyz, radio,
orientación) para el visor. Sin `sin`/`exp` por partícula en el bucle
caliente: la exponencial de la velocidad terminal va tabulada por `fmath`
una vez por efecto.

**Depende de.** E3, E5 (vidrio para la lluvia), E12 (elección de luz por
punto: con 100 k partículas la NEE desde ellas no debe elegir a ciegas).

**Criterio.** (1) Determinismo: `hash(posiciones)` igual en nativo y wasm
y con 1 y N hilos, y el mismo píxel a píxel (test); con el efecto a
cuenta 0 los *hashes* de todas las escenas de referencia no cambian.
(2) Régimen estacionario: la densidad medida en la región a `t = 0`,
`t = 3 s` y `t = 60 s` difiere < 3 % (test). (3) La lluvia muere en el
suelo y renace arriba (test: ninguna partícula bajo `z = 0`). (4)
Energía del ensanchado a 0,35 px: una imagen de polvo fino a 4 spp y a
256 spp tiene la misma media ± 2 % (test). (5) Coste: ≤ 1,3× con 200 k
partículas en la escena de ejemplo (medido, en el párrafo del ROADMAP).
(6) *Hoja* `out/ambient-sheet.html`: la botella del ejemplo con los ocho
presets a 512 px / 128 spp, cada uno en dos luces (clave lateral y foco
a contraluz detrás del producto, para ver el polvo brillar en el haz),
más la lluvia con tres longitudes de estela y la polvareda con dos
suavidades; a ojo. (7) Capturas `docs/ui/ambient-section.png` y
`docs/ui/ambient-gallery.png`; comprobación de navegador
`tools/ambient-check.mjs` (añadir, cambiar preset, deshacer, guardar y
abrir, tope). `SPEC.md` §3.1 (el efecto como dato), `UI.md`,
`ARCHITECTURE.md` (crate `rt-sim`, `FXAM`), `STUDIO-TOOLS.md` §5
(apunte: S0 decidido, S4a hecha), CHANGELOG. Cadenas es/en, cromo
acromático.

**Hecho.** **Motor.** `engine/crates/rt-sim` (solo `std`,
`#![forbid(unsafe_code)]`): `AmbientParams` lee y escribe la carga de
`FXAM` (192 B; los 128 primeros son los campos de este apartado, en su
orden), `evaluate(&params, max)` y `Evaluator::particle(id)`. Cada
partícula sale de `mix64((seed << 32) ^ id)` y de un hash por vida: fase
propia, velocidad en forma cerrada `v(a) = v_d + (v₀ − v_d)·e^{−a/τ}`
integrada (`τ` de la caída y la gravedad, `v₀` la deriva más *Energía* en
una dirección al azar), deriva de *curl noise* como desplazamiento (tres
ruidos de gradiente con *fade* quíntico y gradiente analítico; Bridson et
al. 2007), exponencial y seno tabulados con `fmath` una vez por efecto.
Las que caen (o suben) nacen en la cara de arriba (o de abajo) y viven lo
que tardan en cruzar la caja: así mueren en el suelo y renacen arriba sin
salto de densidad; las que flotan viven siempre y la caja se envuelve. La
nube, por rechazo con borde *smoothstep*. Tests: *hash* de posiciones
fijado (`PINNED_PARTICLES_HASH`), densidad a 0, 3 y 60 s dentro del 3 %
(polvo y lluvia, 200 000 partículas, y la caja igual de llena arriba que
abajo), nada bajo `z = 0`, la lluvia renace arriba, cualquier prefijo y
cualquier número de hilos dan las mismas partículas, la nube sigue siendo
nube. `rt-core`: `geometry/particles.rs` (esfera con la intersección
estable de *Ray Tracing Gems* cap. 7, disco orientado, cápsula; BVH plana
por efecto con hojas de una partícula y el id como desempate; `RayClass`
cámara / secundario / sombra / piezas para las tres banderas), `FXAM` en
`scene/rsb.rs` (lector y escritor, varias, validadas; un motor anterior
las salta), el material de cada partícula con el tinte de su semilla,
pases con `partId` = índice del efecto tras las instancias y `materialId`
el suyo, una actualización con los mismos parámetros conserva las
partículas y su BVH. Tamaño mínimo de 0,35 px para los rayos de cámara
con la energía conservada (abajo). `rt --write-ambient-example` escribe
la escena de paridad (`example::ambient_scene`: polvo ensanchado, lluvia
de vidrio, nieve con paleta y sin sombra); imagen fijada
`PINNED_AMBIENT_4SPP = 415d7d74` (era `c4406309` antes de la selección
de luces por punto de E12, que la mueve; las partículas no) y partículas
`e38b8480`, iguales en escalar, SSE2, AVX2 y en wasm escalar y
`simd128`, con 1 y N hilos; sin efectos todas las escenas de referencia
dan los mismos *hashes*.
`rt-wasm`: `rt_particles_eval(params, len, max, out) → u32` (8 `f32` por
partícula: centro, radio, eje, semilla del tinte; `u32::MAX` si la carga
no vale) y `engine/tools/wasm-parity.mjs --particles --expect-particles`.
**Interfaz.** `src/data/effects.ts` (los ocho presets y los tres de S5
*próximamente*, claves estables, es/en), `src/core/effects.ts`
(`ProjectState.effects`, `effect/add|remove|set|preset` deshacibles, la
región, la cuenta y el tope, los campos y los bytes de `FXAM`, los efectos
de un archivo), la sección *Ambiente* (`insp-ambient.ts`), el chequeo
`particles` del Doctor con su arreglo, *Ajustes ▸ Motor de renderizado ▸
Partículas por efecto*, el escritor RSB (una `FXAM` por efecto encendido,
con su material detrás de los de las piezas) y el visor *Rápido*
(`THREE.Points` para esferas y discos, `InstancedMesh` de cilindros para
las estelas, hasta 50 000 por efecto, de `rt_particles_eval`; sin
`rt.wasm`, la caja de la región y el medidor lo dice). Pruebas:
`tests/effects.test.ts`, `tests/effects-rsb.test.ts` (la carga byte a
byte frente a la de `rt --write-ambient-example`, `tests/fixtures/ambient.rsb`;
con el `rt.wasm` real, las partículas y la imagen del motor nativo),
`tools/ambient-check.mjs` (añadir desde la galería, cambiar preset, un
mando, deshacer y rehacer, guardar y abrir, el tope y el Doctor, la caja
sin `rt.wasm`, cromo acromático en los dos temas; capturas
`docs/ui/ambient-section.png` y `docs/ui/ambient-gallery.png`) y la hoja
`tools/ambient-sheet.mjs` → `out/ambient-sheet.html` (los ocho presets
con clave lateral y foco a contraluz, la lluvia con estelas de 4, 12 y
30 ms y la polvareda con suavidad 0,2 y 0,9; 512 × 288, el 16:9 de la
cámara, 128 spp, `--threads 2`; la cámara del ejemplo con la focal × 1,5
para que las partículas se lean, un estudio plano oscuro y *Solo
principal* como única luz; escenas de `tests/ambient-rsb-dump.test.ts`).

**Criterios.** (1), (2), (3) por test, arriba. (4) La energía del
ensanchado: la imagen de polvo fino da de media 1,0820557 a 4 spp
ensanchada, 1,0820074 a 256 spp ensanchada y 1,0809593 a 256 spp con las
partículas exactas (+0,10 %, dentro del ± 2 %). (6) y (7), hechos; los
valores de los presets, aceptados en el veredicto. (5) **No se cumple**: ver
*coste*.

**Coste** (criterio 5; `rt` nativo, AVX2, 2 hilos, con la máquina
compartida por otros agentes: carga 30–38 en 4 núcleos, así que lo que
vale son los cocientes de rondas alternadas). La botella del ejemplo
(9 248 triángulos) con la clave lateral, 512 × 288, 16 spp, tres rondas:
sin efecto 5,46 / 5,68 / 7,31 s; con 200 000 motas de polvo (cámara y
reflejos, sin sombra: el preset) 18,27 / 17,78 / 22,30 s, **3,2×** (3,35,
3,13, 3,05 por ronda); las mismas solo a cámara 15,04 / 15,91 / 16,52 s,
2,6×; con cuenta 0, 5,16 / 7,36 / 6,96 s (lo mismo que sin efecto). Por
cantidad, en dos rondas más: 20 000 → 1,8×, 50 000 → 2,0×, 200 000 →
3,0×. Evaluar las 200 000 y construir su BVH: 1,6–2,0 s, una vez por
carga de escena (no por muestra). En la escena de `rt --example` (322
triángulos, 512 × 384, 4 spp) era 2,0–2,6 s frente a 10,0–10,5 s. Dos
variantes probadas que no bajan nada: aceptar con probabilidad igual a la
cobertura (más rayos que atraviesan y se vuelven a lanzar: 3,4–3,5×) y
aceptar o no dentro del propio recorrido, sin relanzar el rayo (3,1–3,4×;
solo cámara 2,5–2,6×). El coste es **recorrer la BVH de las partículas**:
20 000 partículas ya cuestan lo que los 9 248 triángulos de la botella, y
la escena de ejemplo es demasiado ligera para que 200 000 primitivas
exactas quepan en un 30 %. Lo que podría cumplirlo, para decidir: para los
rayos de cámara (todos salen del mismo punto con una cámara estenopeica),
una rejilla de pantalla con las partículas proyectadas, de modo que cada
rayo solo pruebe las de su píxel en lugar de recorrer la BVH; o topes por
defecto más bajos.

**Lo que no encajó con el plan.**
- **El ensanchado no escala la radiancia.** Multiplicar el sombreado por
  `área real / área ensanchada`, como dice S0 §4, oscurece lo que hay
  detrás del disco ensanchado (lo tapa entero): medido, −5,6 % en la
  imagen de prueba. Con cobertura `c` el rayo se sombrea con probabilidad
  `q = max(c, ½)` y peso `c/q`, o sigue de largo con peso `(1 − c)/(1 − q)`:
  la esperanza es la de la partícula exacta (test del criterio 4).
- **Las partículas no son un nodo de la TLAS** (S0 §4): cada conjunto se
  recorre después de la BVH de instancias, con el rayo ya acotado por la
  pieza más cercana (y un rayo de sombra mira antes las piezas). Fue lo
  más rápido de lo medido (hojas de 1 y conjuntos después: de 8,8× a
  4,4×), y la BVH de un conjunto no depende de la cámara: se rellena con
  el margen del ensanchado.
- **`FXAM` tiene 64 B más** que los campos de este apartado: `gravity`,
  `energy`, `spin` y una paleta de 4 tintes (los mandos *Gravedad* y
  *Energía*, el giro de los copos y los colores del confeti no tenían
  campo). Los primeros 128 B son los del plan, en su orden; dentro de los
  256 B. Las banderas son positivas (1 cámara, 2 reflejos, 4 sombra), no
  como el bit 2 de `LGHT` (*sin* sombra). La banda la aplica el escritor
  TypeScript a la caja (escribe 0, 0); el motor la respeta igual.
- `rt-sim` no puede depender de `rt-core` (es al revés): comparte
  `fmath.rs` y `rng.rs` compilándolos por `#[path]`, y un test de `rt-core`
  comprueba que dan los mismos bits.
- **E12 no está hecha** (dependencia del plan): la NEE desde las partículas
  usa la elección de luces que hay. Con muchos focos y 100 k partículas
  habrá más ruido que el que tendrá con E12.
- Un disco es siempre pared fina; la nieve con «`absorption` corto» es un
  difuso blanco fino con un 30 % de transmisión, porque un copo plano no
  tiene interior. *Energía* es la velocidad de nacimiento (m/s), que se
  relaja hacia la caída.
- La sección va tras *Entorno* (que ya iba tras *Luz*) y antes de
  *Cámara*. La fila del tope está en el bloque *Motor* de *Ajustes* (tras
  SIMD), para no partir los bloques.
- El selector del visor no coge partículas (un clic sigue cogiendo piezas).
  La guarda del post-procesado IA ve los materiales de los efectos como
  *Por defecto* y sus `partId` no nombran ningún nodo.
- `tests/project.test.ts` comparaba el estado de `parseProject` con el de
  `loadProject` incluidos los resultados del Doctor, que `loadProject`
  vuelve a pasar con los chequeos de esta versión: con `particles` nuevo ya
  no coinciden en un archivo anterior. La comparación deja fuera esos
  resultados y comprueba que son los de esta versión.
- **Lo que CI no tiene todavía** (`.github/` no se toca en esta fase): en el
  trabajo del motor, `rt --write-ambient-example` y `wasm-parity.mjs
  --expect 415d7d74 --expect-particles e38b8480` sobre esa escena, y
  `tests/effects-rsb.test.ts` en el paso del `rt.wasm` real.

**Valores de los presets** (regla 11; `src/data/effects.ts`; propuestos
con la hoja y **aceptados** en el veredicto). Densidades fotográficas, no
físicas: la región es la caja del
producto con su margen (o la esfera de la nube) y la cámara no ve más que
eso. Sobre la botella del ejemplo (12,7 l de región; 1,6 l de nube):

| Preset | Densidad (/m³) → partículas | Tamaño | Forma | Caída (m/s) | Otros | Material | Sombra |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Motas de polvo | 150 000 → 1 912 | 0,2 mm ± 60 % | esfera | 0,3 × 0,05 g | energía 0,02, caos 30 %, escala 80 mm, viento 0,02 | difuso claro, rugosidad 0,35 | no |
| Polen | 40 000 → 510 | 0,3 mm ± 40 % | esfera | 0,2 × 0,1 g | energía 0,03, caos 40 %, viento 0,05 a 20° | difuso amarillento 0,6 | no |
| Lluvia | 20 000 → 255 | 1,2 mm ± 40 % | estela 12 ms | 6,5 ± 20 % | caos 5 %, viento 1 | vidrio, ior 1,33 | no |
| Nieve | 12 000 → 153 | 4 mm ± 50 % | copo | 1 ± 30 % | giro 0,5, viento 0,4 a 30° | blanco fino, 30 % transmisión | sí |
| Polvareda | 3 000 000 → 4 889 | 0,3 mm ± 60 % | esfera | 0,1 × 0,2 g | nube 0,6 tamaños de pieza, suavidad 0,6, energía 0,3, caos 80 % | difuso pardo 0,8 | no |
| Ceniza | 15 000 → 191 | 1,5 mm ± 60 % | copo | 0,4 | giro 0,8, viento 0,3 a 200° | casi negro 0,85 | no |
| Burbujas | 10 000 → 127 | 2,5 mm ± 60 % | esfera | 0,25 × −1 g | energía 0,05 | vidrio fino | no |
| Confeti | 5 000 → 64 | 8 mm ± 30 % | copo | 0,8 ± 40 % | giro 1,5, 4 tintes | papel 0,5 | sí |

**Para el veredicto, de la hoja**: el polvo a contraluz **apenas brilla**
en el haz. Una esfera opaca y difusa iluminada por detrás enseña su lado
oscuro, el especular de rugosidad 0,35 da un borde muy fino, y una de
0,2 mm a 512 px queda en el tamaño mínimo (su cobertura reparte la
energía); probé un difuso fino con 60 % de transmisión y no cambia nada a
ojo (la transmisión fina es especular y la NEE no la ve). El «polvo en el
haz» de las fotos es dispersión hacia delante: o un lóbulo propio para
las partículas, o esperar a los medios de E9b / S5. La lluvia a contraluz
sí se enciende en el haz.

**Veredicto del responsable** (14-10).

1. **Coste** (criterio 5): el ≤ 1,3× vale a las densidades de los
   presets, no al tope de 200 000. Por la curva medida (20 000 → 1,8×,
   200 000 → 3,2×), los presets sobre la botella (≈ 1 900 motas, 4 900
   granos de polvareda) deberían quedar cerca de 1,1×, pero es una
   estimación: S4b lo mide primero. La BVH de las partículas se queda; la
   rejilla de pantalla para los rayos de cámara estenopeicos es lo primero
   de S4b solo si una escena de preset medida pasa de 1,3×. El tope por
   defecto se queda como está.
2. **Densidades de los presets**: aceptadas como se propusieron
   (fotográficas, no físicas). La tabla de arriba deja de ser una
   propuesta.
3. **Polvo a contraluz**: aceptado por ahora. S4b da a las motas de polvo,
   al polen y a la polvareda un lóbulo de dispersión hacia delante para
   que un haz las encienda: en la hoja, `DUST_MOTES-back` casi no se ve a
   512 px, y «cómo reflejan las luces» es lo que se pidió. La lluvia que se
   enciende en el haz ya está bien.
4. **Los puntitos de la lluvia con la clave lateral**: S4b. Las gotas no
   hacen cáusticas (un rayo de sombra que cruza una gota pasa con su
   cobertura y sin refracción), la regla habitual para partículas
   refractivas pequeñas; la refracción se queda para los rayos de cámara.
5. El ensanchado por probabilidad en lugar de escalar por el área, `FXAM`
   de 192 B, los conjuntos de partículas después de la BVH de instancias,
   el sitio (*Ambiente* tras *Entorno*, el tope en el bloque del motor),
   las matemáticas compartidas por `#[path]` y el cambio del test del
   proyecto: aceptados como se anotan.
6. Las líneas de CI que faltan las añade el responsable a
   `.github/workflows/engine.yml` al fusionar.

## S4b · Partículas: lóbulo hacia delante, lluvia sin cáusticas y coste medido — Opus — hecha

**Qué** (del veredicto de S4a):

1. **El coste a las densidades de los presets, medido primero.**
   `tools/ambient-sheet.mjs` gana una escena de coste por preset, a la
   cuenta del preset sobre la botella del ejemplo (además de la de
   200 000), con su cociente frente a la escena sin efecto en rondas
   alternadas. Criterio: ≤ 1,3× por muestra en cada preset. Solo si alguno
   pasa de 1,3×, lo primero de la fase es una rejilla de pantalla para los
   rayos de cámara de una cámara estenopeica (las partículas proyectadas;
   cada rayo prueba las de su píxel en lugar de recorrer la BVH). La BVH de
   las partículas se queda para los demás rayos; el tope por defecto no
   cambia.
2. **Un lóbulo hacia delante** para `DUST_MOTES`, `POLLEN` y `DUST_CLOUD`:
   dispersión de Henyey–Greenstein con g ≈ 0,7 (Henyey y Greenstein,
   *Diffuse radiation in the galaxy*, ApJ 1941; literatura pública), un
   lóbulo más del material de la partícula, muestreado y evaluado con el
   MIS de la NEE de E12, para que un foco detrás del producto las encienda
   en su haz. Criterio: `DUST_MOTES-back` de la hoja se ve; la energía se
   conserva (test).
3. **Gotas sin cáusticas**: un rayo de sombra que cruza una partícula
   refractiva pequeña (lluvia, burbujas) pasa con su cobertura y sin
   refracción; la refracción se queda para los rayos de cámara. Criterio:
   los puntitos de `RAIN-side` de la hoja desaparecen y la lluvia a
   contraluz no cambia a ojo.

**Depende de.** S4a, E12.

**Hecho.**

**1. El coste, medido primero.** `tools/ambient-sheet.mjs` gana una escena
de coste por preset (`cost-<CLAVE>`: el preset a su densidad sobre la
botella del ejemplo, con la clave lateral, como las de la hoja), además de
la de 200 000 motas, y las mide en **rondas alternadas**: cada ronda
renderiza la escena sin efecto y enseguida la del efecto (así la carga de
la máquina compartida pesa igual en las dos), su cociente es el coste por
muestra de esa ronda (las mismas muestras; la evaluación de las partículas,
una vez por carga, aparte) y la hoja da la mediana (`--rounds`,
`--cost-samples`, `--only cost`). Con el motor de S4a (512 × 288, 32 spp,
2 hilos, 3 rondas; `out/s4b-cost-before`, el binario de `09d8196`):

| Preset (partículas) | Rondas | Mediana |
| --- | --- | --- |
| Motas de polvo (1 912) | 1,15 / 1,28 / 1,18 | 1,18× |
| Polen (510) | 1,27 / 1,27 / 1,05 | 1,27× |
| **Lluvia (255)** | 2,08 / 1,76 / 2,02 | **2,02×** |
| Nieve (153) | 1,07 / 1,18 / 1,21 | 1,18× |
| Polvareda (4 889) | 1,37 / 1,14 / 1,08 | 1,14× |
| Ceniza (191) | 1,11 / 1,06 / 1,04 | 1,06× |
| Burbujas (127) | 1,24 / 1,19 / 1,14 | 1,19× |
| Confeti (64) | 1,07 / 1,11 / 1,14 | 1,11× |
| 200 000 motas (el tope, no un preset) | 2,93 / 2,70 / 2,99 | 2,93× |

La lluvia pasa de 1,3×, así que lo primero fue la **rejilla de pantalla**
(`geometry::particles`, `ScreenGrid`): con una cámara en perspectiva cada
conjunto guarda una rejilla de celdas de 4 px sobre la imagen (celdas
mayores si pasaría de 2²⁰) con, por celda, las partículas cuya caja
(ensanchada como la ven los rayos de cámara, con el margen de redondeo de
las cajas de la BVH, y una cápsula larga en hasta 32 trozos a lo largo de
su eje) proyecta en ella; un rayo de cámara prueba las de su celda (y las
que tocan el plano de la cámara, que prueba todo rayo) en lugar de
recorrer la BVH, con la misma prueba y el mismo orden: el mismo impacto,
bit a bit. Una caja delante de la cámara proyecta dentro de la envolvente
de sus esquinas y todo punto de un rayo que sale del centro proyecta donde
su dirección, así que la celda tiene todo lo que el rayo puede tocar. La
BVH se queda para los demás rayos; el tope por defecto no cambia.
**Pero la cámara del ejemplo y de la hoja (la de todo proyecto nuevo) es
una lente fina a f/5,6**, cuyos rayos no salen de un punto: la rejilla de
una estenopeica no la habría usado nunca (medido: 0 candidatos). Se
generaliza sin perder la exactitud: un rayo que sale del disco de la
apertura (radio `R`) y cruza el plano de foco (profundidad `z_f`) en `F`
pasa, a la profundidad `z`, a menos de `R |1/z − 1/z_f|` (en tangente) de
la proyección de `F`; cada rectángulo crece con ese círculo de confusión en
la peor profundidad de su caja y el rayo busca la celda de `F`. Un rayo que
no sale del disco (una lente trazada, la continuación desde un recorte)
recorre la BVH. La rejilla prueba todas las candidatas de la celda y la BVH
para en el impacto más cercano: una celda de más de 128 partículas
(`GRID_MAX_CANDIDATES`) manda su rayo a la BVH (sin tope, 200 000 motas a
128 × 72 costaban 721 M de instrucciones por muestra frente a 147 M sin
rejilla; medido el rayo de cámara de esas motas con topes de 16, 64, 128,
256 y ninguno, a 128 × 72, 512 × 288 y 1920 × 1080, 128 es el mejor o
empata con la BVH en los tres: 1 355, 457 y 153 ns frente a 1 313, 1 137 y
550 con 16). En la escena de coste de la lluvia, la rejilla deja 1,8
partículas candidatas por rayo de cámara.

Con la rejilla, el lóbulo y las gotas de abajo, y la cápsula que descarta
antes el rayo que no toca su cilindro infinito, el coste a las densidades
de los presets (el mismo método, 5 rondas, el binario final;
`out/ambient-sheet`, carga ≈ 2,8 en 4 núcleos) y, para quitar el ruido de
la máquina compartida, las **instrucciones por muestra** (*valgrind*,
deterministas: 3 spp menos 1 spp a 512 × 288, un hilo; antes, el binario de
`09d8196`):

| Preset (partículas) | Tiempo, rondas | Tiempo | Instrucciones, S4a | Instrucciones, S4b |
| --- | --- | --- | --- | --- |
| Motas de polvo (1 912) | 1,07 / 1,07 / 1,06 / 0,93 / 1,09 | 1,07× | 1,22× | 1,08× |
| Polen (510) | 1,02 / 1,10 / 1,14 / 1,07 / 1,05 | 1,07× | 1,15× | 1,07× |
| **Lluvia (255)** | 1,76 / 1,63 / 1,62 / 1,63 / 1,77 | **1,63×** | 1,75× | **1,50×** |
| Nieve (153) | 1,18 / 1,19 / 1,16 / 1,22 / 1,21 | 1,19× | 1,17× | 1,15× |
| Polvareda (4 889) | 1,15 / 1,14 / 1,09 / 1,13 / 1,09 | 1,13× | 1,21× | 1,10× |
| Ceniza (191) | 1,09 / 1,06 / 1,09 / 1,12 / 1,12 | 1,09× | 1,11× | 1,07× |
| Burbujas (127) | 1,13 / 1,03 / 1,18 / 1,09 / 1,21 | 1,13× | 1,11× | 1,10× |
| Confeti (64) | 1,11 / 1,16 / 1,14 / 1,07 / 1,10 | 1,11× | 1,11× | 1,11× |
| 200 000 motas (el tope, no un preset) | 2,00 / 1,94 / 2,08 / 1,91 / 1,91 | 1,94× | 2,17× | 1,94× |

Todos los presets quedan por debajo de 1,3× menos la lluvia. La escena sin
efecto pasa de 874,2 M a 879,5 M instrucciones por muestra (+0,61 %: las
comprobaciones nuevas del integrador; se saltan sin partículas y las
entradas del BSDF van en línea), con los mismos píxeles. La nieve, la ceniza
y el confeti son discos opacos: ni la rejilla ni nada de S4b les cambia gran
cosa.

**Por qué la lluvia sigue por encima** (contado con contadores en una copia
del motor, 512 × 288, 8 spp): sin efecto, la mayoría de los rayos de cámara
salen al fondo (1 179 648 rayos de cámara y 124 644 vértices sombreados);
con la lluvia, las estelas cubren el 26 % del cuadro y cada rayo de cámara
que toca una gota da dos vértices de vidrio (entrar y salir) y los rayos
que siguen: los vértices de las gotas solas son 699 326, 5,6 veces todos los
de la escena sin efecto. Es el transporte
de luz de un cuarto del cuadro de vidrio, no el recorrido de la BVH (la
rejilla lo dejó en 1,8 candidatas por rayo de cámara y 1,7 hojas por
recorrido de los rayos que siguen, a 10 spp). Lo que quedaba de trabajo inútil se
quitó: en una partícula clara y lisa (`is_mirror`: rugosidad al mínimo, sin
metal ni difuso) la estimación de siguiente evento solo busca luces delta
y las demás las encuentra su rayo BSDF, que cuenta lo que encuentra entero
(una densidad infinita en el MIS: la heurística de potencia da 1); la NEE
de un lóbulo de α = 10⁻³ no encontraba casi nada y trazaba un rayo de
sombra por vértice. Se probó acotar el rayo que entra en una gota por su
propia salida (exacto, con vuelta a la búsqueda entera): 0,7 % de las
instrucciones, se quitó.

**2. Lóbulo hacia delante** (`bsdf::forward`, con la cita de Henyey y
Greenstein, *Diffuse radiation in the galaxy*, ApJ 93, 1941). Un lóbulo
más del BSDF de la partícula: `(1 − s)·superficie + s·albedo·p(μ)/|cos θi|`
con `p(μ) = (1 − g²)/(4π (1 + g² − 2gμ)^{3/2})`, `μ = −wi·wo` (el coseno
entre la dirección de la luz antes y después), por unidad de radiancia y
ángulo sólido, sea cual sea la normal del punto tocado (la partícula
dispersa como una pequeña nube, no como una superficie; de ahí el
`1/|cos θi|`, que el integrador vuelve a multiplicar). Se elige con
probabilidad `s` y dentro `μ` por la inversa de su distribución acumulada
(isótropo si `|g| < 10⁻³`, el acimut uniforme, `sin`/`cos` de `fmath`);
`Bsdf::pdf` es la densidad de la mezcla, que es lo que el MIS de la NEE de
E12 pondera; la NEE lo evalúa con todas las luces (también las que no son
`glossy`, como el difuso). Sus rayos que atraviesan la partícula, y sus
rayos de sombra, salen de su cara del fondo (de la partícula ensanchada si
la tocó un rayo de cámara). `FXAM` crece a 200 B: `forward` (la cuota `s`,
0..1) y `forward_g` (−1 < g < 1); una carga de 192 B (S4a) no tiene
lóbulo. En la interfaz es parte del material propio del efecto
(`EffectMaterial.forward`, `forwardG`): g 0,7 en el polvo, el polen y la
polvareda, **cuota 0,5 (propuesta, regla 11)**, 0 en los demás; con un
material del catálogo, o uno transparente, ninguno (el motor no distinguiría
sus rayos de la refracción); un efecto guardado antes de S4b toma el de su
preset al abrirse. La escena de paridad (`example::ambient_scene`) lo da a
su polvo. `DUST_MOTES-back` se ve (hoja, arriba): las motas del haz
brillan donde antes casi no; con la clave lateral, la media de la imagen
pasa de 24,64 a 24,57 (de 255).

**3. Gotas sin cáusticas.** Una partícula de material claro
(`is_clear_material`: `(1 − metálico)·transmisión ≥ ½`, sin emisión:
lluvia, burbujas) la cruzan **rectas, enteras y sin refracción** los rayos
de sombra (si el efecto proyecta sombra, ahora la atraviesa: `passable`) y
los rayos de un camino que ya rebotó en un lóbulo ancho
(`RayClass::Rough`, `Tracer::trace_rough`: densidad de la muestra BSDF <
`SHARP_PDF` = 100 sr⁻¹, más ancho que un GGX de rugosidad ≈ 0,15), con la
transmitancia recta de una pared fina de su material (la de Fresnel de las
dos caras y su tinte, una vez) y desde más allá de su cara del fondo
(`Prepared::straight_through`); un rayo de esa clase solo ve el efecto si
proyecta sombra, y su cruce es un suceso recto (conserva la densidad y la
selección de luces del último vértice para el MIS). La cámara y los
caminos de lóbulos estrechos desde ella (un espejo, el vidrio liso de la
botella) siguen viendo las gotas refractar. Los fotones de las cáusticas
ya paraban en las partículas (no están entre las piezas que las enfocan,
S4a). En
`RAIN-side` desaparecen los puntitos del cuerpo y la etiqueta de la
botella y del suelo (hoja, recorte); `RAIN-back` no cambia a ojo.

**Tests** (cada uno con su mutación, en una copia del motor: las quince
lo hacen fallar, y pasan sin ella):
- `geometry::particles::grid_tests::camera_rays_find_through_the_screen_grid_what_brute_force_finds`
  (estenopeica, f/2 a 900 mm y f/1,4 a 300 mm; esferas, discos y cápsulas
  de 600 partículas, motas ensanchadas, algunas en el plano de la cámara o
  detrás; 6 000 rayos, también fuera del cuadro, por la rejilla, el mismo
  impacto que la fuerza bruta; un rayo que no sale de la lente, por la BVH;
  y una multitud de 40 000 cuyas celdas llenas mandan sus rayos a la BVH,
  con el mismo impacto). Mutaciones: sin el círculo de confusión; sin las
  partículas del plano de la cámara.
- `bsdf::forward::tests`: la fase integra 1 con `g` de coseno medio (g 0;
  0,3; 0,7; −0,5; 0,95); el muestreo da su densidad (histograma de `μ` a
  5σ); el horno blanco del BSDF (Lambert blanco y lóbulo blanco de cuota
  0,25, 0,5 y 1: 1 ± 1 % desde 0°, 45° y 80°) y la mezcla del polvo
  (`(1 − s)·superficie + s·color`, ± 1,5 %); pesos `f |cos| / pdf` y la
  densidad de la mezcla integra 1 en la esfera; sin lóbulo, los números de
  la superficie bit a bit. Mutaciones: la densidad sin el lóbulo; la
  evaluación sin `1/|cos θi|`.
- `integrator::particle_tests` (nuevo): `the_forward_lobe_is_unbiased_with_either_technique_and_with_both`
  (una mota blanca de 120 mm con una esfera de luz detrás y a un lado: MIS
  2,38148, solo NEE 2,38179, solo BSDF 2,38721; 4096 spp, 8 × 8; la mota
  proyecta sombra, así que prueba también que sus rayos salen de su cara
  del fondo); `a_white_mote_with_a_forward_lobe_vanishes_in_the_white_furnace`
  (cuota 0,5: 0,99997; 1: 1,00014); `a_light_behind_a_mote_lights_it_through_its_forward_lobe`
  (0,050 sin lóbulo, 2,38 con él); `rough_paths_do_not_see_a_drop_that_casts_no_shadow`
  (el suelo bajo una gota sin sombra es el suelo sin ella, bit a bit);
  `shadow_rays_cross_a_drop_straight_with_its_transmittance` (bajo la gota,
  0,9585 de la luz sin ella; la cuenta, `(1 − R)/(1 + R)` = 0,9607);
  `rough_paths_cross_a_drop_that_casts_shadows_as_shadow_rays_do` (una gota
  grande bajo un panel: MIS 2,18132, solo NEE 2,18133, solo BSDF 2,18051, y
  menos luz que sin ella); `camera_rays_still_see_a_drop_refract` (una bola
  de agua delante de una pared con la mitad izquierda encendida: la cámara
  la ve al revés, 0 a la izquierda y 0,956 a la derecha);
  `smooth_drops_leave_their_lights_to_their_bsdf_rays_without_bias`
  (10,85212 con la regla, 10,85208 con la NEE en la gota). Mutaciones: el
  rayo áspero ve la gota sin sombra; el rayo áspero refracta; el rayo de
  sombra la toma por sólida; cruza cada cara; no es `passable`; los rayos
  de sombra y los del lóbulo desde dentro de la mota; sin lóbulo; todo
  camino sigue nítido; la cámara la cruza recta; la regla de las gotas
  lisas con densidad 0.
- `rt-sim::params`: la carga de 200 B con sus desplazamientos, la de 192 B
  sin lóbulo, cuota fuera de 0..1 y `g` fuera de (−1, 1) rechazadas.
- TypeScript: `tests/effects.test.ts` (qué presets mandan el lóbulo, ninguno
  con un material del catálogo o transparente, los límites, un efecto de
  antes de S4b toma el de su preset) y `tests/effects-rsb.test.ts` (la carga
  byte a byte frente a la de `rt --write-ambient-example`, con el lóbulo
  del polvo).

***Hashes***: `PINNED_AMBIENT_4SPP` `0xeb60bea2` → `0x8f9efac8` (el lóbulo de
su polvo y su lluvia de vidrio, que proyecta sombra, cruzada recta por los
rayos de sombra y los ásperos), el mismo en escalar, SSE2, AVX2, en WASI
escalar y `simd128` y en el `rt.wasm` real (`wasm-parity.mjs`); las
partículas, `PINNED_AMBIENT_PARTICLES` `0xe38b8480`, no se mueven; ningún
otro *hash* se mueve (sin partículas, las escenas no cambian un bit). En
`engine.yml` el bloque de paridad de *Ambiente* lee los dos *pins* del
fuente; solo cambia su comentario.

**Hoja** `out/ambient-sheet.html` (512 × 288, 128 spp, 2 hilos): arriba,
antes y después (el binario de `09d8196` frente a este, `--rt-before`) de
`DUST_MOTES-back`, `POLLEN-back`, `DUST_CLOUD-back`, `DUST_MOTES-side`,
`RAIN-side` y `RAIN-back`, cada par con un recorte ×2; los ocho presets con
las dos luces; las motas con cuotas 0,25, 0,75 y 1 (las de arriba tienen
0,5); `RAIN-side` a 1 024 spp; las estelas y las suavidades de S4a; la
tabla de coste.

**Qué no encajó con el plan.**
- **La rejilla de una cámara estenopeica no habría servido**: la cámara de
  todo proyecto nuevo (y la de la hoja) tiene f/5,6. Se hizo para la lente
  fina también, exacta (arriba); sin ella el criterio no se habría movido.
- **La lluvia sigue por encima de 1,3×** (1,63× en tiempo, 1,50× en
  instrucciones, arriba): su coste es
  sombrear el vidrio que cubre un cuarto del cuadro, no recorrer la BVH. Lo
  que la bajaría ya no es exacto ni barato (estelas más cortas o menos
  densas, o gotas de cámara más sencillas): para el veredicto.
- **Los puntitos de `RAIN-side` tenían dos fuentes.** La que pedía el
  veredicto (las cáusticas: rayos del cuerpo y la etiqueta de la botella y
  del suelo que refractaban por las gotas hasta la clave) desaparece. La
  otra se queda, porque es la refracción que el veredicto conserva: la
  clave vista **a través de cada gota** por la cámara es un detalle
  diminuto y brillante dentro de cada estela, y a 128 spp sale granulado;
  converge (`RAIN-side` a 1 024 spp, en la hoja: las estelas salen
  lisas). Para el veredicto.
- **«Pasa con su cobertura»**: leído como la transmitancia recta de una
  pared fina de su material (Fresnel de las dos caras, una vez). Y no solo
  los rayos de sombra: la lluvia del preset no proyecta sombra, así que
  cambiar solo esos no tocaba los puntitos; los rayos BSDF del suelo y de
  la botella que la cruzan tienen que hacer lo mismo para que la NEE y el
  BSDF estimen lo mismo (test de las tres técnicas).
- **«La refracción se queda para los rayos de cámara»**: extendido a los
  caminos de lóbulos estrechos desde la cámara (`SHARP_PDF`), para que la
  lluvia se siga viendo a través del vidrio de la botella y en los
  espejos; con la regla estricta desaparecería ahí. Para el veredicto.
- **La regla de las gotas lisas** (NEE solo de luces delta) no estaba en
  el *brief*: sale del recuento de la lluvia; no cambia la media (test).
- **El lóbulo viaja en `FXAM`, no en `MATL`**: es del efecto (su material
  propio), `MATL` es el de las piezas (y lo está cambiando M2b); solo con
  material opaco. *Rápido* no lo enseña (los puntos de la vista previa).
- La cápsula descarta el rayo que no toca su cilindro infinito antes de
  calcular raíces (−2 % de las instrucciones de la lluvia); la cota del
  rayo que entra en una gota se probó y se quitó (0,7 %).
- **TRIAGE 1.2** (forma de gota y geometrías variadas, decisión pendiente,
  regla 11; no se hizo): lo que deja hecho S4b: la rejilla y la BVH son
  por conjunto y ya parten una cápsula en trozos (`camera_boxes`), así que
  una forma nueva solo necesita su prueba de impacto, su normal, su salida
  (`exit`) y sus cajas; la mezcla de formas por partícula sería un código
  de forma por partícula en `rt-sim` y en `ParticleSet` (todas las rutas
  ya despachan por forma en `hit`, `exit` y `normal`); y una gota en
  lágrima de agua sería clara (`is_clear_material`) y lisa (`is_mirror`),
  así que heredaría las reglas de cáusticas y de NEE sin tocarlas.

**Para el veredicto** (regla 11):
1. La **cuota del lóbulo**: 0,5 propuesta; la hoja tiene 0,25, 0,75 y 1
   con las dos luces. Con más cuota, las motas del haz brillan más y las de
   la clave lateral pierden algo de su difuso.
2. El **coste de la lluvia** (1,63× en tiempo, 1,50× en instrucciones):
   aceptarlo, o estelas más cortas o menos densas en el preset, o una gota
   de cámara más sencilla.
3. El **grano dentro de las estelas** con la clave lateral (la refracción
   que se queda): aceptarlo como ruido que converge o regularizarlo.
4. La **regla de los caminos nítidos** (`SHARP_PDF`) frente a «solo los
   rayos de cámara» estrictos.

## Físicas: cuerpos rígidos, telas y líquidos — decisión **Fable**

Petición del usuario (14-10): físicas realistas con *Iniciar / Parar*
propio (por defecto parado); «**Dejar caer**» en el menú contextual de un
modelo o sólido, con la simulación parándose sola cuando los sólidos se
quedan quietos; **telas** sobre una cara o un sólido de un modelo, con el
comportamiento según el **gramaje** y el tipo de tejido (un algodón fino
no se pliega como un cuero grueso) y la **rigidez** a elegir;
**líquidos** por viscosidad, pudiendo convertir un sólido en líquido; y
que todo sirva también para animaciones. Son S2, S9 y S7 de
`STUDIO-TOOLS.md` §5 y `docs/research/particles.md` §6. Decisiones:

1. **Dónde vive.** Un *crate* nuevo `engine/crates/rt-phys` (solo `std`,
   sin `unsafe`, determinista: `f32`, `fmath`, paso fijo de 1/240 s con
   4 subpasos, contactos ordenados por (id, id, rasgo), *hash* de las
   transformaciones igual con 1 y N hilos y nativo = wasm; v1 en un
   hilo). Un único marco de **dinámica por posiciones extendida (XPBD)**:
   rígidos (Müller, Macklin, Chentanez, Jeschke, Kim, "Detailed Rigid
   Body Simulation with Extended Position Based Dynamics", SCA 2020),
   telas (Macklin, Müller, Chentanez, "XPBD", MIG 2016), líquidos (PBF,
   Macklin y Müller 2013). Separado de `rt-sim` (S4a, sin estado).
2. **Dónde corre.** En la interfaz, en un *worker* por `rt-wasm`
   (`phys_*`): el visor Rápido enseña la simulación en vivo sin tocar el
   *store*; **Parar** confirma la pose actual como **una** acción
   deshacible; **Reiniciar** vuelve a la pose previa. Nativo no hace
   falta en v1 (el escritorio usa la misma interfaz).
3. **La barra de físicas** (abajo, junto a la de animación): ▶ Iniciar ·
   ⏸ Pausar / ▶ Reanudar · ■ Parar · ↺ Reiniciar, tiempo simulado,
   cuerpos despiertos, estado (*parado* por defecto). Pausar congela la
   simulación donde está (las telas, los líquidos y la lluvia son caros:
   el usuario decide cuándo seguir); Parar la confirma; Reiniciar la
   deshace. El medidor dice lo que el simulador dice
   (regla 10). Una sección **Físicas** en el inspector de pieza: papel
   (estático / dinámico / tela / líquido), masa por densidad (tabla por
   familia de material; se puede fijar), rozamiento, rebote, *como
   piezas* (un grupo cae como un cuerpo o cada pieza por su cuenta).
4. **Dormir.** Un cuerpo con velocidad bajo umbral durante 0,5 s duerme;
   con todos dormidos la simulación se para sola y confirma la pose.
5. **Animación.** **Toda simulación entra sola en la animación** (petición
   del usuario, 14-10): al iniciar, nace un clip de movimiento `PHYSICS`
   en la línea de tiempo (pista horneada: posiciones y cuaterniones por
   fotograma a los fps del proyecto, `f32`, guardada con el proyecto) que
   crece mientras la simulación corre, se queda donde se para y la línea
   de tiempo de N1 reproduce como cualquier otro clip; *Reiniciar* lo
   quita (deshacible). No hay un paso aparte de «grabar»: la foto fija
   usa el fotograma del cabezal, y la animación ya tiene la simulación. Las telas y los líquidos guardan su malla por
   fotograma en una caché junto al proyecto (clave = *hash* de
   parámetros + geometría + semilla + versión).
6. **Orden.** S2 ahora (base de todo); S9 y S7 después de S2, cuando la
   máquina lo permita (ocho agentes en paralelo ya la saturan).

### S2 · Cuerpos rígidos: «Dejar caer», la barra de físicas y grabar — **Opus** — hecha

**Qué.** `rt-phys` v1: cuerpos rígidos XPBD con **envolvente convexa**
automática por pieza (*quickhull* propio) para los dinámicos, y las
piezas estáticas y el suelo como mallas de triángulos (la BVH de
`rt-core`); contactos envolvente–envolvente (ejes separadores / GJK–EPA
propios) y envolvente–triángulos; rozamiento de Coulomb, restitución,
dormir (§4). Gravedad −Z (el modelo es Z-arriba), 9,81 m/s², mm en la
escena. `rt-wasm` exporta `phys_new(escena)`, `phys_step(n)`,
`phys_poses()`, `phys_awake()`. Interfaz: **Dejar caer** en el menú
contextual y en el menú *Pieza* (las piezas seleccionadas pasan a
dinámicas, el resto y el suelo a estáticos, arranca y se para sola al
dormir; con un grupo, *como piezas* decide), la barra de físicas (§3), la
sección *Físicas* del inspector (§3), *Grabar como animación* (§5) con el
clip `PHYSICS` en `src/core/animation.ts` y la barra en la línea de
tiempo. Doctor: avisa si una pieza dinámica atraviesa el suelo al
empezar. Cadenas es/en; cromo acromático; todo por el *store*.

**Depende de.** U3 (mover), U9 (primitivas), N1 (animación).

**Criterio.** Tests de `rt-phys`: una esfera cae sobre el suelo y
descansa a `z = r ± 0,1 mm`; una pila de tres cajas se queda apilada 5 s;
una caja inclinada 30° cae de lado y descansa plana; el cubo sobre una
esfera estática resbala y cae; mil esferas se asientan en < 20 s en
nativo, un hilo (el tiempo va en el párrafo del ROADMAP); dormir para la
simulación; *hash* de poses igual con 1 y N hilos y nativo = wasm;
tests de interfaz (mutación comprobada): *Dejar caer* es una sola acción
deshacible, *Reiniciar* restaura, el clip `PHYSICS` se guarda y se abre.
Comprobación de navegador `tools/physics-check.mjs` con capturas
`docs/ui/physics-bar.png`, `docs/ui/physics-drop.png` (antes/después de
dejar caer tres primitivas sobre el suelo) y un GIF o tira de 6
fotogramas `docs/ui/physics-drop-strip.png`. `SPEC.md` §3.1 y §3.7,
`UI.md`, `ARCHITECTURE.md` (crate `rt-phys`, el *worker*), CHANGELOG.

**Hecho.** En tres pasos:

- **`engine/crates/rt-phys`** (solo `std` y `rt-core`, `#![forbid(unsafe_code)]`):
  XPBD de Müller et al. (SCA 2020) a 1/240 s con 4 subpasos; envolvente
  convexa por *quickhull* propio (Barber et al. 1996, caras coplanarias
  fundidas por normal y por distancia al plano) con tope de 128 vértices y
  caja orientada por componentes principales de reserva; esferas
  reconocidas como tales (≥ 26 puntos al 0,2 % del radio) y tratadas como
  esferas exactas; contactos por ejes separadores con poda por el mapa de
  Gauss (Gregorius), recorte de Sutherland–Hodgman, ≤ 4 puntos, márgenes
  especulativos; rozamiento de Coulomb, restitución con el umbral 2|g|h,
  dormir y despertar; el formato PHY1; `World` (`add_floor`,
  `add_static_mesh`, `add_dynamic`, `step`, `poses`, `awake_count`,
  `settled`, `hash`). Once tests en `tests/rigid.rs`, los del criterio más
  una rampa (sostiene a μ 0,6, resbala a 0,1), la caída fijada por *hash*
  a 60, 90, 120 y 480 pasos (`tests/fixtures/phys-drop.json`) y el *hash*
  igual con 1, 2, 3, 5, 8 y 13 trozos de fase estrecha y con 3 hilos.
  **Mil esferas** (radio 10 mm, diez capas de diez por diez en una bandeja)
  se asientan en **1,70 s simulados**; en *release*, un hilo, **7,05 s**
  de reloj en la máquina virtual de 4 núcleos con otros siete agentes
  compilando (carga ~30; una medida anterior con menos carga dio 2,4 s de
  CPU).
- **`rt-wasm`**: `phys_new`, `phys_free`, `phys_step`, `phys_bodies`,
  `phys_ids`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_steps`,
  `phys_hash`, sobre un registro de mundos por *handle*. Nativo = wasm:
  los tests de `rt-phys` pasan compilados a `wasm32-wasip1` con los mismos
  *hash*, y `tests/physics-engine.test.ts` repite la caída fijada con el
  `rt.wasm` real.
- **Interfaz**: `core/physics.ts` (papeles, densidad por familia de
  material, `physicsSpec`, las poses de vuelta a los nodos dentro de grupos
  girados y escalados, la pista `PHYSICS` y su ancla, las acciones
  `physics/*`), `io/phys.ts` (PHY1), `render/physics-worker.ts` y
  `physics.ts`, `ui/physics.ts` (la simulación en marcha), la barra de
  físicas, la sección *Físicas*, *Dejar caer* en el menú contextual, en el
  inspector y en la paleta, el clip `PHYSICS` en la línea de tiempo y el
  chequeo `physics` del Doctor (16 chequeos con el `aspect` de U13; 16 tipos
  de animación).
  `tests/physics.test.ts` (24 tests, cada uno comprobado reintroduciendo su
  error) y `tools/physics-check.mjs`, con las tres capturas.

**Lo que no encajó con el plan** (regla 12):

- **No hay menú *Pieza* en la cabecera.** *Dejar caer* está en el menú
  contextual (el mismo en el árbol y en el visor), en las secciones *Pieza*
  y *Físicas* del inspector y en la paleta.
- **«La BVH de `rt-core`»**: la de `rt-core` responde a rayos (anchura 4/8,
  SAH), no a «qué triángulos tocan esta caja»; `rt-phys` tiene la suya,
  pequeña (mediana, hojas de 4), y `rt-core` no se toca. **GJK–EPA** no
  hizo falta: ejes separadores para envolvente–envolvente y
  envolvente–triángulo, y esfera analítica. El suelo es un solo triángulo
  enorme: con dos, la diagonal sesgaba el rozamiento.
- **Desviaciones del artículo** que hicieron falta para que una caja quieta
  no derive ni gire y una pila de tres no se caiga: rozamiento por parche
  (en su centroide, con torsión por el radio del parche, y como mínimo un
  brazo de rodadura: una bola que giraba sobre su punto de apoyo no
  paraba) y no por punto;
  **anclas** de rozamiento estático que se guardan de paso a paso; el
  dinámico como impulso de como mucho μλ/h; los parches coplanarios de un
  cuerpo contra lo estático fundidos en uno; resistencia a la rodadura de
  0,02 r (una bola que rueda acaba parándose); dormir por recorrido en una
  ventana de 0,5 s y no por velocidad instantánea (el temblor de contacto
  no dejaba dormir nada); despertar solo por algo que se acerca deprisa
  (las cadenas de despertares no dejaban asentarse a las mil esferas).
- **El cubo sobre la esfera**: sobre una esfera teselada gruesa un cubo
  puede descansar de verdad en una faceta. El test usa una esfera de 32 × 64,
  μ 0,2 y el cubo un poco desplazado de la cumbre; resbala y cae.
- **El tiempo de las mil esferas** se exige (< 20 s) solo en *release*; en
  *debug* el test comprueba que se asientan.
- **Las exportaciones** son más que las cuatro del plan (`phys_new(escena)`,
  `phys_step(n)`, `phys_poses()`, `phys_awake()`): un *handle* por mundo y
  `phys_ids` (dónde quedó cada cuerpo; uno sin masa no se simula).
- **Grabar** (decisiones 3 y 5, cambiadas a mitad de fase): no hay botón
  *Grabar como animación*; toda simulación se graba sola en un clip
  `PHYSICS` por cuerpo que crece mientras corre. Por eso la decisión 2
  («el visor Rápido enseña la simulación en vivo sin tocar el *store*») se
  cumple a medias: los **nodos** no cambian hasta confirmar, pero los
  clips crecen y el cabezal los sigue por el *store* (`physics/grow`,
  `anim/playhead`, en el gesto de la simulación: una entrada de deshacer
  con el comienzo y la confirmación), y el visor la enseña por la
  animación. Mientras corre, el visor se queda en *Rápido*.
- **Pausar en una página cargada.** La comprobación del navegador encontró
  que, con el hilo principal ocupado, el *worker* acababa la simulación
  antes de que la página viera la pausa. Ahora la página acusa recibo de
  cada envío y el *worker* no va más de 1/8 s por delante (va más despacio
  en vez de acabar sin verse), lo que llega en pausa espera a *Reanudar*,
  *Parar* confirma la pose que se ve (no la que el simulador alcanzó
  después), y una pausa pedida antes de que el *worker* tenga la
  simulación le llega justo después. Con sus tests.
- **El ancla del clip** (no estaba en el plan): sin ella, un clip `PHYSICS`
  clavaba el nodo en sus fotogramas y la pieza ya no se podía mover después
  de una caída. El clip guarda la pose a la que se refiere (`anchor`) y se
  reproduce movido por lo que el nodo se haya movido desde entonces.
- **El cabezal en 0** (para el criterio de **Fable**): N1 enseña en 0 la
  escena como se edita, y tras una caída desde 0 la pose editada ya es la
  final, así que en 0 se veía la pieza en reposo y un fotograma después en
  el aire. Lo construido: en 0 los nodos que sostiene una simulación grabada
  enseñan su fotograma (también la foto fija: «usa el fotograma del
  cabezal»), el resto como se edita, y el *gizmo* no sale sobre esos nodos
  en 0 (como no sale con el cabezal pasado 0). La otra opción, cumplir N1 a
  rajatabla, es quitar `playheadPose` y su regla del *gizmo*.
- **Densidad por familia de material**: la tabla va por las siete
  `MATERIAL_CATEGORIES` (metal, plástico, madera, tela, vidrio, emisivo,
  otro), que es la clave estable que tiene cada material; los valores son
  típicos, para que **Fable** los revise.
- `migrateProject` (`io/project.ts`) vuelve a pasar el Doctor al abrir,
  como ya hacía `loadProject`: con un chequeo nuevo, un proyecto abierto
  por él traía los resultados de antes. La rama de la sesión hizo lo mismo
  (U13); al unir queda una sola vez, la suya, con el test de S2 que falla
  sin ella.
- CI no se toca (`.github/` queda fuera de la fase): la paridad nativo =
  wasm la comprueban los tests de `rt-phys` en `wasm32-wasip1` y
  `tests/physics-engine.test.ts` cuando hay `rt.wasm`.
- **Al unir la rama de la sesión** (N6, E12, U13, P6/P6b, O1, U12, L6,
  M2a, P5): el clip `PHYSICS` vive en la línea de tiempo de tres zonas de
  N6 (sus propiedades: inicio, duración, fin, repetir, invertir y la nota;
  sin cantidad ni curva), pasa por el mismo tiempo que cualquier clip
  (`clipPhase`: repetido, invertido) y `playheadPose` respeta
  `poseActive` de N6 (un clip invertido sostiene su final antes de
  empezar). El Doctor: los 14 de origen, `aspect` (U13) y `physics` (S2).

**Veredicto del responsable.**

1. **El cabezal en 0**: confirmado tal como está construido. En 0, los
   nodos que sostiene una simulación grabada enseñan el fotograma de su
   clip (en el visor y en la foto fija) y el *gizmo* no sale sobre ellos.
   Razón: el fotograma 0 de una animación renderizada tiene que ser el
   principio de la caída, y la foto fija sigue al cabezal, que una
   simulación deja al final, así que *Dejar caer* y renderizar da la pose
   en reposo; cumplir N1 a rajatabla metería un salto entre los fotogramas
   0 y 1 de toda animación. Se quedan `playheadPose` y la regla del
   *gizmo*.
2. **Densidades por familia de material**: aceptadas como valores
   típicos; se revisan con las fases de materiales (M4), no ahora.
3. **La decisión 2 a medias** (los clips crecen por el *store*, dentro de
   la única entrada de deshacer de la simulación): aceptado. Es justo lo
   que pide «toda simulación se graba sola», y una entrada de deshacer es
   lo correcto.
4. El resto de lo anotado (del menú *Pieza* a la paridad sin tocar CI):
   aceptado tal cual. El Doctor que se vuelve a pasar en `migrateProject`
   se queda, con su test.

### S9 · Telas con físicas reales — **Opus** (tras S2)

**Qué.** Tela XPBD (distancia, flexión por diedro, área opcional) sobre
**una cara** (la malla de la pieza elegida o de la cara seleccionada por
niveles) o **un sólido** (su cáscara, con presión para cerrados: cojín,
envase blando). Presets por **tipo de tejido y gramaje** (`src/data/
fabrics.ts`, claves estables: seda 60 g/m², algodón fino 120, popelín
150, lino 200, lana 300, vaquero 400, lona 600, fieltro 800, cuero fino
900, cuero grueso 1 200, neopreno 1 500…) con masa por área, rigidez de
estiramiento, de flexión y amortiguación; **Rigidez** y **Gramaje**
editables por encima del preset, y *Grosor* para la colisión. Colisión
con las piezas estáticas y los rígidos de S2, autocolisión por rejilla
de dispersión, anclajes (por selección de vértices en caja o por la
arista superior), viento de S4a. Preset *Caer sobre la pieza* (un plano
de tela sobre el producto). La barra de físicas y *Grabar* de S2; la
malla de la tela por fotograma en la caché (§5). **El sombreado del
tejido es M5**, no esta fase.

**Criterio.** Un paño de 1 m cuelga de dos esquinas y su punto más bajo
queda dentro del 2 % de la catenaria analítica para el gramaje; la seda
y el cuero grueso, con el mismo paño sobre la esfera, dan arrugas de
distinta escala (métrica: curvatura media; la seda ≥ 3× la del cuero);
nada atraviesa la esfera (test de distancia mínima); determinismo;
hoja `out/cloth-sheet.html` con los presets sobre la botella del ejemplo.

### S7 · Líquidos — **Opus** (tras S2 y el dieléctrico anidado)

**Qué.** Fluido de posiciones (PBF) con viscosidad (XSPH), cohesión y
tensión superficial; presets (`src/data/liquids.ts`: agua, aceite,
miel, leche, gel, sirope…) con densidad, viscosidad y color/absorción;
**Convertir en líquido** en el menú contextual: la pieza se rellena de
partículas por paridad de rayos, se oculta y nace una pieza *Líquido*
cuya superficie se reconstruye por cubos marchantes cada fotograma (en
el *worker*); los recipientes son las piezas estáticas. Motor:
**dieléctricos anidados** por prioridad (Schmidt y Budge, "Simple Nested
Dielectrics in Ray Traced Images", JGT 2002) para líquido dentro de
vidrio; material vidrio con absorción. Barra, *Grabar* y caché de S2.

**Criterio.** Un litro vertido en un vaso cerrado conserva el volumen
± 3 %; la miel tarda ≥ 5× más que el agua en nivelarse (test); nada
atraviesa el vaso; determinismo; hoja `out/liquid-sheet.html`.

### S3 · Lluvia y polvo sobre el set y sobre la lente — **Opus** (tras S4a y S2)

Petición del usuario (14-10): la lluvia de S4a cayendo sobre el set y la
pieza y **resbalando** de forma realista; el polvo **asentándose**; y que
gotas y polvo puedan afectar **a la lente** o no, como un cristal por
delante. Es cálculo caro: va en el *worker* de físicas con Pausar /
Reanudar, con caché y entra solo en la animación (§3 y §5 de arriba).

**Qué.**
1. **Gotas sobre superficies.** Una partícula de lluvia de S4a que toca
   una superficie (su recorrido es determinista por semilla: los
   aterrizajes son eventos reproducibles) nace como **gota**: casquete
   esférico pegado a la superficie (esfera con el centro bajo ella, el
   motor ya traza esferas: S4a), con material agua (vidrio IOR 1,33). Las
   gotas **crecen al juntarse**, quedan **ancladas** por la histéresis
   del ángulo de contacto del material (mojabilidad por familia:
   vidrio, plástico, metal, papel, pintura; tabla en `src/data/`) y
   **resbalan** cuando su peso a lo largo de la tangente la vence,
   dejando un **rastro mojado** (película fina: baja la rugosidad y
   oscurece lo poroso: máscara de humedad en el material) y recogiendo
   las gotas que encuentran; en una arista **gotean** (vuelven a ser
   partículas que caen) y al chocar salpican (gotas secundarias). Nieve:
   se acumula como capa (perfil de S4a) y no resbala.
2. **Polvo asentado.** Campo de cobertura por superficie (rejilla de
   téxeles por pieza o por vértice) que acumula lo que el flujo de polvo
   de S4a deposita (exposición hacia arriba × tiempo × densidad), con
   **ángulo de reposo** (de las caras empinadas se desprende) y que la
   lluvia **limpia** por donde pasa el rastro. Se renderiza como capa
   (difuso grisáceo que sube la rugosidad, mezclado por cobertura) con
   motas visibles (discos minúsculos de S4a donde la cobertura es alta).
3. **El cristal de la lente.** En Cámara ▸ Lente ▸ Filtros, **Cristal
   frontal** (sí/no): una lámina pegada a la cámara a la distancia del
   elemento frontal (20–40 mm de la pupila, según la lente) sobre la que
   caen la lluvia y el polvo de los efectos de la escena con los mismos
   modelos (las gotas resbalan según el *arriba* de la cámara; el polvo
   se asienta si mira hacia arriba). Es **geometría real** delante del
   objetivo: los rayos de cámara la atraviesan y cada gota refracta
   como la lente que es (manchas invertidas y muy desenfocadas, como en
   una foto de verdad), el polvo son motas oscuras y suaves. Mandos
   manuales para una foto fija sin simular: cantidad de gotas, tamaño,
   polvo, semilla. Sin el cristal, nada toca la lente.
4. **Simulación.** En `rt-phys` (paso fijo, determinista), con la barra
   de físicas (Pausar / Reanudar), caché junto al proyecto (gotas por
   fotograma, cobertura por fotograma, clave = *hash* de parámetros +
   geometría + semilla + versión) y el clip `PHYSICS` automático (§5).
   El visor Rápido enseña las gotas como esferas y la cobertura como
   tinte; el motor renderiza lo real.

**Depende de.** S4a (partículas y primitivas), S2 (`rt-phys`, barra,
caché, clip), O1 (`LENS`: la distancia del elemento frontal).

**Criterio.** Tests: una gota sobre vidrio inclinado 30° se queda hasta
el radio crítico de la tabla y resbala por encima (test numérico contra
el equilibrio tangente/ángulo de contacto); dos gotas que se tocan
suman volumen (± 1 %); el rastro limpia el polvo; la cobertura de polvo
en una cara a 60° es < 10 % de la horizontal; el cristal frontal con 0
gotas y 0 polvo deja el render bit a bit igual que sin cristal;
determinismo y caché reproducible; el clip existe tras iniciar y
desaparece con Reiniciar (deshacible). Hoja `out/rain-dust-sheet.html`:
la botella bajo lluvia a 0, 2, 5 y 15 s (gotas, rastros, goteo), polvo a
0, 30 y 120 s, y la misma foto con el cristal frontal mojado y con
polvo; a ojo (veredicto **Fable**). Capturas `docs/ui/physics-rain.png`,
`docs/ui/lens-glass.png`. `SPEC.md`, `UI.md`, `ARCHITECTURE.md`,
CHANGELOG.

## M5 · Tejido hilo a hilo y pelusa real — **Opus**, veredicto **Fable** (tras E6 y E9; la pelusa tras S8)

Petición del usuario: tipo de tejido (*plain weave*, sarga…) simulado
hilo a hilo y una pelusa editable y real. Dos partes:

**M5a · Tejido.** Material `WOVEN` con tipos de ligamento (`src/data/
weaves.ts`, claves estables): tafetán, sarga 2/1 y 3/1, raso de 5,
panamá, espiga, punto (jersey), gabardina; parámetros: hilos por cm
(urdimbre y trama), anchura de hilo, torsión, color de urdimbre y de
trama, rugosidad de fibra, anchura del brillo, *sheen*, desgaste. Modelo
de sombreado por hilo de Irawan y Marschner, "Specular Reflection from
Woven Cloth", ACM TOG 2012 (público), implementado desde el artículo: el
patrón del ligamento da el segmento de hilo visible en cada punto y el
BRDF del hilo (fibras con torsión) la reflexión; el bump del tejido sale
del mismo patrón (sin texturas). El visor Rápido aproxima con un
*sheen* y el patrón como normal procedural. Reemplaza a la tela
procedural de E6 como «tela realista»; la de E6 queda como «tela
sencilla» (claves estables, no se renombra nada).

**M5b · Pelusa.** Después de **S8** (primitiva de curva, BVH de curvas y
sombreado de fibra en el motor): pelusa **geométrica** generada en el
motor desde parámetros (como `FXAM`: densidad por cm², longitud ±
variación, radio, rizo, gravedad, semilla, solo en caras visibles) en el
material *Pelusa* del inspector, con vista previa de puntos en el visor.
Sombreado de fibra: difuso + dos lóbulos (R y TT) primero; Marschner
después.

**Criterio.** M5a: tafetán, sarga y raso se distinguen a 1 cm de distancia
en la hoja (esferas con `rt`); el brillo del raso es anisótropo y gira
con la trama (test numérico); energía ≤ 1 (horno blanco). M5b: 100 k
fibras ≤ 1,5× el tiempo por muestra; determinismo; hoja con cuatro
densidades.

## U12 · Salida en TIFF y RAW (DNG) — **Sonnet** — hecha

Petición del usuario: que las imágenes puedan salir en TIFF y en RAW.
**Decisión Fable.** RAW = **DNG lineal en coma flotante** (DNG 1.4, TIFF
con `PhotometricInterpretation = LinearRaw`, 32 bits `f32`,
`ColorMatrix1` = XYZ → primarios sRGB lineales (la inversa de la matriz
sRGB → XYZ D65), `AsShotNeutral = 1 1 1`, `BaselineExposure 0`,
`UniqueCameraModel = "Repackshot"`): un revelador fotográfico lo abre
como un *raw* con toda la latitud del render, sin recorte. TIFF: sin
compresión (baseline, *little-endian*), 8 y 16 bits RGB/RGBA y 32 bits
flotante RGB/RGBA (`SampleFormat 3`, lineal), con resolución y sin
perfil ICC (el de 8/16 bits lleva sRGB implícito; el flotante es
lineal, como el EXR). Las especificaciones TIFF 6.0 y DNG son públicas;
nada copiado de ningún lector.

**Qué.** Codificadores en los dos lados, como el EXR: `rt-core::tiff` y
`rt-core::dng` (solo `std`) para el escritorio y el CLI (`rt --format
tiff|dng`), y `src/io/image.ts` (`encodeTiff`, `encodeDng`) para el
navegador, con test de **paridad de bytes** entre ambos. Ventana de
render: formato *TIFF* (bits: 8, 16, 32 flotante; alfa) y *RAW (DNG)*
(sin alfa); el visor de resultados los guarda y los abre (vista previa
desde los datos lineales); `formatExtension`, `supportsAlpha`,
`WRITABLE_FORMATS`; cadenas es/en con una ayuda breve de cada formato.

**Criterio.** Tests: una imagen de 4×4 con valores conocidos escrita en
cada variante se relee bit a bit con un lector mínimo del test (las
etiquetas, los *offsets* y los valores); TS = Rust en bytes; el DNG
contiene las etiquetas obligatorias de DNG 1.4 y la matriz es la
inversa de sRGB→XYZ (producto = identidad ± 1e-6); el visor de
resultados muestra la vista previa de un TIFF de 32 bits; capturas
`docs/ui/render-format-tiff.png`. `UI.md`, `ARCHITECTURE.md` §5,
CHANGELOG.

**Hecho.** `rt_core::tiff` y `rt_core::dng` (solo `std`, de TIFF 6.0 y
DNG 1.4; el constructor de directorios es común: un DNG es un TIFF con
más etiquetas) y, en `src/io/image.ts`, `encodeTiff` y `encodeDng`, que
escriben **los mismos bytes**: `tests/fixtures/tiff/` guarda ocho archivos
(RGB y RGBA a 8, 16 y 32 bits, uno de dos *strips* y el DNG) que
`rt-cli/tests/tiff_golden.rs` y `tests/tiff-dng.test.ts` comparan con cada
codificador, y cada lado se relee con un lector mínimo propio de su test
(etiquetas ordenadas, desplazamientos pares, valores empaquetados,
*strips* sin huecos, cada muestra); los archivos también los abren
ImageMagick/libtiff y PIL, lectores ajenos usados solo para comprobar.
`ColorMatrix1` es la inversa de sRGB → XYZ de los primarios y el blanco
D65, calculada en aritmética exacta y guardada con denominador 10⁷
(producto con sRGB → XYZ = identidad con error < 3·10⁻⁷, el test pide
1·10⁻⁶). La interfaz: `OutputFormat` con `TIFF` y `DNG`, `BitDepth` con 32
(solo TIFF), `bitDepthsOf`, `needsDisplayCopy` y `needsLinearSums` en
`core/render.ts`; el normalizador quita el alfa al DNG y los 32 bits a todo
lo que no sea TIFF; la ventana ofrece *TIFF* (8, 16, 32 bits flotante,
alfa) y *RAW (DNG)* (sin alfa, «32 bits flotante» fijo) con una línea de
ayuda cada uno; el render guarda junto al archivo una copia PNG de 8 bits
para el visor y las miniaturas (como el EXR) y el historial de escritorio
la pide también para TIFF y DNG; el lanzador guarda `image/tiff` e
`image/x-adobe-dng` y escribe `.tif`, `.tiff` y `.dng`; `rt` escribe
`--format tiff|dng` y `--bits 8|16|32` (o por la extensión de `-o`). La IA
(`encodeLinear`) escribe también los dos formatos. Pruebas: 39 de
TypeScript (`tests/tiff-dng.test.ts`, y una más en `ai-results` y en
`render-queue`) y 22 de Rust (`rt-core`, `rt-cli`, `rt-app`), cada una
comprobada reintroduciendo el fallo que vigila; y en el navegador,
`tools/render-format-check.mjs` y `docs/ui/render-format-tiff.png`.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
**Fable**, que decide si se cambia):
- ◆ `WhiteLevel`: el encargo decía «el máximo del flotante». Un `WhiteLevel`
  igual al mayor `f32` haría que un revelador, al normalizar por él, dejara
  la imagen negra; se escribe **1** (`LONG`, el blanco del render; el negro
  queda en 0 y los datos no se recortan a él, así que la latitud sigue
  entera). Si Fable quería otra cosa, es una constante en cada codificador.
- Los DPI: el encargo fijaba 72; `encodeTiff` escribe los de la ventana (72
  si no se le dan, y 72 fijos en `rt`, que no tiene `--dpi`).
- La copia PNG para el visor se hace también para el TIFF de 8 y 16 bits
  (Chromium no decodifica TIFF de ninguna profundidad), no solo para el de
  32.
- En el DNG, `bitDepth` queda en 8 como en el EXR y el JPEG («la profundidad
  que no se elige»); lo que se ve es una etiqueta fija «32 bits flotante».
- «Un test de DOM como los del visor»: no hay ninguno (vitest corre sin DOM
  y el visor solo se ha probado en el navegador). Hay `previewOf` (lo que
  decodifica el visor, con test), el historial de memoria y el de escritorio
  con TIFF y DNG, y `tools/render-format-check.mjs`, que renderiza en
  Chromium un TIFF de 32 bits y un DNG y comprueba que los píxeles del
  canvas del visor son los del PNG del mismo render.
- La imagen de la IA de un trabajo TIFF o DNG se guarda en su formato pero
  el visor no la compara con el render (no la puede decodificar), igual que
  con EXR (`UI.md`, X3c); la copia para la vista de la imagen de la IA
  sigue pendiente.
- `rt` escribe color solo (sin alfa), como con PNG.

## U13 · Proporción de la imagen en la cámara — **Sonnet** — hecha

Petición del usuario (14-10): editar la **proporción** (16:9, 4:3… o una
propia) **en la propia cámara**, además de en la ventana de render.

**Decisión Fable.** La proporción es **de la cámara**: cada cámara lleva
la suya (`CameraState.aspect: { preset, w, h }`; presets con claves
estables en `src/data/aspects.ts`: `3:2`, `4:3`, `16:9`, `1:1`, `5:4`,
`4:5`, `9:16`, `21:9`, `2:1`, `65:24` panorámica y `CUSTOM` con `w:h`
libres), el **marco del visor** sigue a la cámara activa, y la ventana
de render **lee y escribe la misma** proporción (una sola fuente): el
tamaño en píxeles conserva el ancho y deriva el alto de la proporción de
la cámara activa; teclear los dos lados con el candado abierto deja una
proporción propia **en la cámara**; elegir un preset de tamaño con otra
proporción cambia la de la cámara (y lo dice en una línea). *Nueva desde
la vista* copia la proporción de la activa; el *chip* de cámara del visor
muestra la proporción junto al tamaño (`16:9 · 1920 × 1080`). Animación:
el tamaño de salida sigue siendo el de la ventana de render (un vídeo
tiene un solo tamaño); el Doctor avisa si un plano usa una cámara con
otra proporción. Proyectos antiguos: cámaras sin `aspect` toman la del
tamaño de render guardado.

**Qué.** Sección de cámara del inspector: fila **Proporción** (lista +
campos `w : h` con *Propia*), con la misma fila en el inspector de la
cámara activa de la pestaña *Cámaras*; `camera/set` deshacible; el
marco del visor (`src/render/preview.ts` / `viewport-overlays.ts`) y el
*chip*; la ventana de render (`core/render.ts` `aspect`/`aspectLock`
pasan a derivarse de la cámara: `aspect` deja de ser estado propio
salvo para la animación); guardar/abrir; cadenas es/en; `UI.md`,
`SPEC.md` §3.5, CHANGELOG.

**Depende de.** U5, la sección de cámara (lista con lápiz).

**Criterio.** Tests (mutación comprobada): cambiar la proporción en la
cámara cambia el alto del render y el marco del visor; teclear ambos
lados en la ventana de render deja `CUSTOM` en la cámara con esa `w:h`;
un preset de tamaño con otra proporción cambia la de la cámara; cada
cámara conserva la suya al cambiar de activa; proyecto antiguo sin
`aspect` → la del tamaño guardado; animación: tamaño propio y aviso del
Doctor cuando un plano discrepa. Comprobación de navegador
`tools/aspect-check.mjs` con capturas `docs/ui/camera-aspect.png` (la
sección con 4:3 y el marco del visor cambiado) y
`docs/ui/render-size-from-camera.png`.


**Hecho.** `src/data/aspects.ts` (los diez presets con clave estable y
`CUSTOM`, con su etiqueta es/en) y `src/core/aspect.ts` (`CameraAspect`,
`normaliseAspect`, `aspectNearPixels`, `aspectText`); `CameraState.aspect`
con `aspectRatio(cam)` en `core/camera.ts`, 16:9 por omisión (1920 × 1080
como antes), `camera/set` la lee y la deshace, y `camera/add` (*Nueva desde
la vista*, duplicar) la copia. **Una sola fuente**: la cámara. El tamaño de
una imagen se deriva de ella en `syncOutputSize`, que corre en cada acción
del *store* (cambiar la proporción, cambiar de cámara activa, borrar la
activa, deshacer, abrir un proyecto, volver de *Animación*): conserva el
ancho y calcula el alto; `render/set` en modo imagen es `setSettings`, que
con el candado cerrado deja que un lado siga a la proporción y, con él
abierto o con los dos lados a la vez (un preset de tamaño), **escribe la
proporción en la cámara en la misma acción** (una entrada de deshacer):
el preset de la lista si el tamaño es exactamente uno (`aspectForSize`),
si no `CUSTOM` con esos píxeles como `w : h`, y un tamaño casi de un preset
se respeta tal cual (nada de 1081 que se vuelve 1080 a escondidas). Los
trabajos de la cola para otra cámara con otra proporción salen con el ancho
de la ventana y el alto de esa cámara (`sizedFor`). Visor: el marco (la
máscara, el fondo de imagen y el degradado, el *rsb* de Completo) y el
`placeCamera` de Rápido usan la proporción de la cámara que se ve (activa, o
la que se mira a través: `viewedCamera`), cada pirámide del visor la suya, y
el *chip* dice `16:9 · 1920 × 1080`. Inspector: la fila **Proporción**
(`insp-aspect.ts`: lista y campos `w : h`, apagados con un preset) vive en
`cameraFields`, de modo que sale en la sección de cámara y en la ficha de
cada cámara con una sola línea añadida; la ventana de render dice en una
línea discreta quién manda y qué ha pasado (*La proporción de Cámara 1 pasa
a 4:3*); la lista de cámaras pone la proporción tras la óptica. Proyectos:
una cámara sin `aspect` toma la del tamaño guardado (preset a ≤ 0,5 %, si
no *Propia* con esos píxeles) y el tamaño guardado **no se toca**. El Doctor
gana la comprobación `aspect` (**Proporción de la animación**, la 15.ª,
añadida tras las 14 de origen, con arreglo). Pruebas: `tests/aspect.test.ts`
(33) más las que ya existían y se ajustaron, cada una comprobada
reintroduciendo el fallo que vigila; y en el navegador
`tools/aspect-check.mjs`, con `docs/ui/camera-aspect.png` y
`docs/ui/render-size-from-camera.png`.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es de criterio y se
deja anotado para quien decide, la regla 11):
- ◆ **El tamaño de la animación es el mismo par `width`/`height` que el de la
  imagen**: «tamaño propio» se ha leído como «no sigue a la cámara mientras la
  ventana está en *Animación*», y al volver a *Imagen* el ancho se conserva y el
  alto sale de la cámara (se pierde el alto que se hubiera tecleado para el
  vídeo). Guardar un tamaño de animación aparte (`animation.width/height`) es
  un campo más si se quiere.
- ◆ **En *Animación* el marco del visor sigue siendo el de la cámara activa**,
  no el del tamaño del vídeo (la decisión dice que sigue a la cámara activa);
  si el vídeo tiene otra proporción, el marco no lo enseña y quien avisa es el
  Doctor.
- ◆ **El arreglo del Doctor** pone a las cámaras de los planos la proporción
  de la salida, no al revés (la salida cambiaría el tamaño de todo el vídeo).
- ◆ **Los términos de una proporción propia son los píxeles tecleados** (1000
  × 700 es *Propia* 1000 : 700, no 10 : 7) y, en el visor y la lista, se
  escriben `1.43:1` cuando no son números pequeños; la razón de una cámara se
  limita a 1 : 512 – 512 : 1 (la de 16 × 8192 y 8192 × 16, lo más extremo que
  admite la ventana), que es un tope mío.
- ◆ **Cambiar la proporción no recoloca la cámara**: el producto puede quedar
  fuera del marco de un 9:16 hasta pulsar *Encuadrar*.
- Restaurar un **estudio** guardado trae la óptica y la vista pero **no** la
  proporción de la cámara en la que cae (la proporción es del proyecto, no del
  estudio); los estudios de la biblioteca y los guardados antes se abren con
  16:9 si no la traían.
- Editar un **trabajo de la cola** (*Guardar cambios*) deja su tamaño tal cual
  y no escribe en ninguna cámara: el borrador es del trabajo.
- `migrateProject` (`parseProject`, el estado sin geometría) vuelve ahora a
  calcular los resultados del Doctor como ya hacía `loadProject`: con el
  catálogo ampliado, los del archivo habrían dejado a los dos distintos.
- Los tests de `tests/primitive-ops.test.ts`, `tests/rsb.test.ts` y
  `tests/render.test.ts` daban un tamaño de render sin la proporción de la
  cámara (un *mock* más permisivo que el programa: allí tamaño y cámara son una
  sola cosa): ahora usan `render/set`, y el proyecto de U1 va sin `aspect` en
  las cámaras, como era de verdad.
- En los extremos (3 : 700 a 1000 de ancho) el alto se queda en el límite de la
  ventana y el par deja de tener la proporción, **sin perder el ancho**: la
  proporción que venga después devuelve el alto (teclear los términos de una
  proporción propia de uno en uno pasa por extremos).

## U14 · Vista en vivo en la cola — **Opus** — hecha

Petición del usuario (punto 3.1 del reporte del 14/15-10, `TODO.md`: «al irme
a queue quiero poder ver un preview en tiempo real de un render
seleccionado»); triaje en `TRIAGE.md` 3.1.

**Qué.** Elegir en la cola el trabajo que **se renderiza** enseña su imagen en
vivo, que se refresca a medida que acumula; uno **terminado** sigue abriendo el
visor de resultados; uno **en espera** dice en una línea que aún no ha empezado
(es/en). La imagen es la del propio trabajo, ajustada a la vista, con las
muestras que dice el motor (regla 10): en el escritorio, las tramas del trabajo
de `/api/render` del lanzador; en la web, la acumulación del *pool*. Un
`onFrame` (o equivalente) en `FrameRequest` con una cadencia acotada; sin frenar
el render (coste medido con y sin la vista, por debajo del 2 %); con la vista
cerrada o con otro trabajo elegido, no se hacen ni se copian imágenes.

**Criterio.** Tests que fallan sin la función: la cola con un render falso que
entrega imágenes (el trabajo en curso elegido las enseña, el terminado abre el
visor, el que espera dice que no ha empezado, quitar la selección para las
imágenes), la cadencia con un reloj falso y el lado del lanzador. `npm run qa`,
`npm run engine:test`, `cargo fmt` y `clippy`; capturas de la cola con un
trabajo en curso en la vista, en los dos temas.

**Hecho.**

- **Dónde: el visor de resultados en modo «en curso»**, no un panel del cajón.
  El cajón mide 240 px: la imagen se quedaría en unos 360 × 200, una miniatura;
  la capa del visor de resultados tiene el tamaño del visor (950 × 530 en la
  ventana de 1600 × 1000). El mismo clic abre el mismo sitio para un trabajo
  terminado y para uno en curso, y al acabar la vista en curso **pasa a ser el
  resultado** sin que nadie haga nada. El cajón no cambia de forma: la fila
  elegida se marca (fondo de pasar el ratón y una barra de tinta), y su texto
  emergente dice *Ver cómo se renderiza*. `ui/panels/live-viewer.ts`, en la
  misma capa (`rv-host`) que `results-viewer.ts`: la ficha **En vivo**, el
  nombre, los datos del motor (*1280 × 720 · 15 de 96 muestras · 0:14 · Cámara
  1*, con *Terminar por tiempo* «0:14 de 1:00»), el estado de la fila con su
  progreso y su barra, una nota y *Cerrar* (`Esc`); la imagen a la proporción
  del render, todo lo grande que quepa, sobre el damero neutro. Uno en espera
  dice *Este trabajo aún no ha empezado: su imagen aparecerá aquí en cuanto se
  renderice* y enseña la imagen en cuanto la cola llega a él (también tras una
  pausa, que lo devuelve a la espera); uno detenido o fallido lo dice; quitarlo
  de la cola se lleva la vista.
- **Estado de la interfaz**, como `resultView`: `ui.liveView` (`{jobId, box}`,
  la caja que el visor midió en píxeles de pantalla) y `ui.liveFrame` (la última
  imagen); nunca a la vez que `resultView`. Comandos `selectJob` (el clic y `⏎`
  de la fila), `watchJob` y `closeLive` (`ui/commands.ts`); `openResult` y el
  recorrido guiado la cierran.
- **El puerto**: `FrameRequest.frameBox(image?)` y `onFrame(frame)`
  (`ui/ports.ts`; lo mismo en `RenderOptions`, `render/engine.ts`). Tipos y
  cadencia en `core/live-frame.ts`: `LiveFrame`, `FrameCadence` (reloj
  inyectado), `LIVE_FRAME_MS` = 500, `LIVE_MAX_BOX` = 960 × 600, `fitFactor`
  (el menor factor entero que cabe, la misma regla que el lanzador) y
  `liveBox`. La cola (`liveTap`, `ui/render-queue.ts`) dice que sí solo
  mientras la vista enseña **ese** trabajo y la pestaña se ve, como mucho cada
  500 ms (la primera al momento, también al abrirla otra vez o al cambiar de
  tamaño) y nunca dos veces la misma imagen (la pasada del lanzador); una imagen
  que llega cuando la vista ya se fue se tira.
- **La imagen** (`render/live-frame.ts`): las sumas reducidas por un factor
  entero con una caja (cada píxel, la media de su caja; en cajas de más de
  2 × 2, de una rejilla de 2 × 2, así que cuesta unas cuatro lecturas por píxel
  sea cual sea el render), cada píxel dividido por las muestras de su baldosa (a
  media pasada el *pool* tiene baldosas con cuentas distintas) y convertida con
  la curva rápida del visor (`DisplayCurve`) con la exposición y la curva del
  render. **Web**: `pathtracer.ts` la hace tras la baldosa que acaba de llegar
  cuando la cola la pide, y la guarda entre dos (`LivePicture`): solo rehace las
  cajas sobre las baldosas que han cambiado desde la anterior. **Escritorio**:
  `native.ts`, tras cada pasada que el lanzador publica, pide
  `GET /api/render/<id>?fit=<an>x<al>`; el lanzador (`rt-app`: `Frame::fitted`,
  `fit_factor`, `parse_fit`, `FLAG_SCALED` = 512) promedia las sumas en el hilo
  de la petición y solo viaja la imagen (640 × 360 × 16 bytes = 3,7 MB en vez de
  14,7 MB de un 1280 × 720); con `data=0` no cambia nada y una caja mal escrita
  es 400 `bad-query`. Un lanzador sin `fit=` mandaría las sumas enteras y la
  página las reduce. Sin vista en vivo solo viajan cabeceras, como antes.
- **Tests** (todos fallan sin la función: 19 mutaciones comprobadas una a una,
  al final de esta lista): `tests/live-view.test.ts` (17: la cadencia y la caja con reloj falso,
  la imagen —media de cajas, rejilla, baldosas sin muestras, cobertura, la
  imagen guardada igual a una nueva y rehaciendo solo lo cambiado—, la toma de
  la cola, la cola con un render falso que entrega imágenes, el motor del
  escritorio contra el lanzador simulado, un lanzador sin `fit=` y uno que
  falla), `tests/pathtracer.test.ts` (1: el *pool* hace imágenes solo cuando se
  le piden, con las muestras de cada baldosa, y el render es los mismos bits), y
  en `rt-app` `render.rs` (2: `fit_factor` y `parse_fit`, `Frame::fitted` con
  cajas cortadas por el borde) y `tests/server.rs` (1: un final pedido con
  `fit=16x16` llega en 16 × 12 con la bandera y las medias de sus cajas).
  `tests/launcher-mock.ts` responde `fit=` como el lanzador. Las mutaciones, cada
  una con algún test en rojo: el clic en una fila que corre o espera solo abre
  resultados; la petición sin la toma; sin cadencia; la toma para cualquier
  trabajo de la vista; el escritorio sin pedir imagen; el *pool* sin hacerla;
  *Cerrar* que no cierra; el trabajo mirado que no pasa a su resultado; el que
  espera sin su línea; la imagen guardada rehecha entera; un solo peso para
  todas las baldosas; la pestaña oculta que sigue pidiendo; la misma pasada
  pedida dos veces; quitar el trabajo sin cerrar su vista; el lanzador simulado
  sin `fit=`; la rejilla que lee las cajas enteras; y en `rt-app`, `fit=`
  ignorado, la media de las cajas del borde sin contar solo sus píxeles y
  `fit_factor` redondeando hacia abajo.
- **Comprobación de navegador** `tools/queue-live-check.mjs` (web y
  `--desktop`, con el lanzador de *release* en `--serve-only`), las dos en
  verde: (a) la fila en curso abre la vista y llegan imágenes con más muestras;
  (b) la fila en espera dice que no ha empezado, sin imagen; (c) `Esc` la
  cierra y, en el escritorio, no hay más peticiones `fit=` (5 con la vista
  abierta, 0 después); (d) la fila terminada abre el visor de resultados; (e)
  el trabajo mirado hasta el final pasa a ser su resultado. Capturas
  `docs/ui/queue-live.png` y `docs/ui/queue-live-dark.png`.
- **Coste medido** (`node tools/queue-live-check.mjs [--desktop] --measure`):
  el mismo trabajo (la botella de ejemplo, visor en *Rápido*, las mismas
  muestras) en pares, uno con la vista cerrada y otro con la vista abierta
  sobre él (cuál va primero se alterna), tras un render de calentamiento; el
  tiempo es el del motor (`data-seconds` del historial) y la CPU la de este
  navegador y este lanzador. **Web** (*pool* wasm de 3 *workers*, 1280 × 720,
  16 muestras, 10 pares): mediana cerrada 11,33 s, abierta 11,53 s (+1,8 %);
  mediana de los cocientes de cada par 0,983 (−1,7 %), entre 0,946 y 1,092;
  CPU, 0,990; 13 o 14 imágenes por render (unas 1,2 por segundo, de
  640 × 360). **Escritorio** (lanzador nativo en 4 hilos, 1280 × 720, 64
  muestras, 8 pares): mediana cerrada 14,97 s, abierta 15,01 s (+0,3 %);
  mediana de los cocientes 1,007 (+0,7 %), entre 0,948 y 1,061; CPU, 1,000; 7 u
  8 imágenes por render (una por pasada) y otras tantas peticiones `fit=`. En
  las dos, el coste queda **dentro del ruido** de la máquina (±5 % de un par a
  otro: es de 4 núcleos y la comparten otros agentes) y por debajo del 2 % en
  las dos lecturas. Lo que cuesta una imagen, fuera del navegador
  (`liveImage`, Node, la máquina cargada): 18 ms un 1280 × 720 entero a
  640 × 360, 41 ms un 1920 × 1080 a 960 × 540; la imagen guardada del *pool*
  solo rehace las cajas de las baldosas que han llegado desde la anterior.
  La primera versión (cada imagen entera, con todas las lecturas de cada caja
  y un tope de 1280 × 800) medía +11 % de mediana en cuatro pares de 1280 × 720
  a 32 muestras (entre −2 y +31 %, con la máquina muy cargada): de ahí el tope
  de 960 × 600, la rejilla de 2 × 2 y la imagen guardada.

**Qué no encajó con el plan** (regla 12):

- Se eligió **el visor de resultados en modo «en curso»** y no un panel en la
  cola (el encargo dejaba las dos): las razones, arriba.
- **En el escritorio la imagen cambia una vez por pasada**, no cada medio
  segundo: el lanzador publica sus sumas al final de cada pasada (1, 2, 4, 8 y
  luego 16 muestras), así que en un render grande la imagen nueva llega cada
  varios segundos; en la web llega baldosa a baldosa. Una imagen a media pasada
  pediría al lanzador un formato de trama con cuentas por baldosa: queda
  anotado.
- **Las muestras que dice la web** son las que tienen ya todos los píxeles
  (`minSamples`): a media pasada hay baldosas con más; en la primera pasada son
  0 mientras faltan baldosas (que se ven transparentes).
- La vista en curso **no tiene zoom ni 100 %**: la imagen está reducida (como
  mucho 960 × 600) y el zoom no enseñaría más; llegan con el resultado.
- La **miniatura** de la fila en curso sigue siendo el icono: no se pidió.
- Los elementos del historial llevan `data-samples` y `data-seconds` (los del
  motor) para que la medida los lea sin redondear.
- `tests/launcher-mock.ts` mandaba sumas antes de la primera pasada; el
  lanzador no (`Frame::is_empty`): ahora tampoco el simulado (era más
  permisivo que la realidad; ningún test dependía de ello).
- En `engine/crates/rt-app/README.md` la tabla de banderas de la trama no
  tenía las de E5b-1 (64, 128, 256): están, con la 512.

## U15 · Flechas y deslizadores en los valores — **Opus** — hecha

Petición del usuario (17-10): «quiero aparte flechas de up y down en todos
los valores, o sliders cuando convenga más. En enfoque creo que se serviría
de ambas. Un slider y al lado el valor con up and down».

**Qué.** Flechas ▲ ▼ visibles en **todo** campo numérico, puestas en el
propio `numberField` para que las lleven todos sus usos: un clic sube o baja
un paso (`Shift` más fino, `Ctrl` más grueso, como el arrastre), mantenidas
repiten tras una pausa, una pulsación entera es un gesto y una entrada de
deshacer, el valor se queda en sus límites y la flecha del límite se apaga,
respeta *deshabilitado*, no arrastra el campo, llama a `onHold`/`onRelease`
y no son paradas de tabulación (el *spinbutton* sigue con el teclado). Que
quepan en las columnas estrechas del inspector, en los tripletes X, Y, Z, en
la línea de tiempo y en las filas de Ajustes **sin recortar nada ni hacer
crecer las filas**, medido en un navegador. Y una **regla escrita** de
cuándo un valor es mejor como deslizador con su campo y sus flechas al lado
(`UI.md` §4.4), aplicada en el inspector, la línea de tiempo, la ventana de
render y Ajustes. La *Distancia de enfoque* de la cámara no se toca: la
rehace la fase F1 como deslizador con su campo, y recibe las flechas de este
cambio.

**Criterio.** Tests del campo (clic con `Shift` y `Ctrl`, mantener, una
entrada de deshacer por pulsación en el *store*, límites, deshabilitado,
escribir y arrastrar, `onHold`/`onRelease`) y un test de navegador de la
disposición en los estados principales, en es y en, a 1600 × 1000 y
1280 × 800, que se comprueba que falla rompiendo el CSS; `npm run qa` en
verde; capturas.

**Hecho.**

- **Las flechas** (`ui/components/controls.ts`, `numberField`): dos
  `button` apilados al final del campo (`.num-steps`, `.num-up`,
  `.num-down`), con los `chevronUp`/`chevronDown` del juego de iconos a
  12 px (1,5 px de trazo), en `ink-2`, `ink-0` con fondo `soft` al pasar el
  ratón y `line` al pulsar; dentro del marco y de su altura, 26 px, sin
  crecer. El relleno derecho del campo (7 px) pasa a ser su columna (14 px
  y 4 px de margen). La pulsación va en `pointerdown` (y `click` sin puntero,
  `detail` 0, para un lector de pantalla o un script: un paso): para la
  propagación (no hay arrastre), evita que el botón tome el foco y se lo da
  al *spinbutton*, captura el puntero en el par (la pulsación acaba donde se
  suelte, también si la flecha se apaga bajo el dedo al llegar al límite) y
  repite: un paso al pulsar, otro a los `STEP_REPEAT_DELAY_MS` = 400 ms y uno
  cada `STEP_REPEAT_MS` = 50 ms; `Shift` y `Ctrl` pulsados mientras tanto
  cambian los pasos siguientes. Todo con el mismo `newGesture('step')`, así
  que el *store* lo junta en una entrada; `onHold` al pulsar y `onRelease` al
  soltar (la vista previa de la IA y la de los plugins esperan). Un campo que
  desaparece bajo la pulsación (su panel se redibuja) o se deshabilita la
  termina. Doble clic sobre una flecha son dos pasos, no la edición; si se
  estaba escribiendo, la pulsación toma lo escrito y sube desde ahí. Se
  llaman *Increase*/*Aumentar* y *Decrease*/*Disminuir*
  (`common.increase`, `common.decrease`), `tabindex` −1.
- **Deshabilitado**: el campo mira también la clase `is-disabled` (la que
  ponen las filas *próximamente* de Ajustes) para el arrastre, las teclas,
  la edición y las flechas, y gana `setDisabled` (`NumberControl`; también
  en `lengthField` y `slider`), que usan los términos de la proporción
  (`insp-aspect.ts`, antes tocaban las props a mano) y los mandos de la lente
  fina con una lente trazada (`insp-lens.ts`: antes se apagaban sus `input`
  pero el campo se seguía arrastrando).
- **Variante compacta** (◆ Fable): un campo con etiqueta en línea (X, Y, Z;
  U, V; H, V) y el campo de un deslizador (`slider()` la pide) llevan un par
  de 10 px con iconos de 10 px, 5 px de relleno izquierdo y márgenes de 3 y
  2 px junto a la etiqueta y la unidad: el valor conserva el sitio de antes
  (en un triplete de 102 px, 47 px de valor, como antes; en el campo de un
  deslizador de 78 px, 59 px frente a 62). Es la propuesta por defecto; la
  alternativa (las flechas solo al pasar el ratón o con el foco) mueve el
  valor o tapa la unidad al aparecer.
- **El campo de tiempo** de la ventana de render (`timeField`) deja de ser un
  `input` de texto y es un `numberField` de segundos que se ve y se escribe
  como `hh:mm:ss` (nuevo `parse` del campo: con él, la edición empieza por el
  texto que se ve): arrastrable, con sus flechas (un minuto; `Shift` 6 s,
  `Ctrl` 10 min), una entrada de deshacer por gesto; lo que no es una hora o
  no pasa de 0 se rechaza, como antes. Sin máximo en el campo (el *store* lo
  limita a una semana): un campo acotado recorre todo su rango en 240 px.
  `tools/doctor-engine-check.mjs` escribe en él con doble clic.
- **La regla y lo convertido** (`UI.md` §4.4; ◆ Fable confirma la lista):
  un valor con rango natural acotado (factor 0–1, porcentaje, ángulo en un
  rango fijo, opacidad) es deslizador con su campo y sus flechas; una
  magnitud física o sin tope (mm, tamaños, potencias, kelvin, cuentas,
  tiempos, semillas) sigue en campo con flechas. Convertidos: **inspector**
  —*Rozamiento* (0–2) y *Rebote* (0–1) de físicas; *Giro* del bokeh
  (±180°), *Inclinación* (±12°) y *Eje de la inclinación* (±180°) de la
  óptica avanzada; el *Ángulo* de un filtro (±180°); el *Ángulo de
  suavizado* (0–180°); el *Ángulo* de un patrón circular (±360°); el *Giro*
  de una textura y de una etiqueta (±360°); en un foco propio *Acimut*
  (±180°), *Elevación* (±89°), *Giro* (±180°), *Dispersión* (1–180°),
  *Ángulo de cono* (1–179°), *Transición* (0–100 %) y *Disco del sol*
  (0–5°)—; **ventana de render** —*Calidad* del JPEG (1–100), *Ruido* de
  *Terminar por ruido* (0,5–5 %) e *Intensidad* de la reducción de ruido
  (0–100 %)—; **Ajustes** —*Velocidad de órbita*, *Velocidad de zoom*
  (25–300 %), *Tamaño del gizmo* (50–200 %) e *Intervención por defecto*
  (0–100), en `SLIDER_SETTINGS` de `settings-rows.ts`—. Los parámetros de
  material ya eran deslizadores hasta 2,5 (`insp-parts.ts`) y los del editor
  de nodos con un rango de 10 o menos; las sensaciones de *Ambiente*, las
  de la IA y las de los plugins ya lo eran. CSS: `.rw .slider .num`,
  `.rw-stack > .slider` (hasta 300 px), `.rw-inline > .slider` (220 px, la
  calidad junto al formato) y `.sw-slider` (hasta 240 px).
- **Tests**: `tests/number-field-browser.test.ts` (10, con la página
  `tests/browser/number-field.html`: el campo, el deslizador y el de tiempo
  reales escribiendo en un *store* real, con el reloj falso de Playwright para
  la repetición): el par en cada campo, a la derecha, dentro, sin pisar el
  valor y sin ser parada de tabulación; clic, `Shift` y `Ctrl`, una entrada
  por clic; mantener (nada antes de 400 ms, luego uno cada 50 ms, `Shift`
  durante la repetición, nada tras soltar, **una** entrada que un deshacer
  quita entera, soltar fuera del botón); límites y flecha apagada (también
  con una pulsación mantenida hasta el máximo y con el teclado); deshabilitado
  y `setDisabled`, también a mitad de una pulsación; `onHold`/`onRelease`;
  sin arrastre, sin edición con doble clic y con el foco en el campo; escribir,
  arrastrar y las teclas; el deslizador y el de tiempo; un clic sin puntero.
  `tests/number-layout-browser.test.ts` (2, uno por idioma): los estados de
  abajo, cada uno a los dos tamaños.
- **Medidas**: en un Chromium real (sin GPU), antes de las flechas ningún campo de los
  estados del ejemplo recortaba nada; con ellas, el test de disposición mide
  por idioma 1 592 campos y 620 deslizadores en 34 vistas (siete estados a
  los dos tamaños y las diez secciones de Ajustes a los dos tamaños), **0
  problemas** en es y en (524 s los dos). El margen más justo entre el valor
  y su sitio es de 13 px (*Automático* en *Hilos*, campo de 110 px), 14 px
  (*-183* en un triplete de coordenadas de 102 px) y 17 px (*fps*, 84 px).
  **Que el test caza un recorte**: con `.num { height: 16px }` a propósito
  (menos que su contenido), el de inglés falla con 3 184 problemas (*its
  content is taller than it (17 > 14)*, *the step buttons are not a stacked
  pair*…); deshecho, vuelve a verde. Y ocho mutaciones del campo, cada una
  con algún test de `number-field-browser` en rojo: un gesto por repetición
  (una entrada de deshacer por paso), sin repetición, las flechas sin
  apagarse en el límite, sin `onRelease`, el arrastre desde las flechas, el
  foco en la flecha, las flechas en un campo deshabilitado y sin `Shift`.
- **Comprobación de navegador** `tools/number-fields-check.mjs`: (a) las
  flechas en todos los campos de la pantalla inicial; (b) un clic en ▲ de
  *Focal* es un paso y una entrada, y mantener ▼ un segundo son muchos pasos
  y otra entrada que un deshacer quita entera; (c) los ángulos de un foco
  propio son deslizadores y *Distancia* y *Potencia* campos; (d) las
  velocidades de *Preferencias* son deslizadores y *Tamaño de la interfaz*
  un campo. Capturas `docs/ui/u15-light-fields.png`,
  `u15-part-triplets.png` y `u15-settings-sliders.png`.

**Qué no encajó con el plan** (regla 12):

- Los tests «en el entorno DOM de los tests de componentes»: vitest corre en
  Node sin DOM y ningún test usaba `numberField`; los componentes con DOM se
  prueban en Chromium a través de Vite (`tests/browser/*.html`), así que los
  del campo son una página de esas, con reloj falso.
- `SPEC.md` no describe el campo numérico: no cambia.
- No se convirtieron, por la regla de no apretar filas: el acimut, la
  elevación, la parte y el tamaño de las luces de un estudio (rejilla de dos
  con etiqueta en línea, `insp-scene.ts`) y las asas de la curva; tampoco
  *Tamaño de la interfaz* ni *Tamaño del texto* (porcentajes, pero
  reescalan la ventana bajo el pulgar mientras se arrastra) ni la dirección
  del viento de *Ambiente* (da la vuelta, sin rango). La hoja de importación
  (el ángulo de teselado) no estaba en las zonas del encargo.
- Un valor largo en un campo estrecho ya se cortaba antes (`overflow:
  hidden` en el valor; en un triplete, más de unos 6 caracteres); la
  variante compacta deja el mismo sitio, no más. El test de disposición mide
  los valores de los estados que abre.
- Los ◆ (la variante compacta, la lista de lo convertido y el ritmo de la
  repetición) están en *Decisiones para Fable*.

## N6 · Despiece configurable y línea de tiempo clara — **Opus**, decisión **Fable** — hecha

Petición del usuario (14-10): en animación faltaban las **explosiones
(despieces)** de un modelo, configurables en velocidad y suavidad, con
piezas **excepción** que no se mueven, y de varios tipos (vertical,
horizontal, radial, esférica…; «investiga tipos»); y **mejorar la
interfaz de animación**: más cómoda, intuitiva, parecida a sistemas
existentes, y que quede claro **qué** se anima y **cómo**.

**Tipos de despiece (investigación).** Las herramientas CAD con vista
explosionada coinciden en tres geometrías básicas y dos modos de orden
(documentación pública de Onshape —*Linear / Radial / Spherical*—,
Fusion 360 —*auto explode: one level / all levels*—, SolidWorks
Composer e Inventor —niveles y direcciones—; observación de caja negra,
ningún código):
1. **Lineal** (`LINEAR`): a lo largo de un eje (vertical = Z;
   horizontal = X o Y; o dirección propia). Dos sabores: *separar* (cada
   pieza se aleja del plano central por su lado) y *apilar* (todas en el
   mismo sentido, repartidas en su orden a lo largo del eje: el despiece
   clásico de un envase con tapón, rosca y cuerpo).
2. **Radial** (`RADIAL`, cilíndrico): alejándose de un **eje** (las piezas
   se mueven perpendiculares a él). Lo que hoy se llama RADIAL pasa a
   ser esférico; la clave `RADIAL` se conserva con su significado nuevo
   solo si ningún proyecto guardado la usa (comprobar); si no, clave
   nueva `CYLINDRICAL` y `RADIAL` queda como sinónimo de la esférica.
3. **Esférica** (`SPHERICAL`): alejándose de un **punto** (el centro).
4. **Por jerarquía** (`LEVELS`): primero los grupos como bloques y luego
   las piezas dentro de cada grupo (*un nivel* / *todos los niveles*),
   combinable con cualquiera de las tres geometrías.
Parámetros: distancia (× tamaño del modelo o mm; *proporcional al
tamaño de la pieza* sí/no), **centro** (centro del modelo, pieza elegida,
pivote, punto propio), eje o dirección, **orden** (a la vez / escalonado
por distancia al centro / por profundidad de jerarquía, con solape %),
**velocidad** (duración) y **suavidad** (curva: lineal → suave → muy
suave, un solo mando que elige y pesa la curva de `EASING_KINDS`),
**excepciones** (piezas fijas: lista que se llena desde la selección o
con *Fijar en el despiece* del menú contextual), conservar la
orientación, invertir (montaje), y el objetivo puede ser el modelo o un
grupo. Las claves `AXIS_X/Y/Z` existentes siguen valiendo (= lineal
separar en ese eje).

**La interfaz de animación** (decisión): el cajón pasa a ser una línea
de tiempo de tres zonas, como el espacio de animación de KeyShot y las
tiras de Blender/After Effects, sin copiar nada:
- **Izquierda, el árbol de lo animado** (*qué*): una fila por objetivo
  (pista de cámara, modelo, grupos, piezas, focos, entorno, set,
  físicas) con sus animaciones anidadas (icono + frase llana: «orbita
  90° · 4 s · suave»); seleccionar una fila selecciona la animación y
  **resalta su objetivo en el visor**; seleccionar una pieza en la
  escena resalta sus filas; botón **+ Animar…** contextual («Animar
  Tapón…») que abre el asistente con el objetivo puesto; menú contextual:
  duplicar, borrar, invertir, partir en el cabezal, fijar en el despiece.
- **Centro, la línea de tiempo** (*cuándo*): regla en segundos y
  fotogramas, cabezal arrastrable, barras con su frase, arrastrar para
  mover y estirar por los extremos, **imán** a bordes de otras barras,
  al cabezal y a los segundos, selección múltiple, pistas agrupadas por
  objetivo y plegables, la pista de cámara con sus tramos.
- **Derecha, las propiedades** de la animación elegida (*cómo*):
  cabecera «Tapón · Despiece esférico · 1,5 × tamaño · 0–3 s», los mandos
  del tipo, la curva con vista previa, inicio/duración/fin, repetir,
  invertir.
- **Visor**: con una animación elegida se dibuja su pista (arco de la
  órbita, flecha del desplazamiento, vectores del despiece, giro) y el
  objetivo resaltado; el cabezal mueve la previa.
- Teclado: espacio reproduce/pausa, Inicio/Fin, ←/→ un fotograma,
  Mayús+←/→ diez, Supr borra, Ctrl+D duplica. Los presets siguen en su
  lista. Cualquier tipo de clip se dibuja igual (también el `PHYSICS`
  que S2 añade: «simulación física · 0–4 s»): el árbol y las barras no
  conocen los tipos, leen la frase y el objetivo.

**Depende de.** N1, U3. S2 añade `PHYSICS` en paralelo: mantener
`MotionClip` y `evaluate` como API y dibujar genérico.

**Criterio.** Tests (mutación comprobada): cada geometría mueve las
piezas por donde dice (lineal separar/apilar, radial perpendicular al
eje, esférica desde el punto, niveles por etapas); las excepciones no
se mueven; el orden escalonado respeta el solape; suavidad lineal vs muy
suave cambian la curva; invertir monta; proyectos antiguos con
`EXPLODE` y `AXIS_*`/`RADIAL` se leen igual que antes (instantánea);
árbol ↔ selección ↔ visor sincronizados; arrastrar y estirar barras con
imán (tests de la aritmética del imán). Comprobación de navegador
`tools/animation-check.mjs` con capturas `docs/ui/animation-timeline.png`
(árbol + barras + propiedades con un despiece elegido y su pista en el
visor) y `docs/ui/explode-types.png` (tira de 4 fotogramas por tipo con
el envase de ejemplo). Hoja `out/explode-sheet.html` para el veredicto
visual. `SPEC.md` §3.7, `UI.md` §2.5, CHANGELOG; cadenas es/en; cromo
acromático; todo por el *store* y deshacible.

**Hecho.** El despiece vive en `src/core/explode.ts` y se evalúa dentro
de `evaluate` (puro y determinista; `MotionClip` y `evaluate` siguen
siendo la API): `explodeMovers` calcula lo que se mueve como una unidad
(una pieza, o un bloque en los niveles), su desplazamiento final y su
ventana de tiempo dentro de la barra, y `evaluate` aplica en cada ventana
la curva del clip. Geometrías `LINEAR` (*separar* y *apilar* en Z, X, Y o
una dirección propia), `CYLINDRICAL` (la radial) y `SPHERICAL`; jerarquía
`NONE` / `ONE` / `ALL` (por etapas encadenadas con el solape, y dentro de
un grupo las piezas se alejan del centro del grupo en proporción a su
tamaño); distancia en × tamaño o mm, reparto igual o por distancia,
proporcional al tamaño, centro (conjunto, pieza, pivote, punto), orden (a
la vez, por distancia con la más lejana primero, por profundidad) con
solape, excepciones (`pinned`, que guarda piezas; fijar un grupo fija las
suyas), conservar la orientación (apagado, cada pieza se inclina hasta
20° sobre su propio centro), objetivo modelo o grupo. Genéricos de
`MotionClip`, opcionales: `reverse` (antes de empezar guarda su estado
final; `poseActive` hace que el visor y el motor enseñen ese estado desde
el fotograma 0), `repeat` (la barra dura `duration × repeat`, `clipEnd`),
`smoothness` (un mando sobre *lineal → suave → muy suave*, mezclándolas, que
escribe en `easing` la más cercana) y `explode`. Acciones nuevas del
*store*, todas deshacibles: `removeClips`, `duplicateClips`,
`setClipTimes` (valores absolutos: un arrastre con su gesto es una entrada),
`splitClip` (las dos mitades siguen una de otra en los tipos que suman o
multiplican), `reverseClips`, `setExplode`, `pinExplode`. Las claves
`LINEAR` y `SPHERICAL` se **añaden** a `EXPLODE_MODES`.

**Decisión sobre `RADIAL`.** Ningún proyecto ni preset guardado usa
`RADIAL`: `MotionClip` no tenía ningún campo de modo (el catálogo
`EXPLODE_MODES` existía, pero nada lo escribía, y el evaluador hacía
siempre «hacia fuera desde el centro»). Aun así `RADIAL` es una clave de
catálogo con un sentido escrito («cada pieza sale hacia fuera desde el
centro» = esférica), y la regla 7 no deja cambiarle el sentido; además el
catálogo ya tenía `CYLINDRICAL` con el sentido exacto de la radial nueva
(«salen en abanico sin subir ni bajar»). Así que **`RADIAL` queda como
sinónimo de la esférica y la radial es `CYLINDRICAL`** (en la interfaz,
*Radial*). `AXIS_X/Y/Z` = lineal *separar* en ese eje; `CUSTOM` (una
dirección por pieza) no se construye y se lee como la esférica, lo que
hacía antes. Un despiece sin parámetros —todos los de antes— es el de
entonces: esférico, **cada pieza la misma distancia** (`EVEN`), desde el
centro, a la vez; `tests/fixtures/explode-legacy.json` se tomó con el
código anterior (seis casos: los dos presets, curvas distintas, `RADIAL`,
el modelo y el cierre movidos y girados, y con un plato giratorio a la
vez) y se lee igual a 1e-9 mm.

**La línea de tiempo** sustituye el cajón de U1 (`src/ui/panels/animation.ts`
con su nombre; `anim-tree.ts`, `anim-timeline.ts`, `anim-props.ts`, y las
órdenes en `src/ui/anim-commands.ts`): tres zonas en una rejilla, el árbol
fijo a la izquierda y la regla arriba mientras las pistas se desplazan;
la pista de cámara con sus tramos (borde arrastrable, cámara del plano y
quitar en su menú, **+** para añadir); barras con su frase, arrastre de
todas las elegidas, estirado por los dos extremos, imán a bordes, cabezal,
cortes de plano y segundos (a menos de 6 px; si no, a fotogramas; `Mayús`
libre) con una línea que dice dónde pega; selección múltiple con
`Ctrl/⌘` y `Mayús`; objetivos plegables; propiedades con cabecera de una
línea, los mandos del tipo y del despiece, excepciones, tiempo (inicio,
duración, fin, repetir, invertir), curva o suavidad con su vista previa;
el asistente de siempre, ahora con el objetivo puesto; presets en su
lista y en la cabecera; bucle y zoom. La aritmética (filas, regla, tramos,
imán) está en `src/core/timeline.ts`; el árbol y las barras solo leen la
frase y el objetivo (un `PHYSICS` se dibuja con un punto por icono y su
frase o el nombre de su tipo). **Visor**: `src/core/motion-hint.ts` da el
contorno del objetivo (el de la pieza bajo el puntero) y la pista en
espacio del modelo —anillo con el ángulo de una órbita y un punto donde
está la cámara, arco de una elevación, flecha de un desplazamiento, un
vector y un punto por pieza de un despiece, eje y giro de un *giro
propio*—, y la previa (`setMotionHint`) la dibuja en la tinta del tema
encima de todo, también en *Completo* y mientras reproduce. El menú
contextual de una pieza gana *Animar Tapón…* y *Fijar en el despiece* /
*Soltar del despiece*. Cadenas es/en; cromo acromático.

Pruebas: `tests/explode.test.ts` (27: la instantánea, cada geometría por
donde dice, las unidades y lo proporcional, los niveles por etapas, el
grupo como objetivo, las excepciones, el orden con solape, la suavidad,
invertir, repetir, la orientación, partir) y
`tests/animation-timeline.test.ts` (18: el imán, la regla, las filas, la
cabecera, árbol ↔ selección ↔ visor en los *stores*, las órdenes y las
teclas, la pista en el visor), cada una comprobada reintroduciendo el
fallo que vigila; en el navegador, `tools/animation-check.mjs` (las tres
zonas, el asistente, el contorno y la pista, las filas marcadas desde la
escena, arrastrar y estirar con imán y deshacer, las teclas, los menús,
cada tipo moviendo las piezas) con `docs/ui/animation-timeline.png` y
`docs/ui/explode-types.png`, y la hoja `out/explode-sheet.html` para el
veredicto visual (◆ Fable: qué valores por defecto y qué aspecto).

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
**Fable**, que decide si se cambia):
- N1 no estaba construido (su encabezado no dice *hecha*): el cajón que
  se sustituye es el de U1 (planos, tarjetas y bloques). N6 trae de N1
  lo que su interfaz necesitaba (invertir, repetir, cabecera, curva con
  vista previa, pista de cámara con tramos); siguen pendientes de N1 la
  curva *personalizada* con asas, `FADE`, `PAN`, `MATERIAL_COLOR`, los
  cambios de cámara con fundido y las animaciones bajo su objetivo en el
  árbol de la escena.
- ◆ Valores por defecto de un despiece nuevo: esférico, piezas, **reparto
  por distancia**, centro del conjunto, a la vez, suavidad 50 %. *Por
  distancia* (la más lejana recorre la distancia, las demás en
  proporción) separa piezas que están del mismo lado, como el cuello y el
  tapón; *igual* (lo de antes) las mueve juntas. La hoja enseña las dos.
- ◆ En el envase de ejemplo la radial sobre Z solo mueve la etiqueta: las
  demás piezas están en el eje (es lo que pide la geometría); la hoja
  enseña también la radial sobre X.
- ◆ *Conservar la orientación* apagado inclina cada pieza hasta 20° al
  alejarse; el brief no decía cómo. Es la constante `EXPLODE_TILT_DEG`.
- Por niveles, el brief separaba *todos los niveles* y el orden *por
  profundidad*; aquí *todos los niveles* ya va por etapas (los bloques y
  luego su interior, encadenados con el solape) y el orden actúa dentro
  de cada etapa; *por profundidad* sirve sobre todo con *piezas*.
- Dos arreglos de comportamiento que cambian proyectos con set (L6) o con
  un despiece sobre un nodo, nunca el ejemplo de la instantánea: antes el
  despiece movía también el fondo y el suelo del set y tomaba su centro
  de toda la escena; ahora las piezas de un set no se despiezan nunca. Y
  un despiece con objetivo *una pieza o un grupo* movía todo el modelo
  (el objetivo se ignoraba); ahora mueve lo que hay bajo el grupo.
- Partir en el cabezal: solo en tipos que suman (giros, distancias,
  despiece a la vez) o multiplican (escala, acercamiento), reproducidos
  una vez y hacia delante; cada mitad conserva la curva, así que la
  posición sigue pero la velocidad no es la de la barra entera.
- Las pistas del visor se dibujan donde está el objetivo en reposo: si el
  modelo además gira, los vectores del despiece no giran con él.
- Sin selección por caja en las pistas ni doble clic para renombrar (las
  barras no tienen nombre propio todavía: su frase lo es).
- El cajón crece a 300 px de alto para las tres zonas.
- *+ Animar…* con el modelo elegido en una escena con set: el fondo y el
  suelo del set son raíces de la escena, así que el modelo no es «todo el
  modelo» (`SUBJECT`, que actúa sobre todas las raíces) sino un nodo, y el
  asistente lo pone como *Una pieza o grupo* (antes *Una pieza*: la etiqueta
  cambia de texto, no de clave). Fuera de esta fase y sin tocar: un giro
  sobre `SUBJECT` (el plato giratorio de los presets) gira también el fondo y
  el suelo de un set, porque gira todas las raíces; queda anotado para L6.
- En las tiras, la base que baja por debajo del suelo se ve oscurecida por
  el suelo de sombras del estudio (está detrás de él desde la cámara).

**Veredicto Fable (14-10).** Aceptado con las elecciones marcadas ◆:
separación por distancia por omisión, el radial sobre Z mueve solo lo que
está fuera del eje (la hoja enseña el radial sobre X), la inclinación de
20° con la orientación libre, el orden de la etiqueta en la pila Z, y la
decisión de claves `RADIAL` (esférica, como estaba) / `CYLINDRICAL` (la
radial nueva), que aplica bien la regla 7.

## P6 · Plugins, y el plugin de película (aintfilm) — **Opus**, decisión **Fable** — hecha

Petición del usuario (14-10): un apartado **Plugins** en *Ajustes* con la
herramienta de añadir plugins a la vista, y como primer plugin
descargable el **motor de simulación de película de aintfilm** (la app de
edición de fotos y simulación de película del mismo desarrollador, en
desarrollo): su motor wasm, sus configuraciones y sus recetas, en la
ventana de render en un apartado *Plugins* después del de IA, con vista
previa, recetas y simulador de grano; el módulo **cifrado**, con el logo
del plugin, un enlace al proyecto (aviso: app en desarrollo, esto es un
adelanto) y la **licencia cerrada** dicha con claridad.

**Decisiones.**
1. **Paquete `.rpk`** (*Repackshot plugin*): `RPK1` + cabecera JSON en
   claro (`id`, `version`, `abi`, `bytes`, `sha256` del cifrado, `nonce`)
   + **AES-256-GCM** (WebCrypto) de un contenedor plano (entradas
   nombre/bytes: `manifest.json`, `plugin.js`, `module.wasm`, `presets/`,
   `logo.svg`, `LICENCE.txt`, `NOTICES.txt`). La **clave de activación**
   (32 bytes, base64) **no está en el repositorio** (el anfitrión es de
   código disponible: no puede guardar secretos): llega por `keyUrl` del
   registro (una URL del desarrollador, que puede rotarla o condicionarla
   más adelante) o la teclea el usuario al instalar. El paquete se guarda
   **cifrado** (IndexedDB, también en WebView2) y la clave aparte; se
   descifra **solo en memoria** al cargar, nunca se escribe en claro. Lo
   que esto protege: el módulo en reposo y en tránsito, y que el paquete
   no sirva fuera de Repackshot sin la clave; lo que no: a quien depure el
   navegador con la clave en la mano. Dicho así en `ARCHITECTURE.md`.
2. **Anfitrión** (`src/plugins/`): registro (`src/data/plugins.json`: id,
   nombre, editor, versión, resumen es/en, licencia `closed`, `homepage`,
   `url` del paquete, `sha256`, `bytes`, `keyUrl`), almacén (IndexedDB),
   cargador (descifra en memoria → `plugin.js` como módulo ES desde un
   Blob URL en un **Worker** sin DOM, con el `module.wasm` transferido;
   `WebAssembly.Module.imports()` vacío exigido para un módulo que lo
   declare), ABI v1 por mensajes: `info`, `presets`, `render({w, h,
   píxeles lineales f32 por planos o RGBA8, ajustes}) → RGBA8 + info`,
   `cancel`. El manifiesto declara dónde entra (`slots: ['render.plugins']`)
   y **sus mandos** (`controls`: clave, etiqueta es/en, tipo
   deslizador/lista/interruptor, mín/máx/paso/defecto, grupo): la interfaz
   del apartado es **genérica** y la dibuja desde el manifiesto; `plugin.js`
   traduce mandos y receta a los ajustes del motor. Un plugin nunca toca el
   DOM ni el *store*: el anfitrión le da píxeles y recibe píxeles.
3. **Ajustes ▸ Plugins** (grupo *sistema*, antes de *Almacenamiento*):
   la lista del registro con logo, nombre, editor, versión, tamaño,
   resumen, **«Licencia cerrada»** y enlace; *Instalar* (descarga →
   comprueba `sha256` → clave por `keyUrl` o pedida → guarda), *Actualizar*,
   *Quitar*, **Instalar desde archivo…** (`.rpk` + clave): la herramienta
   queda a la vista para plugins futuros. Cada plugin instalado muestra su
   licencia completa desplegable y la frase: «El código de este plugin es
   cerrado; la licencia de Repackshot no lo cubre».
4. **Ventana de render ▸ Plugins**, después de *IA*: un bloque por plugin
   con *slot* `render.plugins`. Para el de película: logo, nombre,
   «Adelanto de una app de edición de fotos y simulación de película del
   mismo desarrollador, en desarrollo» con el enlace, licencia cerrada;
   **vista previa** (el resultado actual a tamaño de previa por el motor,
   en el *worker*, con retardo); **recetas** (la lista del plugin por sus
   categorías y con **sus nombres públicos**: aintfilm no muestra marcas
   de fabricantes ni de películas (su regla D112) y aquí tampoco); los
   **mandos** del manifiesto (exposición y forzado, formato de negativo,
   grano: cantidad y tamaño, halación, difusión, copia/escaneo, semilla,
   lo que el plugin declare); **Aplicar** → un resultado nuevo en el visor
   de resultados, como la IA, con `provenance: { plugin, version, recipe,
   controls }`. Los ajustes del plugin viven en los del render
   (`plugins: Record<id, …>`), deshacibles y guardados con el proyecto.
5. **El paquete de película** se construye con `tools/plugins/build-film.mjs
   --aintfilm <ruta del checkout>`: toma `public/engine/itsnotfilm-engine.wasm`
   (compilado reproducible y sin importaciones), las recetas
   (`src/engine/presets/`), el logo (`assets/exported/marks/LOGO.svg`) y
   la licencia de ese repositorio; el `plugin.js` del plugin (el pegamento
   del ABI en C: `inf_alloc`, `inf_render_linear_rgba`… con la regla de
   no retener vistas entre llamadas) se escribe **nuevo** en
   `tools/plugins/film/` (es nuestro; no se copia código del otro
   repositorio al nuestro: lo cerrado va solo dentro del paquete cifrado).
   `tools/plugin-pack.mjs <carpeta> <salida.rpk> [--key b64 | --new-key]`
   empaqueta y cifra. Comprobación de marcas sobre el paquete y las
   cadenas del anfitrión con la lista de *hashes* de aintfilm
   (`scripts/check-brands.mjs` de ese repositorio, ejecutado desde allí).
6. **Publicación.** El `.rpk` como *asset* de la release de Repackshot
   (v0.1.6) y el registro apuntando a él con su `sha256`; la clave la
   guarda el desarrollador (el agente la deja en el *scratchpad* para el
   responsable, nunca en el repositorio) y `keyUrl` queda vacío hasta
   que la aloje: mientras, se pide al instalar.

Tres más del usuario (14-10, con la fase ya construida):

7. **El logo es el de ahora**, no `assets/exported/marks/LOGO.svg` (ese es
   el antiguo y no se usa en ningún sitio): el cartucho de 35 mm como
   rejilla de 16×16 puntos a dos tintas de `src/data/marks.ts` (`LOGO`, con
   las tres columnas de la lengüeta más cercanas al cartucho en la tinta
   tenue, regla M32-02/D50), el que dibuja `src/components/DotGrid.tsx` y
   rasteriza `scripts/build-icons.mjs` en `design/icon/itsnotfilm-1024.png`
   y en la hoja de pruebas `design/icon/aintfilm-mark.png` (la referencia de
   cómo tiene que verse, con el logotipo). `tools/plugins/build-film.mjs`
   construye el `logo.svg` del paquete desde las filas de `LOGO`: un `rect`
   por punto, las dos tintas como dos grises, celdas cuadradas (es vector:
   sin preocuparse del suavizado), con exactamente la misma regla de la
   tinta tenue que `DotGrid`. Después (14-10) el usuario mandó **su logo
   como imagen** (2000×2000, puntos blancos sobre negro: el cartucho de
   frente —eje arriba y abajo, hombros, cuerpo, la banda de la etiqueta como
   hueco— y la lengüeta saliendo a la derecha, con sus tres columnas más
   cercanas al cartucho en tres grises de oscuro a claro y después blanco):
   el `logo.svg` tiene que reproducir ese patrón de puntos exactamente, y se
   comprueba rasterizándolo a 2000×2000 sobre negro con el Chromium local y
   comparándolo con la imagen punto a punto. Si `marks.ts` y la imagen no
   coinciden, gana la imagen: es lo que el usuario llama el logo. El logo va
   sobre una tesela negra u oscura en la tarjeta del plugin, para que los
   puntos blancos se lean en los dos temas.
8. **Las recetas son un carrusel horizontal**, como la tira de película de
   la app móvil: una tarjeta por receta (la miniatura arriba, el nombre
   público debajo, la categoría como etiqueta pequeña), que se desplaza de
   lado con la rueda o el *trackpad* y con las flechas, con la tarjeta
   elegida contorneada, ajuste a tarjeta y fundidos en los dos extremos
   cuando hay más; el cromo acromático, el color solo dentro de las
   miniaturas. La miniatura de cada tarjeta es la receta aplicada a **una
   sola escena de prueba**: una escena nueva de `rt-cli`, `film-thumb`, en
   `engine/crates/rt-cli/src/scenes.rs` junto a `e5-lamp` y
   `e5-glass-bottle` (el frasco de perfume de `glass_bottle` junto a la
   lámpara de mesa de `lamp`, en el cuarto oscuro, lámpara encendida,
   16:10, 320×200), renderizada una vez con `rt` a 512 muestras con
   *denoise* y metida en el paquete como `thumb-base.png` (16 bits lineal u
   8 bits sRGB, lo que prefiera la entrada del plugin). Al cargar el plugin,
   el anfitrión le pide al *worker* la miniatura de cada receta desde esa
   base (guardada en IndexedDB por versión del plugin e id de receta: se
   hace una vez) y enseña un hueco hasta que llega cada una. Esa misma base
   es lo que enseña la vista previa cuando todavía no hay resultado. Si
   cada miniatura es lenta para ~70 recetas, a media resolución (160×100)
   y ampliada por CSS; se dice el tiempo por miniatura.
9. **Animación**: cuando el plugin se aplica a un trabajo de animación,
   cada fotograma pasa por el motor con su propia semilla, `seed = seed0 +
   índice del fotograma` (el campo `seed` del motor), para que el grano sea
   el de una película de verdad fotograma a fotograma y no una capa fija;
   la imagen fija usa `seed0`; la vista previa enseña el fotograma 0;
   `provenance` guarda `seed0` y la regla. Test por fotograma con el plugin
   de prueba (el fotograma 0 y el 1 difieren donde el de prueba usa la
   semilla; el mismo `seed0` dos veces da los mismos bytes).

**Depende de.** U5 (ventana de render, visor), X2 (resultado derivado),
U6 (ventana de ajustes).

**Criterio.** Tests (mutación comprobada): empaquetar → descifrar devuelve
los mismos ficheros; clave errónea y paquete manipulado fallan limpios
(etiqueta GCM); `sha256` del registro comprobado; un plugin de prueba de
los *fixtures* (sin wasm: invierte los píxeles) pasa por el *worker* de
punta a punta y deja un resultado con `provenance`; el manifiesto dibuja
sus mandos; los ajustes del plugin son deshacibles y se guardan.
Comprobación de navegador `tools/plugins-check.mjs` (instala el plugin de
prueba desde un servidor local con clave tecleada; abre *Plugins* de la
ventana de render; aplica) con capturas `docs/ui/settings-plugins.png` y
`docs/ui/render-plugins-film.png` (esta con el paquete de película real
construido desde el *checkout*). `UI.md`, `ARCHITECTURE.md` (§1: los
plugins no son dependencias: los instala el usuario, con su licencia;
§ nuevo: el formato `.rpk`, el ABI y lo que el cifrado protege), `SPEC.md`
§3.8, CHANGELOG, `release-notes` (cómo publicar el `.rpk`).

**Hecho** (2026-10-14). **El paquete** (`src/plugins/rpk.ts`, el mismo código en
la página y en las herramientas por la eliminación de tipos de Node): `RPK1`, la
cabecera en claro de la decisión 1 y AES-256-GCM de un contenedor plano; el
cifrado autentica además la cabecera (menos su `sha256`), así que una cabecera
editada no abre; el `sha256` y la longitud se comprueban antes de descifrar.
`tools/plugin-pack.mjs` (`--new-key`, que solo la imprime, `--key`, `--key-file`)
y `tools/plugin-unpack.mjs`. **El anfitrión** (`src/plugins/`, una capa nueva de
`tests/boundaries.test.ts`: `plugins → core, data`): el registro
`src/data/plugins.json` con su cargador; el almacén en IndexedDB (paquete cifrado
y clave aparte en una transacción; en memoria sin él); la instalación del
registro (tamaño y `sha256` del registro, cabecera con su `id` y su `version`,
la clave que ya tiene una actualización, la de `keyUrl` o la tecleada) y desde
archivo; el arranque (descifrado en memoria, `WebAssembly.compile` y la regla
de `noImports`, `plugin.js` en un Blob URL como Worker de módulo, `init` con el
módulo y los archivos transferidos) y el ABI v1 (`info`, `presets`, `render`,
`cancel`, más `ready`, `cancelled` y `error`); el servicio que pasa un resultado
por un plugin (un EXR como planos lineales de su luz, si no RGBA8; la vista
previa a 480 px; el alfa del origen de vuelta). **Ajustes ▸ Plugins** (grupo
*Sistema*, antes de *Almacenamiento*) y **Ventana de render ▸ Plugins**
(después de *IA*), los dos dibujados desde los datos: el registro y el
manifiesto; los ajustes en `RenderSettings.plugins` (deshacibles, un arrastre
una entrada, con el proyecto; un proyecto anterior tiene `{}`); *Aplicar* deja
un resultado nuevo con `provenance: { plugin, version, recipe, controls, from,
label }`, guardado donde su origen y abierto en el visor comparado con él, que
dice de dónde sale. **El plugin de película**: `tools/plugins/film/manifest.json`
(los mandos de §9 del manual de aintfilm: formato del negativo, exposición y
forzado, color y su modelo, contraste, saturación, calidez, exposición de la
copia, copia o escaneo, grano —cantidad, tamaño, color, sesgo tonal, suavidad,
enfoque del escáner, respuesta a la luz, escaneo—, halación, difusión, objetivo,
motor de grano, semilla), `tools/plugins/film/plugin.js` (nuevo: el ABI en C con
`inf_render_rgba` e `inf_render_linear_rgba` y un registro lateral vacío, sin
retener vistas entre llamadas) y `tools/plugins/build-film.mjs --aintfilm`, que
lo monta y lo empaqueta. **El paquete construido** (con las decisiones 7–9):
`film-0.1.0.rpk`, versión **0.1.0** (la de aintfilm; motor 0.1.0), **1 948 807
bytes**, `sha256`
**`e6b1e2c70beae17375d3eba222a2095fb653cce39264af12a0faa9229216b264`**, 137
archivos y 127 recetas (51 películas, su color solo, 8 granos, 13 filtros, 4
objetivos), fijado en el registro con la `url` de la release v0.1.6 y `keyUrl`
vacío; la clave la tiene el responsable (fuera del repositorio). Tests: 62
nuevos en siete archivos (`plugins-rpk`, `plugins-host`, `plugins-settings`,
`plugins-brands`, `plugins-film`, `plugins-thumbs` y `plugins-frames`; una parte
de `plugins-film` solo donde hay un *checkout* de aintfilm; y que `?testPlugins=`
no esté en una versión de producción), con 44 mutaciones comprobadas (cada una
rompe lo que un test guarda y ese test falla; una más sobrevive a propósito:
quitar la comprobación de la longitud del cifrado, que su `sha256` ya cubre); `tools/plugins-check.mjs` en verde
con el paquete de verdad (instalar del servidor local con la clave tecleada,
una clave errónea, quitar e instalar desde archivo, la vista previa con los
números del plugin, deshacer, *Aplicar*, acromático, recargar) y las capturas
`docs/ui/settings-plugins.png` y `docs/ui/render-plugins-film.png`.
`docs/release-notes/plugins.md`: cómo se publica el `.rpk` y qué se hace con la
clave.

**Hecho, decisiones 7–9** (2026-10-14). **El logo** (7):
`tools/plugins/dot-grid.mjs` escribe el `logo.svg` del paquete, un `rect` por
punto en celdas cuadradas, desde la **imagen del logo del dueño** (`build-film
--logo`: leída punto a punto, sus columnas y filas de puntos por dónde hay tinta
y la tinta de cada uno agrupada en los niveles de la imagen) o, sin ella, desde
las filas de `LOGO` del `marks.ts` del *checkout* con la regla de dos tintas de
`DotGrid`; el SVG antiguo ya no se usa. El del paquete sale de la imagen: 15×15,
121 puntos, la lengüeta en `#808080`, `#BFBFBF` y `#E0E0E0` y el resto `#FFFFFF`,
el punto 0,862 de la celda. **Comprobado** rasterizando el SVG a 2000×2000 sobre
negro con el Chromium local, colocado donde la imagen tiene su rejilla:
**225 de 225 celdas iguales** (la misma clase de tinta y la media de cada punto
igual: diferencia máxima 0), los centros a 1 px como mucho, los cuatro niveles
128 · 191 · 224 · 255 en los dos, el 98,9 % de los píxeles a menos de 24 niveles
y un 96,2 % de solape de la tinta (los puntos de la imagen están dibujados a
mano, no son círculos perfectos). Va sobre la tesela negra de *Ajustes* y de la
ventana de render, en los dos temas. **El carrusel** (8): la escena `film-thumb`
de `rt-cli` (`rt --write-film-thumb`; el frasco y la lámpara salen de
`bottle_meshes`/`lamp_meshes`, y las escenas E5 de los dos siguen dando los
mismos bytes) renderizada a 512 muestras con *denoise* (147 s con 4 hilos) en
`tools/plugins/film/thumb-base.png`; el manifiesto la nombra (`base`); la vista
previa sin resultado es esa imagen por el plugin (Aplicar sigue esperando un
resultado); las tarjetas (`ui/panels/plugin-recipes.ts`) llevan la imagen base
reducida a 160 × 100 por cada receta con los mandos por defecto, hechas una a
una, guardadas en IndexedDB (versión 2, almacén `thumbs`) y entregadas al
momento la vez siguiente. **Tiempo por miniatura**: con el motor de película,
~1 s a 320 × 200 y ~0,2 s a 160 × 100 en Node con la máquina cargada (mediana
de 20 recetas: 963 ms y 199 ms), así que van a media resolución; en el
navegador, las 128 tarjetas en 27 s (0,21 s cada una, de la primera apertura a
la última imagen) y 1,7 s al abrir otra vez. **La semilla por fotograma** (9):
`role: 'seed'` en el deslizador de la semilla (el de película y el de prueba,
que gana un ruido sacado de ella), `frameControls`/`frameSeed`/`SEED_RULE`, el
interruptor **Aplicar a los trabajos de render** (`RenderSettings.plugins[id].
jobs`) y el paso de la cola que manda cada imagen por el plugin; la primera, al
historial con `provenance.seed`. Comprobación de navegador en verde con los
puntos nuevos (`d2_base_preview_and_cards`, `d2_film_cards`,
`d2_film_cards_kept`, `e_jobs_switch_undoable`, `f_carousel_keys_wheel`) y las
dos capturas rehechas.

**No encajó con el plan.** (1) **Los nombres públicos**: el árbol de aintfilm
todavía enseña marcas (su M38-07, el renombrado, está pendiente; su
`check:brands` está en rojo a propósito). Se usó lo decidido allí: una película
es su id neutro en mayúsculas (*CN-01*, D113, desde `stocks-map.json`, hasta
que el dueño elija nombres en M38-10, y entonces hay que reconstruir el paquete),
con su ISO de caja; filtros y formatos, las palabras de D112 (*BLACK DIFFUSION*,
*WARM DIFFUSION*, *SPARKLE*, *PEARL*, *INSTANT 54×86*, *15-PERF 70 MM*); granos
y objetivos, palabras genéricas, con las del diccionario de aintfilm donde las
hay. (2) **La comprobación de marcas**: `scripts/check-brands.mjs` de aintfilm
solo recorre su propia lista de rutas y el *checkout* no tiene `node_modules`
(importa `typescript`), así que no se puede ejecutar desde allí sobre otra
carpeta. Se reescribió su mecanismo, tal como lo describe, en
`tools/plugins/brand-scan.mjs` (lee la lista de *hashes* del *checkout*, que no
se copia) y se comprobó además con las funciones exportadas del propio script
(con un *hook* de resolución hacia un TypeScript del sistema, sin tocar el
*checkout*): los dos dan lo mismo. Limpios: el manifiesto, `recipes.json`,
`plugin.js`, el logo, la licencia y las cadenas de Repackshot. Quedan, dentro
del paquete cifrado y sin enseñarse nunca, las etiquetas internas del motor: el
módulo (15 coincidencias en el último *build*, su `--dist` está en rojo por lo mismo), los ajustes de
los *presets* (490: el tipo de los filtros de difusión y la clave del papel del
modelo espectral, que tiene cada *preset* completo), `engine.json` (3: dos ids de
formato) y `NOTICES.txt` (9, lo que una licencia exige nombrar); son de su M38-07
y M38-08 (renombrar etiquetas de *serde* por parche). (3) **Los *presets* van
completos**, no dispersos: el *build* los lee con `settingsFromValue` del propio
*checkout* (ejecutado con la eliminación de tipos de Node) para que el pegamento
escale valores sin adivinar los valores por defecto de *serde*; son 1,1 MB del
paquete. Una receta de *color solo* trae el grano por defecto del motor (así
rellena *serde* un *preset* que no lo dice): el interruptor *Grano* lo quita.
(4) Se añadieron al manifiesto, sin estar en la lista: `groups` (los títulos de
los grupos), `minLabel` en un deslizador (la regla de aintfilm de que el tope
izquierdo dice *PRESET* y no manda nada), `aux` y `notices`; y al ABI, `init`,
`ready`, `cancelled` y `error`. (5) El logo del registro no puede ir en línea (es
del paquete cerrado): antes de instalar se ve un icono neutro. `homepage` es
`https://aintfilm.app`, el dominio que configura `src/lib/appConfig.ts` de
aintfilm; `publisher`, *Grohle*. La semilla por defecto es la del motor (1).
(6) *Aplicar* guarda la imagen donde se guardó su origen, como la de la IA: en
el navegador es una descarga. Cancelarlo para el *worker* (el render del módulo
es una sola llamada síncrona) y el siguiente uso lo arranca de nuevo. (7) La
vista previa a 480 px enseña el grano de un negativo pequeño (*75 µm por
píxel*): es lo que dice el motor; *Aplicar* lo hace al tamaño del resultado. (8)
Las herramientas necesitan Node 22.18 o posterior. (9) `modelCatalogue()` de
`src/main.ts` lee `?testModels=` con `atob` sin decodificar UTF-8 (un nombre con
acentos saldría mal); el de plugins lo hace bien; el de modelos no se tocó. (10)
El lanzador no cambia (el almacén es IndexedDB también en WebView2) y la prueba
en un Windows real queda en la lista de `docs/release-notes/plugins.md`.

**No encajó con el plan, decisiones 7–9.** (11) **El logo de `marks.ts` no es el
de la imagen**, y no solo en los grises: la rejilla `LOGO` del *checkout* es de
16×16 con 137 puntos (eje de 4, hombros de 10, cuerpo de 12 que pasa por encima
de la lengüeta) y una sola tinta tenue `#4A4A4A`; la imagen del usuario (igual
que el dibujo del dueño de su `design/screens/owner-0912b-film-cartridge.jpg`) es
de 15×15 con 121 puntos (eje de 3, hombros de 7, cuerpo de 9) y tres grises.
Ganó la imagen, como se pidió, pero entonces el logo no puede salir de las filas
de `LOGO`: sale de la imagen, leída por `build-film --logo` al construir (la
imagen es del dueño y va solo dentro del paquete, como su logo: no se guarda en
este repositorio, ni sus filas); sin `--logo` sale el de `LOGO`, que no se
publica (las notas de publicación lo dicen). La regla de `DotGrid` es la del
camino de `marks.ts`. Habría que llevar a aintfilm que su `LOGO` no es el logo
de su dueño. (12) **«Un `rect` por punto» y los puntos redondos**: la imagen y
`DotGrid` dibujan círculos; cada punto es un `rect` con `rx = ry` la mitad de
su lado (un círculo), en su celda cuadrada, para cumplir las dos cosas. (13) La
imagen base es **PNG sRGB de 8 bits**, lo que escribe `rt` (no escribe 16 bits
lineales), y entra por `inf_render_rgba`, como cualquier resultado PNG; la
escena lleva `clamp_indirect` 2: el filamento visto a través de dos vidrios da
cáusticas que el trazador encuentra como *fireflies* incluso a 512 muestras con
*denoise*. (14) Las tarjetas se hacen cuando el bloque del plugin aparece por
primera vez (ahí arranca su *worker*), no al arrancar la aplicación, y la de
*Sin receta* también lleva su imagen; una versión nueva las rehace (la clave es
la versión, no el `sha256`: un paquete distinto con la misma versión se quedaría
las de antes, y por eso el paquete reconstruido aquí, que nunca se publicó,
sigue siendo 0.1.0). (15) **Aplicar a un trabajo de animación no existía**: el
plugin solo trabajaba sobre un resultado del historial, y el historial guarda
solo el primer fotograma de una animación. Se añadió el interruptor *Aplicar a
los trabajos de render* (`jobs`, apagado por defecto), que pasa por el plugin
cada imagen de los trabajos (fijas y fotogramas), después de guardar la del
motor y sin entrar en la barra de progreso. (16) «El índice del fotograma» es su
número en la animación menos uno, no su posición en el trabajo: un tramo
renderizado aparte (3–4) tiene el grano que tiene en la animación entera; la
semilla da la vuelta al rango del deslizador (la del de película llega a 999
999 999). (17) La vista previa no enseña otros fotogramas: es siempre la
semilla puesta, la del fotograma 0. (18) El almacén de miniaturas de IndexedDB
no tiene test en Node (no hay IndexedDB en los tests): la comprobación de
navegador ve que guarda y devuelve (`d2_film_cards_kept`); que *Quitar* las
borre solo lo comprueban los tests sobre el almacén en memoria.

**P6b** (2026-10-14, petición del usuario: el carrusel como la búsqueda de
películas de la app de aintfilm). **Hecho**: un deslizador fino bajo el
carrusel, de su ancho, atado a su desplazamiento en los dos sentidos (sus pasos
son las posiciones de ajuste del carrusel, una por tarjeta y la última su final:
`ui/strip-math.ts`), con la tarjeta elegida marcada en su pista y manejable con
el teclado; y los filtros, que el plugin declara en su respuesta `presets`
(`filters` y los `tags` de cada receta) y el anfitrión dibuja como filas de
*chips* sobre el carrusel, combinados (Y), con la cuenta (*23 de 127 recetas*),
la receta elegida primera y marcada *Fuera de los filtros* cuando la dejan
fuera, y guardados con los ajustes del plugin (`filters`, deshacibles). El de
película trae los de la app (`docs/MANUAL.md` §7 y `src/lib/filmFilter.ts` de
aintfilm): **Tipo** (sus palabras: *COLOR* para el negativo en color, *B&W*,
*DIAPOSITIVA*, *CINE*, por la clase de cada película) e **ISO** (sus tres
bandas, *≤ 100 · 200–400 · ≥ 800*, cortadas en 100 y 400 por la ISO de caja),
más **Grupo** (películas, el color de una película, grano, difusión, objetivo:
los grupos del paquete). Paquete reconstruido con la misma clave: 1 956 072
bytes, `sha256`
`a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`, versión
0.1.0 (no publicado aún). Tests: 9 nuevos (`plugins-filters`, y uno en
`plugins-film`), 15 mutaciones comprobadas; la comprobación de navegador
arrastra el deslizador, lo mueve con la rueda y con el teclado, y aplica dos
filtros (`f_scrub_slider`, `f_two_filters`). **No encajó.** (1) La app tiene un
tercer filtro, **MARCA**, y no está: son nombres de fabricantes (su D112); el
cuarto, **ORIGEN** (de la app, mías, de otros), aquí solo tendría uno. No hay
más facetas en la app (formato, proceso, época): no se inventaron. (2) *Color /
B&W* es el **Tipo** de la app, con sus cuatro valores: la diapositiva y el cine
también son de color, y la app los separa así. (3) La app dibuja sus filtros
como desplegables en una fila (M31-03); aquí son *chips*, como se pidió. (4) Una
receta sin película (grano, filtro, objetivo) no tiene Tipo ni ISO: solo está en
sus *Todos*, la regla de la app.

## Reporte de errores del usuario (14/15-10) — triaje, B1 y decisiones

El usuario mandó un reporte de errores graves (guardado tal cual en
`TODO.md`, segundo documento). Su triaje, punto por punto contra el código
de `main` (`72e4f79`) y la rama de O2, está en **`TRIAGE.md`**: qué hay
hoy, si se reproduce, si es *bug*, *falta* o *decisión*, causa, arreglo y
dependencias. De ahí salen:

### B1 · Arreglos del reporte — **Sonnet** — hecha

**Qué.** Los fallos confirmados y lo que el usuario pidió sin dejar nada
abierto:

1. **Enfocar con clic (1.8).** El pico ya es el del píxel; lo deshace el
   mismo clic: OrbitControls dispara `end` en cada `pointerup` y
   `src/main.ts` parchea la cámara con `focusDistance: v.distance`. Una
   función pura en `core/camera.ts` (`orbitPatch(cam, view)`): sin parche
   si la vista no cambió; el foco sigue a la distancia de órbita solo si ya
   la seguía (la regla de `view-objects.ts` del *gizmo*). Se usa en
   `onViewChange`, en el gesto y en *Mirar a través*. De paso: `clickAt`
   mide desde la cámara **vista** (`viewedCamera`), no la activa.
2. **Tela a *Nodos* (1.6, de paso).** `outputSetup` de la tela usa
   `fabricMeanColor`, no `(a + b) / 2`: el vaquero no vuelve al gris
   azulado que E6 corrigió.
3. **Extensión `.repack` (4.1).** Lo pide el usuario, así que el cambio
   de contrato de U2 es suyo (regla 12): se guarda `.repack`, el contenido
   sigue siendo el mismo JSON, se abren `.repack` y `.repack.json` (también
   soltándolos en la ventana); el lanzador admite `repack` en
   `WRITABLE_EXTENSIONS` y en sus diálogos; la prueba de Wine y los
   documentos (SPEC, ARCHITECTURE, UI) lo dicen. La asociación del archivo
   en el instalador queda fuera (no se pidió).
4. **Intentos de la IA (2.2).** No hay bucle sin fin en el código (tope de
   4 por variante), pero la cola no lo cuenta: la fila dice «intento *a* de
   4», la variante y el motivo del último fallo, y la barra se reparte por
   intentos. Y la vista previa de la ventana de render deja de reiniciarse
   con cada instantánea del gestor de modelos que no cambia lo instalado ni
   lo listo (hipótesis del triaje: durante una descarga llegan cada 200 ms).

**Criterio.** Cada arreglo con su test, que falla sin el arreglo (regla
3): `tests/camera-focus.test.ts` (vista igual sin parche, órbita con el foco
siguiendo, órbita tras un enfoque con clic); el color de la tela para todos
los `MATERIAL_PRESETS` (falla hoy en `DENIM`, `SATIN`, `MICROFIB`); los
nombres y filtros de `.repack` en la página y en `rt-app` (`files.rs`,
`dialogs.rs`); la fila de la cola y el controlador de la vista previa con
un reloj falso. Una comprobación de navegador en `tools/` que hace el clic
real sobre el frasco del ejemplo y lee *Distancia de enfoque* (en el triaje
pasaba 688 → 660 → 688). `npm run qa`, `npm run engine:test`, fmt y clippy.

**Hecho.** (1) *Enfocar con clic*: `orbitPatch(cam, view)` y
`focusFollowsOrbit` en `core/camera.ts` (sin parche si azimut, elevación,
distancia, objetivo y ancho ortográfico no cambian; el foco sigue a la
distancia solo si ya la seguía), usados por `onViewChange` y por el gesto de
`src/main.ts`, por `lookThroughAction` y por el *gizmo* de la cámara; el clic
mide desde la cámara vista (`focusPickAction` en `core/view-objects.ts`, que
`clickAt` llama: la cámara de *Mirar a través*, o la activa si se mira por una
luz). `tests/camera-focus.test.ts` (11 tests nuevos) y
`tools/focus-click-check.mjs`: el clic real sobre el frasco da 688 → 660 y se
queda (con el `main.ts` de antes, 688 → 660 → 688 y *Mover la cámara* en el
deshacer: 4 de las 8 comprobaciones en rojo). (2) *Tela a Nodos*:
`fabricMeanColor` y `WEAVE_WARP_SHARE` pasan a `core/fabric.ts` (reexportados
por `core/materials.ts`, para que el grafo los use sin ciclo de importación) y
`outputSetup` de la tela los usa; test en `tests/material-graph.test.ts` con
todos los `MATERIAL_PRESETS` (falla en el vaquero, el raso y la microfibra sin
el arreglo). (3) `.repack`: `core/project-names.ts` (`PROJECT_EXTENSION`,
`PROJECT_EXTENSIONS`, `PROJECT_FILTER_EXTENSIONS`, `isProjectName`), el selector
del navegador (`accept` y `types`), el diálogo del escritorio (un filtro con
`repack` y `repack.json`), soltar y *Importar*; `WRITABLE_EXTENSIONS`,
`is_project_name` y las pruebas de `files.rs`, `dialogs.rs` y `tests/files.rs`
en `rt-app`; `packaging/wine-dialogs.mjs` (ejecutada aquí contra una compilación
de Windows del lanzador bajo Wine: pasa, con `RPX_EXT=repack` y el filtro
`*.repack;*.repack.json`); SPEC §3.9, ARCHITECTURE §8, UI.md y la nota de U2.
(4) *Intentos de la IA*: `AiPostProgress` lleva `maxAttempts` y `reason`
(1-based, repartido por intentos); el lanzador saca `lastFailure` en el estado
del *post* y reparte la barra en cuartos (`attempt_range` en `post.rs`), el
servicio sintético y el conductor de wasm igual; la fila dice *IA · mosaico 2 de
4 · intento 2 de 4* (también con la variante) y, debajo, *El intento 1 no pasó:
<motivo>* (`aiStatusText`, `aiWhyText`, es y en); la vista previa de la ventana
de render solo se rehace si cambian los modelos instalados o `ready`
(`previewTriggers` en `ui/ai-preview.ts`; con el reloj falso, 40 instantáneas de
descarga seguidas dan 1 petición y no 40). Cada arreglo con su test, y cada test
falla al reintroducir el fallo (mutaciones comprobadas una a una).

**Qué no encajó.** (1) **El tope es 4 en todas partes** (`MAX_ATTEMPTS` de
`rt-post/job.rs` y `core/ai.ts`, `maxAttempts` del lanzador, el bucle del
sintético): no hay bucle sin fin, y con N variantes son hasta 4 × N intentos. Pero
el conductor de wasm (`runGuarded`) contaba los intentos desde 0 en el progreso
y el resto desde 1: ahora todos desde 1. Lo que ve el usuario sigue sin
reproducirse sin el registro del lanzador (que ahora dice *attempt k of 4
failed*). (2) **La barra por cuartos tiene un coste**: con un solo intento
aceptado la barra de la IA llega a un 23 % antes de que el trabajo acabe y salta
al final (la fila dice *intento 1 de 4*); es lo pedido, pero si queda raro, el
reparto desigual (el primer intento con más barra) es una decisión de criterio
visual (regla 11). (3)
El motivo va en una segunda línea de la fila y en su texto emergente; **no se
tocó el aviso final** (el triaje lo mencionaba): el informe del visor ya lo
dice. La fila de una tarea en curso con reintento crece (el estado y el motivo
envuelven en vez de cortarse) y se reparten las columnas de la cola (el nombre
cede ancho al estado). (4) **Foco con clic**: no se tocan el plano de foco con
*tilt* (b del triaje) ni el pico a través de la distorsión de una lente trazada
(O2); con un plano de la animación con el cabezal fuera de 0 el clic mide desde
la cámara vista sin la pose (ese foco lo anima el plano de todos modos). (5)
**`.repack`**: sin asociación del archivo en los instaladores (no se pidió);
guardar sobre un archivo abierto lo escribe donde está, con el nombre que
tenga (un `.repack.json` sigue siéndolo); `tools/desktop-window-check.mjs` y
`desktop-platform-check.mjs` ahora guardan `.repack`, pero no se pudieron
ejecutar aquí (piden el lanzador de *release* y su ventana). (6) **Hallazgo
fuera del encargo**: al pasar a *Nodos* un plástico translúcido con dispersión
interna (`HDPE_WHITE`, `PP_NATURAL`, `PMMA_FROST`) el grafo pierde el medio
(`kind`, `scatterMm`, `scatterColor`, `scatterG`: el grafo no tiene entradas para
ello); el color base sí coincide ya en todos los materiales. (7) Un *mock* más
permisivo que la realidad: el estado del *post* de `tests/ai-desktop-service.test.ts`
no llevaba `lastFailure`; ahora sí.

**Pendiente del usuario** para cerrar lo que no se pudo reproducir:
el registro del lanzador (`<datos>/logs/repackshot.log`) de una pasada de
IA que se quede en intentos (2.2), y una escena guardada donde el
*denoise* lave luces y colores, con y sin él (4.2: medido en el ejemplo,
cambia la luminancia y la saturación media en menos del 0,1 %).

### Con O2

- O2 dibuja en *Rápido* la distorsión de una lente trazada, pero el pico
  usa el rayo sin distorsión: con un gran angular o el ojo de pez el clic no
  cae bajo el cursor. Arreglado en O2 (`593d480`: un solo mapa en
  `render/lens-profile.ts` para el pase de pantalla y el pico).
- **1.3** (elegir lente, distorsión y bokeh de verdad) es O2.
- **1.4** (ventana con los elementos al pasar por una lente de la lista)
  va tras O2: el corte en SVG ya existe; falta el aviso flotante y pedir al
  motor la información de la lente señalada (S–M, Sonnet). Hecha en **O2b**.

### Faltas que ya tienen fase

- **1.1 y 5.1** (tipo de mapeado, tamaño, desplazamiento, tamaño relativo
  al sólido): los mandos de M2a existen, pero solo salen con una imagen en
  la ranura; *Completo* y *Render* los dibujan desde **M2b** (hecha). Lo
  demás de 1.1 y la decisión de 5.1 siguen pendientes.
- **1.6** (los nodos no pilotan el material en *Completo*, el modo por
  defecto): **M3b** (hecha).
- **3.1** (vista en vivo del render seleccionado en la cola): fase nueva
  **U14** (Opus, M), tras B1 porque los dos tocan la fila de la cola: el
  trabajo en curso enseña sus fotogramas al seleccionarlo (escritorio: los
  del trabajo de `/api/render`; web: la acumulación del *pool*), sin frenar
  el render (coste medido); los terminados siguen abriendo el visor.
  **Hecha**: ver U14.

### Decisiones para Fable (regla 11; datos en `TRIAGE.md`)

- **O2**: el veredicto de la hoja (`out/lens-sheet.html` de O2): qué
  lentes dan ojo de gato, burbuja, cremoso y remolino; prescripciones y
  diafragmas supuestos; constantes del adaptador anamórfico; focales de
  los gráficos. Y el muestreo por máscara contra el ruido del bokeh trazado.
- **2.1**: las tolerancias de la guarda de la IA (hoy ±4,6 % de luminancia y
  ±1,8 % de color: casi invisible por diseño), con la comparación de X1
  parte B.
- **1.7**: qué mueve el interruptor de la focal (la cámara se acerca para
  mantener el tamaño del objeto enfocado, o la cámara se queda y cambia el
  encuadre) y cómo se ve en la cámara.
- **6.1–6.3**: los sets de L6 dentro de *Estudios* con sus muestras
  grandes, y sus luces como añadidos desactivables una a una sin tocar las
  del estudio.
- **5.1**: tamaño de las texturas y los procedurales relativo al sólido o
  absoluto (SPEC l. 456 contradice a SPEC l. 101 y a E6), y cómo convive
  con el tamaño manual.
- **E13** (MNEE; en la rama `wip/ccr-8df3f848/e13`, commit `385a4c9`, **sin
  fusionar**): cumple el coste en la botella de E5 (1,09×) y deja la leche
  dentro del 3 % de la referencia, pero no quita su grano (ruido 0,129 frente
  a 0,124 con la regla de pared fina) ni mejora la cáustica del vaso de agua
  (relMSE 0,52 frente a 0,49; el mapa de fotones da 0,29), y con vidrio curvo
  cuesta 1,8–2× porque Newton resuelve pocos caminos (15 de 81 bajo una bola a
  8 iteraciones). Con las cáusticas apagadas (los softbox) actuaría en casi
  todo producto de vidrio, más lento y sin mejora visible, así que el
  responsable no lo fusiona. Decidir: más iteraciones o semillas, cadenas de
  cuatro superficies, dejar las cáusticas al mapa de fotones, cambiar
  *Automático*, o fusionarlo apagado por defecto. Hoja en
  `out/e13-sheet.html` de esa rama (regenerable con `rt --e13-sheet`).
- **E10**: el adaptativo da 0,83–0,84× el relMSE del uniforme a igual
  tiempo contra el ≤ 0,6× del criterio; el reparto ideal por bloques de 8×8
  llegaría a 0,48× y 0,38× a igual número de muestras. Aceptarlo, cambiar el
  criterio o cambiar la regla de reparto (el contrato del brief: el cuantil
  50 % del error, bajando). Está solo detrás de *Terminar por ruido*.
- **1.2**: la gota y la mezcla de geometrías en *Ambiente* (con S4b; el
  párrafo de S4b dice cómo lo facilita).
- **S4b** (hoja `out/ambient-sheet.html` de esa fase, regenerable con
  `tools/ambient-sheet.mjs`): la parte del lóbulo hacia delante (propuesta
  0,5; la hoja tiene 0,25, 0,75 y 1); el coste de la lluvia (1,63× contra el
  1,3× del criterio, que no es la búsqueda sino la luz que la atraviesa):
  aceptarlo, rastros más cortos o más escasos, o un modelo de gota más
  barato para la cámara; el grano dentro de los rastros bajo la luz lateral;
  y la regla de los caminos estrechos desde la cámara (las gotas refractan
  también en ellos) frente a solo los rayos de cámara.
- **1.5**: el editor de elementos de una lente (editar, mover, añadir,
  girar 180°) sobre lo que O2 ya guarda como lente propia.
- **1.6**: si se añaden nodos *Madera* y *Tela* con las recetas de E6 (M3b
  no los trae; su párrafo dice cómo los facilita el intérprete), y si el
  ejemplo de madera de los grafos tiene que parecerse a la familia *Madera*
  (`docs/ui/m3b-wood.png`).
- **M3b**: el `NORMAL_MAP` de M3a con el azul por debajo de 0,5 (los copos
  de la pintura metalizada, la mitad de sus normales hacia dentro): cambiar
  el nodo, el ejemplo o el motor (el párrafo de M3b, «no encajó» 8).
- **4.2**: si el triaje se confirma con la escena del usuario, el recorte de
  *fireflies* y el borde solo por luminancia del *denoise*.
- **Q1** (los ◆ de su «no encajó»): dónde vive el control de la sección
  (hoy en el inspector de Escena, no en la barra del visor); si la tapa de
  un vidrio cortado refracta, como ahora en el motor, o es opaca del color
  del vidrio, como opción para el fotógrafo; y si el estudio puede cortarse
  alguna vez (hoy nunca, sin interruptor por pieza).
- **K1** (los ◆ de su «no encajó», con las tablas de la propuesta): las
  cifras de las siete recetas de interior (sol, paneles, partes, exposición
  e intensidad del entorno), cuál es la de partida del tipo *Interior* (no
  se eligió ninguna) y los umbrales del Doctor de interiores (escala de
  100 mm a 30 m, óptica por debajo de 18 mm a 24 mm, altura de ojo de 0,3 a
  2,2 m a 1,5 m, recorte cercano a la mitad de la distancia a la pared).
- **D1** (los ◆ de su «no encajó»): si recortar con *Estándar* es un fallo
  (los fondos blancos planos lo hacen) y si el arreglo es Filmic o AgX; los
  umbrales de los *fireflies* (nivel 1, aislamiento ×4, parte 0,5, 16
  muestras, 8 píxeles o 1e-5, recorte 10, que sesga); los del presupuesto
  (suelo de 64 muestras, la mitad en *lo que llegue antes*, subir el tiempo
  en vez de bajar muestras, 25 % de margen); y cuándo avisar del vídeo
  (dormido hasta N1) y del *denoise*.
- **N1** (los ◆ de su «no encajó»): el orden del asistente (hoy primero el
  objetivo, como lo dejó N6); qué es un *Fundido* (la cantidad es la
  opacidad final, y *aparecer* es el invertido; en el motor, cobertura
  estocástica, y los emisores bajan); el polo del arco solar (fijo, detrás
  del producto a 45°: latitud y norte); la forma del fundido a color
  (centrado en el corte, como mucho medio plano, sin fundido al final); y
  la calidad del vídeo (automática, unos 0,1 bits por píxel, sin alfa ni
  sonido).
- **H1** (pasada v0.1.16): los grises auxiliares `ink-2` e `ink-3` quedan
  por debajo de 7:1 en 36 pares. Para llegar a 7:1 en todas las superficies
  tendrían que ser `#434343` o más oscuros en claro y `#b5b5b5` o más
  claros en oscuro, lo que aplana la jerarquía de grises. Decidir: subirlos,
  limitar el texto auxiliar a `bg-0`, `bg-1` y *hover* (`#4e4e4e` /
  `#afafaf`) o aceptar 4,5:1 para el texto secundario.

- **U15** (los ◆ de su párrafo): el aspecto de la **variante compacta**
  de las flechas (hoy un par más fino, siempre visible, en los campos con
  etiqueta en línea y en el de un deslizador; la otra opción, flechas solo
  al pasar el ratón o con el foco); la **lista de lo convertido a
  deslizador** (`UI.md` §4.4: físicas, ángulos de la óptica, de los filtros,
  del suavizado, de los patrones, de texturas y etiquetas y de un foco
  propio; calidad JPEG, ruido e intensidad de la reducción de ruido;
  velocidades, gizmo e intervención en Ajustes) y lo que se quedó en campo
  (las luces del estudio, las asas, *Tamaño de la interfaz* y *del texto*);
  y el ritmo de la repetición (400 ms y luego cada 50 ms).

**1.9** (doble barra en el carrusel de LUTs de aintfilm) es de otro
repositorio; el triaje anota que Repackshot también dibuja el carrusel de
recetas del plugin, sin barra vertical.

## Orden sugerido

1. **U1** (Opus) y **E1** (Sonnet), en paralelo: la interfaz y el
   esqueleto del motor. Sin la primera no hay dónde ver nada; sin el
   segundo no hay dónde construir el trazador.
2. **E2** → **E3** (Opus): aceleración e integrador. Mientras tanto,
   **U2**, **I1** e **I3** (Sonnet): proyecto en archivo, OBJ y STL, y el
   resto de importadores con la hoja de importación. La importación es
   el tronco: va delante de todo lo que no sea el motor.
3. **E4** (Opus): el motor en el navegador. Cierra v0.1 con un render de
   verdad en el visor y en la línea de comandos.
4. **U5** (ventana de render), **I2** (STEP e IGES), **L4** (focos
   propios): lo que hace que se comporte como KeyShot en el día a día
   (U3 y U4 ya están).
4 bis. **Primera release `v0.1.0`**, petición del usuario: **U2**
   (proyecto en archivo), **X1 parte A** (ficheros y `sha256` de los
   modelos), **U6** (Ajustes y gestor de modelos), **P2** (lanzador,
   portables e instalador; el lanzador y el motor nativo pueden empezar
   en paralelo con U5) y **P1** (la release). L4 sigue después.
5. **E5** → **E6** → **L1** → **L2** → **L3**: la luz y los materiales
   hasta que las 72 recetas estén revisadas sobre el motor propio.
6. **M1**, **N2**, **D1**, **P1**: cierran v0.2.
7. **E7**, **M2**, **N1** → **N3**, **L5**, **E8**, **Q1**, **P2**,
   **X1** → **X5** (post-procesado IA, `AI-POST.md`), y **K1** →
   **K2** → **K3** (tipo de escena, habitación y cámara de interiores):
   v0.3.
8. **K4** → **K5**, **K6**, **K7**, **K8**: interiores y mobiliario, v0.4.
9. **H1** al cierre de cada versión.
