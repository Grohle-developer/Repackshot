# Roadmap — Repackshot

Qué hay que hacer, en qué orden, y **qué modelo ejecuta cada fase**. Es
autocontenido: cada fase se puede ejecutar leyendo este documento, los
que enlaza (`SPEC.md`, `ARCHITECTURE.md`, `UI.md`) y el repositorio.

---

## Contexto (leer siempre primero)

Repackshot es un renderizador de producto al estilo KeyShot, de código
disponible y gratuito para uso no comercial (PolyForm Noncommercial 1.0.0),
escrito desde cero en **sala limpia** (reglas en `../README.md`,
innegociables) y que corre en el navegador. Sus pilares: tipos de
producto, catálogo de montajes de luz por estilos con normalización de
exposición, materiales con desgaste procedural, Doctor, selección por
niveles, lenguaje de fotógrafo, guía con flechas que no tapa.

**Ficheros clave:**

- `src/core/` — modelo de datos puro y *store* (`ARCHITECTURE.md` §4)
- `src/data/` — catálogos: 16 estudios, 72 montajes, 77
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
- **A2** · Catálogos en `src/data/` con tipos, y matemáticas de
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

- **N2** · Cola, pases y lotes: el pase **alfa** (el séptimo, `RNDR.passes` bit 6,
  `rt_render_tile_alpha`, con *hash* propios y los seis de X2 sin moverse), los pases
  *Alfa*, *Profundidad*, *Normales* e *Id de pieza* como archivos junto a la imagen
  (EXR o PNG de 16 bits), el **lote cámaras × estudios** con la plantilla de nombre, el
  **ZIP propio** de la cola (método *store*, sin dependencias) y la prueba de que
  detener el segundo deja el tercero; un fallo antiguo de la cola corregido;
  3005 tests web, 1112 del motor y 46 mutantes muertos — **Sonnet**.

- **N2b** · El estudio viaja con el proyecto: cada trabajo con un estudio guardado
  guarda una copia de él en el proyecto (`render.studios`, una por id y *hash* del
  contenido, el trabajo la nombra con `studioCopy`) y renderiza en ella, también en un
  equipo cuya biblioteca no lo tiene; las imágenes de la copia van una vez en `images`;
  *Añadir a mi biblioteca* en la cola; el esquema sigue en 2 — **Opus**.

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

## A2 · Catálogos — **Sonnet** — hecha

Ver `src/data/README.md`. Las claves son estables. Los tests
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
salía como un disco de 31°, cuando el catálogo lo da en **grados**
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

## L7 · Sets y Luces: catálogo reorganizado — **Opus** — hecha

**Petición del usuario** (2026-10-17), literal:

> «Vamos a reorganizar el tema de las luces y studio. Quiero que los agrupemos por Sets / Lights. Dentro de sets, tendremos todos los que crean cosas aparte de las luces, y en lights los que solo aplican luces. Dentro de cada uno de estos habrá filtros, en los cuales podrás elegir si jewellry, dark field... Todos los que eran producto type lo meteremos como un filtro al lado de sets que sea product type. Si ya había unas luces aplicadas dejar elegir si se borran las anteriores luces, si solo se ocultan, o si simplemente se añaden. Todos los thumbnails serán del mismo tamaño que Dark field y el resto, pero quiero a la derecha del inicio de seccion un icono que permita cambiar el tamaño de los thumbnails.»

**Qué.** La sección *Luz* en dos grupos, **Sets** (lo que crea algo además de
focos) y **Luces** (lo que solo pone focos), clasificados por lo que hace cada
entrada y no por su estilo, sin cambiar claves ni orden (regla 7); filtros en
cada grupo, combinados como los de P6b, con el tipo de producto como filtro de
*Sets*; al elegir con focos en la escena, *Sustituir · Ocultar · Añadir* en una
entrada de deshacer, con *Recordar mi elección* en *Ajustes*; todas las
miniaturas del tamaño de las de los montajes y un botón en la cabecera que
cambia el tamaño.

**Hecho.** *Clasificación* (`core/setup-groups.ts`): una entrada es *Set* si
trae decoración (`hasDecoration` de `core/sets.ts`: fondo, suelo, charco o
tarjetas), y *Luces* si no. Leyendo `sets.ts` y `rig.ts` salen **17 Sets y 78
Luces** con un tipo de producto que es un set, y 16 y 79 con *Mobiliario
exterior*: los 16 sets de L6, más `PRESET` (*El del tipo de producto*), que con
15 de los 16 tipos viste la escena con el set del tipo y con *Mobiliario
exterior* solo pone su sol; en *Luces*, los 71 montajes de antes y las 7 recetas
de *Interior*. Dos sorpresas: `PRESET` cambia de grupo según el tipo en vigor,
y las recetas de *Interior* (y `SUN`, `GOLDEN_HOUR`, `DAWN`) cambian el
entorno (cielo, exposición, intensidad) sin crear nada; se cuentan como *Luces*
(◆ 1). `tests/light-catalogue.test.ts` fija las cuentas con los 16 tipos y
aplica cada una de las 95 entradas para comprobar que la que es *Set* deja
decoración y la de *Luces* no.

*Filtros*: *Sets* por **Tipo de producto** (los 16; deja el set que es el rig
propio de ese tipo, `StudioPreset.set`, y `PRESET` si es el tipo en vigor) y por
**Sujeto** (el `hero` del set: *Frasco, Caja, Anillo, Cromado, Zapato,
Esferas*); *Luces* por **Estilo** (los nueve de siempre salvo *Sets*, y
*Míos*). Se combinan (Y), con la cuenta (*7 de 17 sets*), un aviso corto si no
queda nada, y la entrada en vigor que dejan fuera la primera, atenuada y
marcada *Fuera de los filtros*, como la receta de un plugin. Las filas son el
componente de P6b, sacado a `ui/components/filter-chips.ts` (el panel de
plugins lo usa también, con el mismo DOM). Grupo, filtros, estilo y tamaño se
guardan en el `layout` de los ajustes (por persona, como el estilo de antes);
un documento de antes abre *Sets* si su estilo era *Sets* o *Todos*, y
`lightStyle: 'SETS'` (una URL de antes) es el grupo *Sets*.

*Los focos que hay* (`core/previous-lights.ts`): `studio/setSetup` y
`studio/applySetup` ganan `previous` (`REPLACE`, `HIDE`, `ADD`) y `keptNames`.
*Sustituir* es lo de siempre; *Ocultar* y *Añadir* conservan los focos que no
son decoración detrás de los nuevos, con su `id`, `own` y un nombre de origen
(«Principal · Rembrandt»); *Ocultar* con `enabled: false`. **Los focos ya
tenían ese interruptor** (`LightInstance.enabled`, el de la lista *Luces*), así
que el formato del proyecto no cambia y no hace falta migración: los proyectos
de `tests/fixtures/project-v1.json` y `-v2.json` se abren con sus focos
idénticos, y uno con focos ocultos va y vuelve igual. Un set que entra
sustituye la decoración del anterior siempre; un montaje de *Luces* con
*Ocultar* o *Añadir* deja la decoración, el charco y el aspecto del set (◆ 4).
Una entrada de deshacer con la respuesta en su nombre. La interfaz pregunta
(en línea, sobre la rejilla; también desde la paleta, que enseña la pregunta)
salvo que `light.previous` (*Ajustes ▸ Preferencias ▸ Luces*: *Preguntar ·
Sustituir · Ocultar · Añadir*) recuerde una respuesta; *Recordar mi elección*
la escribe. Sin focos, o eligiendo otra vez el montaje en vigor, no pregunta.

*Miniaturas*: un solo tamaño para todas, el de los montajes (*Campo oscuro*:
tres columnas, 4:3; los sets dejan de ir en dos columnas cuadradas), y el botón
de la derecha de la cabecera de *Luz* da la vuelta *pequeñas* (cuatro columnas,
solo la imagen) → *medianas* → *grandes* (dos). Las etiquetas ya no se cortan
a dos líneas: se parten en las que hagan falta.

*Tests*: `tests/light-catalogue.test.ts` (19: la clasificación y sus cuentas,
los filtros y su combinación, Sustituir/Ocultar/Añadir con su deshacer y los
ocultos que se vuelven a encender, set sobre set y luces sobre set, un montaje
propio, la pregunta y *Recordar*, el ajuste y el `layout`, la persistencia, los
proyectos de antes) y `tests/light-panel-browser.test.ts` (4: en `en` y `es`, a
1600 × 1000 y 1280 × 800, nada recortado ni fuera de la columna, una sola
medida de miniatura por grupo y tamaño, el botón cambia el tamaño y se
recuerda tras recargar, la pregunta). `data.test.ts`, `sets.test.ts` y
`rig.test.ts`, sin tocar. Comprobación de navegador y capturas:
`tools/light-catalogue-check.mjs`.

**No encajó con el plan:**
- No hizo falta un estado nuevo para *Ocultar*: `enabled` ya estaba, y con él
  no hay cambio de formato ni migración.
- Todo proyecto empieza con los focos del tipo de producto, así que con
  *Preguntar* (el ajuste de partida) la pregunta sale casi siempre que se
  elige un montaje; *Recordar mi elección* la quita (◆ 5). Por eso
  `tests/library.test.ts` responde ahora *Sustituir* en dos sitios donde antes
  el montaje entraba directo; nada más cambia en él.
- La pregunta sale encima de la rejilla, no junto a la miniatura pulsada, y la
  sección se desplaza hasta ella.
- La paleta enseña la pregunta con sus tres respuestas, sin *Recordar*.
- La fila *Tipo de producto* son 16 *chips*: a 340 px ocupan seis líneas.
- Las miniaturas de los sets son cuadradas y se recortan a 4:3 como las demás.
- *En el set* sigue enseñando las piezas de un set tras *Ocultar* o *Añadir*
  un montaje de *Luces*, sin *Usar la cámara del set* (ya no es el set en
  vigor).
- `tools/sets-check.mjs`, `tools/scene-type-check.mjs` y
  `tools/viewport-stress.mjs` siguen la sección nueva (contestan *Sustituir*);
  `sets-catalogue.png` y `scene-type-interior.png` se regrabaron;
  `library-setups.png` no tiene herramienta y queda marcada como superada.
- La variante `large` de las miniaturas (L6) se quitó: nadie la usa.

**◆ Para Fable** (regla 11; también en *Decisiones de criterio*):
1. Que los montajes que cambian el entorno sin crear nada (las 7 recetas de
   *Interior*, los tres de sol) sean *Luces*, y que `PRESET` cambie de grupo con
   el tipo de producto.
2. El tipo de producto solo filtra *Sets*: ningún montaje de *Luces* está
   ligado a un tipo (salvo `PRESET` con *Mobiliario exterior*). Y el filtro
   usa solo `StudioPreset.set` (casi todos los tipos dejan un set); una tabla
   de qué sets sirven a qué tipo es una decisión fotográfica, sin hacer.
3. El segundo filtro de *Sets*, *Sujeto* (el `hero`), que no pidió nadie.
4. Lo que pasa con la geometría de un set: un set que entra sustituye la del
   anterior con cualquier respuesta; *Luces* con *Ocultar* o *Añadir* la deja,
   con su charco encendido y su exposición.
5. Preguntar por defecto, también con los focos sin tocar del tipo de
   producto (lo literal de la petición), frente a preguntar solo si están
   modificados o hay focos propios.
6. Los tres tamaños (cuatro, tres y dos columnas; el pequeño sin etiqueta) y
   un solo tamaño para los dos grupos.

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
**Decisión para Fable** (regla 11/12, el contrato es de M3a; decidida en *Decisiones de criterio* y hecha en C1): que
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

## M3c · Nodos Madera y Tela — **Opus** — hecha

**Qué** (decisión 1.6 de *Decisiones de criterio*; el usuario, `TODO.md`
§1.6: «todos los materiales han de ser funcionales respecto a los nodos»).
Nodos *Madera* y *Tela* en el editor de material con las recetas de E6
(la madera: anillos, figura, poros, fibras y nudos; la tela: tejido, hilos
por cm, relieve, torsión), con los parámetros de las familias en sus
unidades; el motor los ejecuta en el intérprete de M3b con el código de E6;
el ejemplo de madera de los grafos se hace con el nodo *Madera* y se ve como
la familia (`m3b-wood.png`).

**Hecho.**

- **Motor** (`rt_core::program`, ARCHITECTURE §5.2 quater y undecies). Ocho
  códigos nuevos, estables: `WOOD` 130, `WOODR` 131, `WOODH` 132, `WOODN` 133
  y `CLOTH`/`CLOTHR`/`CLOTHH`/`CLOTHN` 140–143. Cada uno lee un punto (`a`,
  espacio de la pieza, mm), una normal (`b`) y las 25 constantes de su receta
  en `k`, que son el `PATN` tal cual (dos colores, escala, 16 parámetros,
  variante y semilla); `WOODR`/`CLOTHR` leen además la rugosidad (`c`) y dan
  `(c·rug) + suma`, lo que `Tint::apply` hace antes de su `clamp`. **No hay
  otra madera**: `pattern.rs` se partió en `Placement` (dónde está el dibujo
  en una pieza: el marco, los mm por unidad y los nudos), `place` (lo que
  `PatternSetup::new` hacía por instancia: el marco de la caja de la malla, la
  escala de la instancia, los nudos con su prueba de la superficie) y
  `sample_at` (lo que hacía `Placed::sample`, que ahora la llama), y las
  instrucciones corren `sample_at` con la colocación que da el anfitrión
  (`Host::placement`, nueva y con valor por defecto: sin pieza,
  `Placement::IDENTITY`, el espacio del propio punto en mm sin nudos).
  `ProgramSetup` coloca cada receta de un programa en cada instancia al
  preparar la escena (`place`, la de la familia), y las salidas de un nodo
  comparten una muestra (la última, por receta, punto y normal: sin
  asignar). La rugosidad se estira por la veta o el hilo: la primera muestra
  de dibujo del programa en el punto dice su tangente (`Host::grain`) y
  `Resolved::frame` da el marco del integrador como `Tint::frame` el de un
  `PATN`. Bit 5 de las capacidades, `FEATURE_PATTERN_NODES` (32), en
  `rt_features` y `/api/info`.
- **TypeScript.** `core/patterns.ts` porta paso a paso en `f32` el ruido de
  E6 (la permutación de Fisher–Yates con el PCG32 del motor, en `BigInt`),
  la madera, el flujo y la testa de los nudos, la tela y `sample_at`;
  `core/pattern-recipe.ts` saca la receta de los parámetros (la misma función
  para el `PATN` de `io/rsb.ts` y para las constantes del compilador:
  `ringDensity` por 100 mm por `woodScale`, `threadCount` por cm, mm); el
  compilador (`core/material-program.ts`) y el intérprete
  (`core/material-interp.ts`, con su colocación por receta `PlacementOf`)
  tienen los ocho códigos. El catálogo (`data/material-nodes.ts`) tiene
  `WOOD` y `FABRIC` (categoría *Textura*, claves nuevas): entradas *Punto*
  (sin conexión, `POSITION`: el punto en mm), *Normal* y *Rugosidad*;
  salidas *Color*, *Rugosidad*, *Anisotropía*, *Normal*, *Altura (mm)* y, la
  tela, *Pelusa*; parámetros con las claves y rangos de la familia (más
  `poreSize`, `poreBand`, `woodFigure`, la semilla y `yarnTwist`, que la
  familia guarda sin mando). La normal solo se conecta a una instrucción si
  la receta tiene relieve. Cadenas `es`/`en` en el catálogo y
  `ge.implicit.POSITION` en `ui/strings.ts`.
- ***Rápido*.** Los nodos de dibujo leen coordenadas 3D, así que el horneado
  es el corte por el frente de la pieza de M3a; `patternPlacements`
  (`core/material-preview.ts`) coloca cada receta en la caja de las piezas del
  material (el marco de `wood_frame` en `f32`, los nudos de `core/knots.ts`
  con la caja como superficie) y las esferas de los nodos y la media del
  grafo, en la de la bola de 100 mm. En *Rápido* un material de nodos de
  madera enseña sus anillos (la familia sigue con su color medio y los
  nudos).
- **Conversión** (`core/material-graph.ts`). *Simple → Nodos* de una madera
  o una tela da su nodo con los parámetros de la familia (los colores RGBA
  pasan a RGB, la semilla es la del material, la rugosidad su entrada)
  conectado al color, la rugosidad, la anisotropía y la normal de la salida
  (`minimalGraph`, `PATTERN_LINKS`). *Nodos → Simple* es inmediato si el
  grafo es ese (`patternGraphOf`): sin tocar, vuelve el material tal cual;
  con el nodo editado, la familia con los valores del nodo (y la rugosidad y
  el barniz); con otra semilla, otro nodo o una conexión de menos, pregunta.
- **Página.** `programsView` (`render/engine.ts`) pone `patternNodes: false`
  en la vista de un motor con programas y sin el bit 5, y `projectScene`
  escribe entonces un material de nodos con dibujos como la media de sus
  salidas (un motor así rechazaría el programa: código desconocido); el
  *pool*, el lanzador, el visor y *Render* lo usan.
- **Ejemplo.** `WOOD_TWO_NOISES` (la clave se queda) es el roble del
  catálogo con el nodo *Madera* conectado a la salida, *Roble (nodo Madera)*:
  el grafo que da *Simple → Nodos* del roble.

**Fijados.** Ninguno anterior se mueve salvo el del ejemplo de madera de
M3a, que tenía que moverse (era el grafo de dos ruidos que no se parecía a
la familia: decisión 1.6): `WOOD_TWO_NOISES` `043e3493` → **`6600a83f`** en
`EXAMPLE_PINS` (`tests/material-program.test.ts`) y en
`the_ten_examples_are_the_m3a_pins` (`program/tests.rs`); su caso de la
prueba cruzada, con él. Nuevos: `PINNED_M3C_WOOD_4SPP` = **`0x5ed1bf32`**,
la escena de dibujos de E6 con el roble y el nogal pintados por nodos
*Madera* (`example::m3c_wood_scene`, `rt --write-m3c-wood-example`): **el
mismo *hash* que la de la familia** (`PINNED_E6_PATTERNS_4SPP`; el test lo
exige), y `PINNED_M3C_CLOTH_4SPP` = **`0x1cb5860d`**, la de tela con nodos
*Tela* (`rt --write-m3c-cloth-example`), distinta de la de E6
(`0x53e6a855`) solo por el bisel (abajo). Los dos en escalar, SSE2 y AVX2,
con 1, 4 y 16 hilos en `rt` y en el lanzador, y en `engine.yml` (solos y con
los pases) contra el `rt.wasm` real.

**Tests** (cada uno falla sin lo que prueba). En `rt-core`,
`program/pattern_tests.rs` (6): en 400 rayos desde fuera a cada pieza de las
escenas de E6, el material de la familia y el del programa dan los mismos
bits de color, rugosidad, anisotropía, normal de sombreado, tangente del
marco y albedo, para la madera (con sus tres nudos, biselada) y la tela (sin
bisel), y para las otras tres figuras y los otros cinco tejidos; los nudos
del programa son los de la familia; sin pieza, cada salida es `sample_at` en
el espacio del punto; una receta sin escala no pinta; las constantes son el
`PATN` y el lector las comprueba. Los dos fijados nuevos y sus hilos en
`rt-cli` y `rt-app`. La **prueba cruzada** (`tests/material-program-cross.test.ts`,
`tests/fixtures/material-programs.json`, `program/tests.rs`) suma 18 casos:
las cuatro instrucciones de cada madera del catálogo (roble, pino, nogal,
arce, ébano, bambú, DM) en 300 puntos y a un quinto, cada tejido (algodón,
sarga, vaquero, raso, lona, fieltro, punto y el carbono sin torsión) a
tres escalas, un roble con nudos de 26 mm colocados en torno a los puntos
(el caso lleva su colocación en el fichero, `placement`: marco y nudos en
`f32`) en 1000 puntos y una receta que no pinta: **los mismos bits** en
todos. `tests/pattern-nodes.test.ts` (10): la permutación, los parámetros y
salidas de los nodos, las constantes del compilador iguales al `PATN` de
cada madera y tela del catálogo, la normal solo con relieve, la receta común
con `patternToRsb`, la ida y vuelta de *Simple ↔ Nodos* (sin tocar, editada,
otra semilla, una conexión de menos), el interruptor del motor, la
colocación de *Rápido* (marco y nudos) y el horneado con ella, y el ejemplo
con anillos en *Rápido* con la media del roble. `material-graph`,
`material-nodes-ui` y `material-program`, al día. **Navegador**
(`tests/programs-full-browser.test.ts`, «the wood graph sphere renders as
the Wood family sphere»): una bola de 100 mm en el mundo blanco, en
*Completo* con el `rt.wasm` real por el escritor de la página, con el roble
de la familia y con el ejemplo (y con el roble pasado a nodos): **la misma
imagen byte a byte** en los dos casos (correlación 1, 100 % de los 928
píxeles asentados, tono 172 155 132 en las tres, distancia 0); el control
(el ejemplo girado un cuarto de vuelta) cae a 0,67. El umbral es el de la
comparación por regiones (correlación > 0,75, acuerdo > 0,85, tono a menos
de 40, el control 0,2 por debajo). El
ejemplo de madera de la comparación por regiones de M3b (*Rápido* contra
*Completo* en la placa) usa ahora de control la placa dada la vuelta (un
desplazamiento de la malla mueve también su marco) y se compara por la
correlación, como los copos: los anillos de 3 mm son cinco píxeles en la
placa y casi no quedan píxeles asentados (el control coincide en ellos un
98 %). *Rápido* y *Completo*: correlación **0,995** (el control, 0,08), tono
192 168 137 / 171 153 129 (distancia 21, dentro de la del material plano,
25). Hasta M3c el ejemplo se comparaba por el acuerdo (100 % de 602 píxeles,
correlación 0,991).
**Mutaciones** (cada una puesta y quitada a mano, con su test en rojo): en
el motor, la colocación del anfitrión ignorada (las instrucciones en el
espacio del punto), la tangente de la veta sin decir, el integrador sin el
marco del programa y la rugosidad de los nudos sin sumar: las cuatro en rojo
(la tercera solo la cogen los fijados, que miran la imagen). En TypeScript,
nueve: la colocación del intérprete, la suma de rugosidad, la normal sin
doblar, el flujo de los nudos, la altura de la tela sin mezclar (las cinco,
la prueba cruzada), el interruptor del motor, la colocación del horneado de
*Rápido* (sobrevivió la primera vez: de ahí el test del horneado), la
semilla en la vuelta a *Simple* y la normal conectada sin relieve: las
nueve en rojo. Y dos fallos de verdad del primer intento, que cogieron los
tests: un literal `0,225` en `f64` en vez de `f32` en el perfil de los
anillos (la prueba cruzada puso en rojo las cinco maderas con anillos; al
repasar los literales salieron también los pesos de la luminancia), y los
colores RGBA de la familia que el nodo, RGB, no aceptaba (el nodo salía con
los colores por defecto: lo cogió `material-graph`, la media de cada
material del catálogo).

**Coste** (`rt` nativo, 1 hilo, 320 × 240, 16 muestras, mediana de tres
rondas alternadas): la escena de dibujos de E6 con la familia 2,41 s y con
nodos *Madera* 2,36 s (la misma imagen: el ruido de la máquina); la de tela
1,99 s y con nodos *Tela* 2,12 s (+6 %: el contexto del programa y la vuelta
de su normal al mundo).

**Puertas.** `npm run engine:build` y `npm run qa` en verde (3179 tests:
3153 pasan, 26 se saltan; en una pasada con otra a la vez, `ai-passes` y
`pathtracer` pasaron del tiempo y pasan con `--maxWorkers=2`, y los dos
casos de la prueba cruzada llevan ahora 120 s de límite: sus casos de dibujo
son unos miles de puntos de E6 en `f32`). En `engine/`: `cargo fmt --check`,
`clippy --workspace --all-targets -D warnings`, `cargo test --workspace
--release` (1163 pasan, 5 ignorados), la compilación wasm32 de `rt-wasm` y
`rt-post-wasm`, los bloques de paridad de `engine.yml` contra el
`rt_wasm.wasm` real (45 imágenes, con las cuatro de M3c: `0x5ed1bf32` y
`0x1cb5860d`, solas y con los pases) y los tests del código de la página con
el `rt.wasm` real (131 pasan). `tests/programs-full-browser.test.ts` (12) y
`tools/material-nodes-check.mjs --only wood,chrome` en Chromium.

**Capturas** (en *Sin publicar* de `GALERIA.md`): `m3b-wood.png` regrabada
(ahora la hace `tests/m3c-wood-sheet.test.ts` con
`REPACK_WRITE_CAPTURES=1`): las dos cajas de roble en *Completo*, la de la
familia y la del ejemplo de nodos, la misma madera; y la nueva
`material-nodes-wood.png`: el editor con el ejemplo del roble y el nodo
*Madera* seleccionado (`tools/material-nodes-check.mjs --only wood`, que
también comprueba que el frasco se vuelve de madera en *Rápido*).

No encajó con el plan (lo marcado ◆ está decidido en *Decisiones de criterio*):

1. ◆ **La pelusa no llega a ningún sitio.** La *Tela* da su *Pelusa* (el
   `fuzz` del material, un número) como pide el encargo, pero la salida de
   material no tiene entrada de brillo de pelusa y el motor no la pinta
   (S8/M5); *Rápido* sí la pinta en la familia (el *sheen* de three.js) y no
   en un material de nodos. Añadirla a la salida es una salida nueva del
   contrato del programa (la 16).
2. ◆ **La tela bajo un bisel.** El nodo elige su proyección de caja por su
   entrada *Normal* (la de sombreado, biselada); la familia, por la normal
   interpolada sin bisel. Dentro del radio de bisel de una arista la
   proyección puede cambiar antes; fuera, los mismos bits (test). Por eso la
   escena de tela con nodos tiene su propio fijado. La alternativa es que el
   anfitrión dé al nodo la normal interpolada cuando su entrada no está
   conectada.
3. ◆ **La madera de la familia en *Rápido*** sigue siendo su color medio con
   los nudos, mientras que la misma madera en nodos enseña sus anillos en
   *Rápido* (el corte por el frente de la pieza). Que la familia se hornee
   por el mismo camino respondería a la otra mitad del 1.6 («la madera en
   escena ha de verse como en las esferas») también en *Rápido*.
4. **Vista desde dentro**: el programa recibe la normal hacia fuera de la
   pieza y la familia la del lado del rayo; una pieza abierta vista por
   detrás dobla su relieve con la otra cara (los tests miran desde fuera).
5. **Sin relieve a la hora de correr**: el compilador no conecta la normal si
   la receta no tiene relieve, pero si se piden nudos y no cabe ninguno la
   normal de salida es una copia de la de entrada y vuelve al mundo con un
   redondeo (la familia no la toca): una diferencia de un bit en la normal.
6. **Los nudos de *Rápido*** se colocan en la caja de las piezas con la caja
   como superficie (el motor prueba la malla) y para la unión de las piezas
   del material (el motor, por pieza): en una pieza redonda pueden no ser los
   mismos.
7. **La media** de un material de nodos de madera (la que ve un motor sin
   programas y las miniaturas) es la del dibujo en los 64 puntos de la esfera,
   a 0,01–0,02 de la de la familia (`0,6 claro + 0,4 oscuro`).
8. **La semilla** del nodo es una copia de la del material al pasar a
   *Nodos*; cambiar después el desgaste no mueve los nudos del nodo.
9. **El bit 5** lo toma esta fase; otra fase en paralelo que añada una
   capacidad tiene que tomar el 6.
10. El ejemplo cambia de nombre (*Madera con dos ruidos* → *Roble (nodo
    Madera)*), no de clave.

## M3d · La madera de la familia en *Rápido* por el camino del nodo *Madera* — hecha

**Qué** (M3c ◆3, decidido en *Decisiones de criterio*). Una madera de la
familia *Madera*, en modo *Simple*, se ve en *Rápido* como la misma madera
con el nodo *Madera*: la vista previa la hornea por el mismo camino que el
nodo, para que la madera en escena se vea como en las esferas también en
*Rápido* (la otra mitad del 1.6). En *Completo* y en los renders no cambia
nada: M3c ya dejó la familia y el nodo byte a byte iguales.

**Hecho.**

- **Núcleo** (`core/material-graph.ts`). `familyBakeGraph(inst)`: el grafo
  que da *Simple → Nodos* de una madera de la familia (`minimalGraph`: el
  nodo *Madera* con los parámetros y la semilla de la familia, su color,
  rugosidad, anisotropía y normal en la salida), guardado por instancia (el
  *store* cambia la instancia cuando cambia el material, así el programa y
  el horneado se hacen una vez); `null` para un material con grafo propio y
  para las demás familias. `FAST_BAKED_FAMILIES` = `['WOOD']`: la tela no
  (◆2). El estado del proyecto no cambia: el grafo solo lo ve la vista
  previa; el escritor de la página, las miniaturas y el motor siguen con la
  familia.
- ***Rápido*** (`render/preview.ts`). `bakeGraph(inst)`: el grafo propio, o
  con *workers* de horneado el de `familyBakeGraph`; `syncMaterials` da a
  `GraphBakes` (`render/graph-preview.ts`, M3a) la instancia con ese grafo,
  y el horneado es el del nodo: la misma `planBake` (el corte por el frente
  de la pieza, en la caja de las piezas del material), la misma colocación
  (`patternPlacements`: el marco de `wood_frame` y los nudos de
  `core/knots.ts` con la caja como superficie), las dos pasadas (128² y
  512²) y las mismas ranuras. Una madera horneada ya no lleva la capa de
  nudos de E6 por pieza (`render/knots.ts`): sus nudos están en sus mapas;
  sin eso salían dos veces. Sin *workers* (un navegador sin `Worker`) la
  familia sigue como en E6, su color medio con los nudos, que es mejor que
  las medias de un grafo sin hornear; si los *workers* llegan después de la
  primera sincronización, los materiales se vuelven a poner.
  `GraphBakes.hasWorkers()` lo dice.
- **Línea de tiempo** (`render/fade-preview.ts`). Un clip de material
  (*Fundido*, *Color de material*, N1) vuelve a poner el material desde su
  instancia en cada fotograma: ahora lo hace la vista previa
  (`resetMaterial`), y una madera horneada vuelve a su horneado (con la
  opacidad del fundido encima) en vez de a su color medio, que es lo que
  hacía `applyMaterial`. Un color no llega a una madera (no tiene color
  base): como antes.
- **Inspector.** Los mandos de la madera (densidad de anillos, escala,
  contraste, variación, ruidos, poros) pasan a `preview: true` y pierden su
  punto «·» y la ayuda *lo pintan el modo Completo y los renders; la vista
  Rápida muestra el color medio*; el campo `engine` se les quita (queda
  para el tejido de la tela). La nota de la familia (`material.flatNote`,
  `es`/`en`) dice ahora que *Rápido* enseña los anillos, poros y nudos como
  los hornea el nodo *Madera*, un corte por el frente de las piezas
  proyectado en cada cara, y que *Completo* y los renders pintan la madera
  como corre por la pieza. La de la tela, igual.
- **Motor**: no se toca `engine/`; ningún fijado se mueve.

**Tests** (cada uno falla sin lo que prueba).
`tests/m3d-family-fast.test.ts` (5, sin navegador): el grafo de cada una
de las 13 maderas del catálogo es el de `minimalGraph`, con su nodo
*Madera*, uno por instancia (una instancia editada tiene el suyo, con el
valor nuevo); ninguno para el algodón, el vaquero, el blanco de estudio, el
vidrio ni una madera con grafo propio; para el roble y el pino, el programa
(código y constantes), el plan y los mapas del horneado son **iguales** a
los del material pasado a nodos con `graph/enable` (`toEqual` del
resultado entero), con mapas de color y de normal; y `GraphBakes` lo dibuja
con su mapa de color horneado (blanco debajo), no con su color medio.
**Navegador** (`tests/wood-fast-browser.test.ts`, 3 y la captura; Chromium
sin cabeza con SwiftShader y los *workers* de horneado de la aplicación,
sin `rt.wasm`): la bola de 100 mm de M3c (`woodSphereScene`, ahora con la
especie y un fundido opcionales; la página `programs-page.ts` la dibuja con
`WOOD_SPHERE:<tipo>:<especie>[:FADED]` y con o sin *workers*) en el roble y
en el pino nudoso, la familia y la familia pasada a nodos: **los mismos
píxeles, 0 de 120 000 canales distintos** en los dos; el detalle fino (lo
que se aparta cada píxel de la media de sus 7 × 7) es 5,61 en el roble y
5,46 en el pino, y el control, la familia sin *workers* (lo que se veía
antes de M3d), 0,20 y 0,58, con 19 550 y 19 720 canales distintos de los
del nodo. Bajo un fundido de la línea de tiempo (el pino al 80 % y luego al
75 % una vez llegados los horneados), sus anillos siguen (detalle 4,09).
**Mutaciones** (puestas y quitadas a mano, cada una en rojo): la familia sin
hornear en `bakeGraph` (el roble y el pino: 19 550 y 19 720 canales
distintos); la capa de nudos de E6 encima del horneado (el pino: 21 025
canales distintos; el roble, sin nudos, sigue en verde, como debe);
`FAST_BAKED_FAMILIES` vacío (4 de los 5 tests sin navegador); y
`resetMaterial` con el `applyMaterial` de antes (el fundido: detalle 0,07).
Esta última sobrevivió a la primera versión del test, que usaba un clip de
color: a una madera no le llega el color, la clave del fundido no cambiaba y
el horneado, que llega después, tapaba el error; el test usa ahora un
fundido y mueve la línea de tiempo cuando los horneados ya han llegado.

**Puertas.** `npm run engine:build` y `npm run qa` en verde (3249 tests: 3216 pasan y 33 se saltan, entre ellos el de la captura de M3d, que solo corre con `REPACK_WRITE_CAPTURES=1`; con Chromium, los tres de `wood-fast-browser` corren y pasan, también solos).
`engine/` no se toca.

**Capturas** (en *Sin publicar* de `GALERIA.md`): la nueva
`m3d-wood-fast.png`, que hace `tests/wood-fast-browser.test.ts` con
`REPACK_WRITE_CAPTURES=1` y el `rt.wasm`: el roble (arriba) y el pino
nudoso (abajo) de la familia en la bola, en *Rápido* antes de M3d (sin
*workers*: color medio y nudos de E6), en *Rápido* ahora (el horneado del
nodo *Madera*) y en *Completo*. Ninguna captura anterior enseña una madera
de la familia en *Rápido* (las de madera son de *Completo* o del editor de
nodos), así que ninguna se regraba.

No encajó con el plan (lo marcado ◆ está decidido en *Decisiones de criterio*: los dos van a **M3e**):

1. ◆ **Los nudos en *Rápido* cambian de sitio.** Antes los ponía la capa de
   E6 por pieza, en 3D y con la prueba de la malla, donde los pone
   *Completo*; ahora son los del horneado del nodo, colocados en la caja de
   las piezas con la caja como superficie (M3c, «No encajó» 6) y vistos en
   el corte por el plano y = 0 de la pieza, proyectado en las caras. En una
   cara frontal plana (la placa, una caja) coinciden; en la bola de 100 mm
   del pino, *Completo* tiene tres nudos pequeños (arriba a la izquierda,
   abajo a la derecha, abajo) y el horneado dos grandes a los lados
   (`m3d-wood-fast.png`, fila de abajo). Probé el corte por el frente de la
   caja (y = mín.) en vez de y = 0: los nudos siguen en otro sitio (es la
   colocación), y no lo dejo. Opciones: (a) como está, la familia igual que
   el nodo; (b) la capa de E6 encima del horneado, para la familia y para el
   nodo, con el horneado sin nudos: los nudos donde los pone *Completo* y
   los anillos del horneado, y la familia sigue igual que el nodo; (c) la
   lista de nudos del horneado sacada de `partKnots` (la prueba de la malla)
   cuando el material está en una sola pieza, con el corte de siempre.
2. ◆ **La tela no.** Es el mismo camino y en el código cuesta una entrada en
   `FAST_BAKED_FAMILIES`, pero se ve peor: (i) el horneado da un material
   *Simple* sin *sheen*, y la tela perdería en *Rápido* la pelusa que hoy
   pinta (es el ◆1 de M3c, del lado de la familia); (ii) en 512² sobre una
   pieza de 120 mm el téxel es de 0,23 mm y el hilo mide `10 / hilos por
   cm` mm: el algodón tiene 1,07 téxeles por hilo, la sarga 1,19, el
   terciopelo 1,42, el vaquero 1,78, el raso 0,43 y la microfibra 0,36
   (seis de las doce telas, muaré o ruido); el lino 2,4, el fieltro 2,1, la
   lona 3,0, la malla 5,3, el carbono 8,5 y el punto 10,7 sí se verían.
   Opciones: (a) como está, el color medio y la pelusa; (b) hornear la tela
   solo cuando sus hilos tengan al menos 2–3 téxeles, con el *sheen* de la
   familia encima; (c) hornearla siempre.
3. **Un fundido de material sobre un material de nodos** no se aplica en
   *Rápido* (`fade-preview.ts` se salta los materiales con grafo desde N1);
   sobre la familia horneada sí. Bajo un fundido de material, la familia y
   el nodo se ven distintos en *Rápido*; fuera del plan, no lo toco.
4. **Las piezas grandes**: el horneado es de 512² sobre la caja de las
   piezas, así que los anillos del roble (3 mm) bajan de tres téxeles en una
   pieza de más de unos 500 mm. Le pasa igual al nodo desde M3c.
5. **Mientras llega el horneado**, la familia enseña las medias del grafo
   (`flattenGraph`, a 0,01–0,02 del color medio de la familia: M3c, «No
   encajó» 7) y no sus nudos, durante la primera pasada.
6. **El corte de una sección** (Q1) sigue tapando la madera de la familia
   con su color medio, y la de nodos con el blanco de un material sin
   parámetros: las tapas no se hornean.

## M3e · Los nudos de *Rápido* donde los pone *Completo* y la tela horneada cuando sus hilos se leen — hecha

**Qué** (M3d ◆1 y ◆2, decididos en *Decisiones de criterio*, la opción
(b) de cada uno). ◆1: una madera horneada en *Rápido* (la de la familia,
M3d, y un material de nodos con el nodo *Madera*) se hornea sin nudos y la
capa de nudos de E6, la de cada pieza con la prueba de su malla, la que
coincide con *Completo*, los pinta encima; la familia y el nodo siguen
dando los mismos píxeles. ◆2: la tela de la familia se hornea por el nodo
*Tela* solo cuando un hilo ocupa al menos 2,5 téxeles del horneado de 512²
en sus piezas, con su pelusa (*sheen*) encima; por debajo, como hasta ahora.

**Hecho.**

- **Los nudos fuera del horneado** (`core/material-preview.ts`).
  `programKnots(p)`: la primera instrucción `WOOD` del programa (el color de
  un nodo *Madera*) cuya receta pide nudos, con el índice de sus constantes
  y sus nudos tal como los lee el motor (los `f32` de la receta).
  `BakePlan.knotless`, nuevo y opcional: esa receta se coloca sin nudos
  (`patternPlacements(p, box, knotless)`, y `bakeRows` se lo pasa).
  `GraphBakes.apply` (`render/graph-preview.ts`) lo pone en el plan de
  todo material que hornea *Rápido* en la escena; las esferas del editor,
  la media del grafo y las notas de *Rápido* no lo usan y no cambian.
- **Los nudos encima** (`render/preview.ts`). `partKnotsOf`: los nudos de
  cada pieza son los de `partKnots` (`core/knots.ts`, que ahora acepta la
  petición: la del nodo, `graphKnotSpec`, o la de la familia,
  `knotSpecOf`) para todo material que se hornea, sea de la familia o de
  nodos, y la capa de E6 (`render/knots.ts`) los oscurece sobre el
  horneado. Como la familia horneada y su conversión tienen el mismo
  programa, tienen los mismos nudos. Cuando llega un horneado, la vista
  previa vuelve a asignar los materiales (la copia con nudos de cada pieza
  se hace de nuevo del material ya horneado), y la copia se recompila cuando
  su material de base se recompila (`base.version` en su clave): sin eso, un
  fundido de material dejaba la copia opaca (el `OPAQUE` de three.js), un
  fallo de E6 que sin *workers* ya estaba y que M3e habría extendido a toda
  madera con nudos.
- **La tela** (`core/material-preview.ts`). `FAST_BAKED_FAMILIES` =
  `['WOOD', 'FABRIC']` (`core/material-graph.ts`; `familyBakeGraph` da
  también el grafo del nodo *Tela*); `fabricThreadTexels(s, inst)`: la
  separación de los hilos (`10 / threadCount` mm, la de la receta) entre el
  téxel del plan con que se hornearía (`bakeTexelMm`: el lado del corte
  por el frente de la caja de las piezas entre 512), en caché por
  instancia, escena y tamaño; `fastFamilyGraph(s, inst)`: el grafo de la
  familia para la madera, y para la tela solo con
  `FABRIC_MIN_THREAD_TEXELS` = 2,5 o más. La vista previa lo usa en lugar
  de `familyBakeGraph` y, cuando la tela cambia de lado al cambiar sus
  piezas, la vuelve a poner. Al horneado, un material *Simple*, le pone
  encima la pelusa de la familia: `applyFuzz` (`render/materials.ts`, la de
  siempre sacada de `applyMaterial`) por el `finish` nuevo de
  `GraphBakes.apply`, que corre tras cada dibujo del material (las medias
  mientras llega y cada pasada).
- **Inspector.** La nota de la familia (`material.flatNote`) dice que los
  nudos van en cada pieza donde los pone *Completo* y que la tela se teje
  en *Rápido* cuando un hilo ocupa 2,5 téxeles de su horneado, con la
  pelusa encima; la ayuda del punto «·» de los mandos del tejido
  (`material.fullOnly`, solo la usan ellos) dice lo mismo. Las dos en `es`
  y `en`.
- **Motor**: no se toca `engine/`; ningún fijado se mueve. *Completo* y
  los renders no cambian (el escritor de la página no se toca).

**Tests** (cada uno falla sin lo que prueba).
`tests/m3e-fast-knots-fabric.test.ts` (6, sin navegador): los nudos del
pino de la familia y del convertido son los mismos (`toEqual`), los de la
familia por la receta en `f32` (a 10⁻⁶) y colocados en la pieza a menos de
una micra de los de la familia; el roble no tiene; el mapa de color del
pino horneado con `knotless` es **igual** al del pino sin nudos pedidos, y
el de sin `knotless`, distinto; `GraphBakes` pide las dos pasadas del pino
con `knotless` y las del roble sin él; los téxeles por hilo de las doce
telas del catálogo en una pieza de 120 mm (los de M3d a 0,01) y las que se
hornean (lona, carbono, punto y malla); el algodón horneado en una pieza de
50 mm (2,56) y no en una de 52 (2,46); nada para una tela con grafo propio,
la madera siempre; y la pelusa de la familia sigue en el material mientras
llega el horneado y después de sus dos pasadas (sin `finish`, 0).
`tests/m3d-family-fast.test.ts`, al día: `FAST_BAKED_FAMILIES` tiene la
tela, y el algodón y el vaquero tienen su grafo con el nodo *Tela* (que se
horneen o no lo dice `fastFamilyGraph`).
**Navegador** (Chromium sin cabeza con SwiftShader y los *workers* de la
aplicación, sin `rt.wasm`). En `tests/wood-fast-browser.test.ts`, «PINE:
the knots in Fast fall where Full puts them»: en la bola de pino de M3d,
los píxeles que la vista *Rápida* oscurece como nudos (más de 6 de 255 por
debajo de la misma bola sin nudos pedidos, que fuera de los nudos da los
mismos píxeles) contra los que cubren los nudos de `partKnots` (la lista
del motor, proyectada por la cámara de la escena; a dos píxeles del borde,
donde la malla facetada y la esfera se separan): solapamiento **0,977**
(128 píxeles esperados, 131 medidos), los tres nudos visibles con su
centro a **0,13, 0 y 0 píxeles** del esperado, y la bola del nodo, los
mismos píxeles. En `tests/fabric-fast-browser.test.ts` (2 y la captura):
el punto (12,8 téxeles por hilo en la bola de 100 mm) horneado, con
detalle fino 2,45 contra 0,14 del de antes (18 216 canales distintos); el
algodón (1,28), **0 canales distintos** del de antes; y el punto horneado
con su pelusa y sin ella, 19 977 canales distintos y 2,1 de luminancia
media más con ella.
**Mutaciones** (puestas y quitadas a mano, cada una en rojo): el
comportamiento de M3d (los nudos en el horneado y sin capa: solapamiento
0,019, los centros a 23,7, 6,9 y 27,3 píxeles); los nudos en el horneado
**y** encima (0,084); la vista previa sin volver a asignar los materiales
al llegar el horneado (la copia con nudos se queda con las medias: 0,021);
la copia con nudos sin `base.version` (el fundido de M3d: 0 canales
distintos); `patternPlacements` sin `knotless` y `GraphBakes` sin ponerlo
(sin navegador, uno cada una); la tela sin umbral (el algodón: 10 646
canales distintos); y sin `finish` (la pelusa: 0 canales distintos, y el
test sin navegador). Un test de un fundido de la pieza (no del material)
sobre el pino horneado pasaba también sin volver a asignar los materiales,
así que no se queda.

**Puertas.** `npm run engine:build` y `npm run qa` en verde (3259 tests: 3225 pasan y 34 se saltan, entre ellos las dos capturas, la de M3d y la nueva, que solo corren con `REPACK_WRITE_CAPTURES=1`; con Chromium, los de `wood-fast-browser` y `fabric-fast-browser` corren y pasan, también solos con `--maxWorkers=2`).
`engine/` no se toca.

**Capturas** (en *Sin publicar* de `GALERIA.md`): `m3d-wood-fast.png`
regrabada (la columna del medio, *Rápido* ahora: los nudos del pino donde
los tiene *Completo*, a la derecha), y la nueva `m3e-fabric-fast.png`, que
hace `tests/fabric-fast-browser.test.ts` con `REPACK_WRITE_CAPTURES=1` y el
`rt.wasm`: el punto, la lona y el algodón de la familia en la bola, en
*Rápido* antes de M3e, en *Rápido* ahora y en *Completo*.

No encajó con el plan (lo marcado ◆ está decidido en *Decisiones de criterio*):

1. ◆ **El umbral deja fuera el lino y el fieltro.** El informe de M3d los
   contaba entre las telas que se leen (2,4 y 2,1 téxeles por hilo en una
   pieza de 120 mm, con «2–3 téxeles» de criterio), pero con 2,5 no se
   hornean: en 120 mm se hornean la lona, la malla, el carbono y el punto.
   En la bola de 100 mm el lino (2,84) y el fieltro (2,56) sí. Opciones:
   (a) 2,5, como está decidido; (b) 2,0, que añade el lino y el fieltro en
   120 mm (y deja fuera el vaquero, 1,78).
2. ◆ **Cómo se ve un nudo encima.** La capa de E6 oscurece el nudo
   (`knotDarkness` × 35 %, la bolsa de corteza un 50 % más) sobre lo que hay:
   los anillos del horneado lo cruzan rectos, sin la testa del nudo (sus
   anillos alrededor de la rama), sin su grieta, sin el flujo de la veta a
   su alrededor y sin su rugosidad ni su cuenco, que el horneado traía (en
   otro sitio) y *Completo* pinta. Bajo el mundo blanco de la prueba el
   nudo es unos 20 de 255 más oscuro, menos que en *Completo*. Opciones:
   (a) como está; (b) que la capa dibuje también la testa (unos anillos
   concéntricos con la densidad del nudo) en el *shader*.
3. **Un solo nudo de madera por material.** La capa pinta los nudos de la
   primera instrucción `WOOD` que los pide; un grafo con dos nodos *Madera*
   con nudos deja los del segundo en el horneado, colocados en la caja como
   en M3d. Y la capa oscurece el color final del material: si el color del
   nodo *Madera* pasa por una mezcla, el nudo oscurece también lo mezclado;
   si solo llega su rugosidad, no hay capa y el nudo sigue en el horneado.
4. **La familia y su conversión se separan en la tela.** La tela de la
   familia horneada lleva su pelusa encima; la misma tela pasada a nodos no
   (la *Pelusa* del nodo no llega a la salida: M3c ◆1, para M5). En la
   madera siguen iguales.
5. **El umbral es por material, no por pieza**: el horneado cubre la caja
   de todas las piezas del material, así que una tela en una pieza pequeña
   y en una grande se hornea en las dos o en ninguna, según la caja.
6. **Las piezas que cambian sin tocar el material.** La vista previa
   vuelve a poner los materiales solo cuando cambian los materiales (como
   los horneados desde M3a): mover o escalar una pieza no rehace el
   horneado ni cambia de lado una tela hasta que algo toca los materiales.
7. **El punto «·» de los mandos del tejido** sigue (dice «lo pinta
   *Completo*»), aunque *Rápido* teja las telas gruesas: su ayuda dice
   cuándo. Quitarlo según la tela y sus piezas sería un mando que cambia
   con la escena.

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

## O2c · Editor de elementos de la lente — **Opus** — hecha

**Petición del usuario** (`TODO.md` §1.5, tal cual): «Un editor de lentes
donde, aparte de las opciones actuales, se pueda: editar los elementos,
cambiar tamaño o distancias entre cada elemento, añadir uno nuevo, rotarlo
180º». Decidido en *Decisiones de criterio*, 1.5: sí, sobre la lente propia
de O2.

**Qué.** Desde *Cámara ▸ Lente ▸ Lente trazada*, un **editor de lente** (una
ventana como el editor de material) sobre una **copia** de la lente: la del
catálogo no se edita nunca, editar hace una lente propia. Enseña el **corte**
del motor (`components/lens-section.ts`) y la **lista de elementos**; por
elemento, sus radios, grosor, vidrio (de la lista que hay) y apertura libre,
su **tamaño**, el **aire** hasta el siguiente, **añadir** un singlete donde se
elija, **borrar** y **girar 180°** (intercambia y niega los radios). Cada
edición es una entrada de deshacer; un arrastre, un gesto. Tras cada edición
el motor comprueba la prescripción y los números se ponen al día (focal,
tiraje, f/, círculo de imagen, las curvas que ya enseña la aplicación); una
lente inválida dice por qué, no se aplica y se sigue pudiendo editar; nunca
un fallo ni un NaN. Se guarda como lente propia en el proyecto y en la
biblioteca, con los mecanismos de O2, se renombra y va y vuelve.

**Depende de.** O2, O2b, O4, F1.

**Criterio.** Tests del efecto de cada operación en la prescripción, con lo
físicamente correcto (girar una biconvexa no cambia nada; una asimétrica
conserva la focal y cambia el tiraje y las aberraciones); deshacer; la lente
inválida; la persistencia; un test en el navegador (vitest y playwright-core,
saltado sin Chromium) que abre el editor, añade un elemento, gira uno y ve
cambiar la focal y redibujarse el corte, sin nada recortado. Dos capturas.

**Hecho.**

- **El modelo** (`src/core/lens-edit.ts`, sin DOM). `TracedLens.edited`
  (opcional) guarda la **prescripción editada** a la escala del diseño (las
  superficies con las convenciones de `lenses.json`), su **nombre** y su
  **enfoque**; `composeLens` la manda al motor en vez de la del catálogo, y la
  `key` sigue diciendo de qué lente salió (su diafragma, su fuente). Sin
  `edited`, nada cambia ni un byte. `startEdit` copia lo que el motor traza
  de la lente ahora (con el tratamiento y el hueco variable de la persona).
  La lista (`lensRows`): cada elemento de vidrio entre su superficie
  delantera y trasera, los cementados marcados, y el diafragma. Las
  operaciones, una prescripción dentro y otra fuera: `setElement` (radios
  —`0` o `∞` es un plano—, grosor, vidrio, diámetro: las dos semiaperturas
  escaladas para que la mayor sea su mitad, `null` vuelve a la automática),
  `scaleElement` (más pequeño, más grande: la apertura por el factor, la
  automática desde la del motor), `setGapAfter`, `insertElement`,
  `deleteElement` (un singlete en aire deja el resto donde estaba; en un
  grupo cementado, los demás siguen cementados), `rotateElement` (las
  superficies en orden inverso con los radios negados, los vidrios y
  grosores al revés, tratamientos y aperturas con su superficie; un grupo
  cementado gira entero; el aire de delante y de detrás, igual) y
  `renameEdited`. **El elemento nuevo** (`defaultSinglet`,
  `insertionAperture`): un biconvexo débil del vidrio de la lente simple del
  catálogo, radios ±4 f y grosor 4 % de f (entre 1 y 12 mm), f la focal del
  diseño, tan ancho como el más estrecho de sus vecinos; en medio del hueco si
  cabe con un 1 % de f de aire a cada lado **también en los bordes** (si no,
  la lente se separa), a un 5 % de f delante del primero o detrás del último,
  nunca dentro de un grupo cementado, y lo bastante grueso para su propio
  borde. **El enfoque**: los huecos que mueve una lente de enfoque interno o
  flotante se siguen a través de las ediciones (editar uno mueve su
  recorrido; añadir delante los corre dos superficies); si una edición quita
  uno, la lente enfoca moviéndose entera, y el editor lo dice. **La lista de
  vidrios** (`LENS_GLASSES`): no había ninguna; son los 66 vidrios distintos
  de las prescripciones del catálogo, por índice y número de Abbe en la línea
  d (crown o flint por la línea de 50), sin nombres de fabricante.
- **Lo que está mal** (`structuralProblems`, antes de preguntar al motor: no
  se le manda nada con un hueco negativo, que el motor trazaría sin queja):
  de 2 a 64 superficies, algún vidrio y en aire al final, un solo diafragma,
  cada número un número, grosor de vidrio positivo, aire no negativo, una
  apertura dada no más ancha que su esfera, y con las aperturas **dadas**,
  las dos superficies de un elemento que se cruzan dentro de ella (el borde)
  o dos elementos que chocan; del motor (`refusalProblem`, `engineProblems`):
  sin imagen real o afocal, sin luz por el eje, la imagen dentro de la lente;
  y otra razón, en sus palabras. Cada problema dice dónde (*Elemento 3*).
- **El motor** (`rt-core/src/optics/traced.rs`): `LensInfo.design_efl_mm`,
  `"designEflMm"` en el JSON de `rt_scene_lens_info` y de
  `/api/lens/info`: la focal paraxial de la prescripción tal como está
  escrita (en su banda verde), antes de escalarla a la de la cámara. Sin
  ella, la focal que dice el motor es siempre la de la cámara y añadir un
  elemento no cambiaría ningún número de focal. Nada de render: **ningún
  *hash* fijado se mueve**. El motivo del rechazo ya salía por
  `rt_scene_error_copy` y el JSON de error del lanzador:
  `render/lens-info.ts readLensVerdict` y `LensPort.check` lo llevan al
  editor (`main.ts`, con la página o el lanzador, y una trampa del módulo es
  «sin motor», nunca un fallo).
- **La copia y sus órdenes** (`src/ui/lens-edit-commands.ts`).
  `CameraState.lensDraft` (opcional, se guarda con el proyecto): la primera
  edición copia la lente de la cámara, con su nombre y *(editada)*; cada
  edición es `camera/set` con la copia, una entrada (*Editor de lente: girar
  un elemento 180°*…), o una por gesto; la que no cambia ningún número no
  apunta nada. **Aplicar** pone la copia en la cámara (una entrada) y solo si
  es la lente que el motor comprobó (la ventana se la pasa; otra, se
  rechaza); **Descartar**, una entrada; **Guardar en la biblioteca…** con
  `saveLensToLibrary` (que acepta la lente a guardar).
- **La ventana** (`src/ui/panels/lens-editor.ts`, `lens-editor.css`, `UI.md`
  §2.11): barra con el nombre (un campo), *Descartar cambios*, *Guardar en la
  biblioteca…* y *Aplicar a la cámara*; el corte del motor con el número de
  cada elemento y el elegido más oscuro (`lensSectionSvg` con `highlight` y
  `labels`; un clic en un elemento lo elige; atenuado cuando no es el de la
  lente que hay); las herramientas del elegido; la tabla de campos (la lista
  se rehace solo cuando cambia su forma, así un arrastre no pierde su campo);
  a la derecha, si se puede aplicar o por qué no, y lo que calcula el motor:
  *Focal del diseño* (y la de la cámara), *Tiraje*, *Diafragma*, *Elementos ·
  grupos*, *Longitud*, *Círculo de imagen* (de la luz hacia la esquina del
  motor: hasta dónde llega y si cubre el encuadre) y las curvas de
  distorsión y luz. Pregunta al motor 40 ms después de la última edición y
  solo cuenta la respuesta de la última. *Cámara ▸ Lente*: **Editar
  elementos…** (apagado y diciendo por qué con el adaptador y la lente de
  espejo), *Lente editada: nombre* y el aviso de una edición sin aplicar;
  elegir una lente de la lista vuelve a poner la del catálogo; sin hueco
  variable para una lente editada; su corte y sus números se preguntan al
  motor sin la caché de O2b, y la ventana de la lista (O2b) enseña la del
  catálogo para la lente de la que salió una editada.
- **Persistencia.** El proyecto lleva `edited` y `lensDraft` y vuelven igual
  (`io/project.ts` lee la copia; unos `edited` que no se leen abren la lente
  del catálogo, una copia que no se lee se descarta); la biblioteca lleva la
  lente editada en `LensPayload.traced` y rechaza un elemento cuyos `edited`
  no se leen (nunca una lente del catálogo callada en su sitio).
- **Tests.** `tests/lens-edit.test.ts` (20): la lista y la copia (cada lente
  del catálogo que se edita, sin nada mal; el adaptador y la de espejo, no);
  girar (radios intercambiados y negados, dos veces es la lente, un plano es
  un plano, la biconvexa es ella misma, el doblete gira entero, el
  diafragma no gira); radios, grosor, vidrio, diámetro con su proporción,
  tamaño con la apertura del motor, lo que no es un número no cambia nada;
  el aire y solo él; añadir en medio de un hueco ancho (los vértices de
  detrás donde estaban), en uno estrecho (la lente crece), delante, detrás,
  nunca dentro de un cementado; **añadir en cada sitio de cuatro lentes sin
  chocar en los bordes**; borrar (un singlete, el crown y el flint de un
  doblete); el enfoque interno seguido y perdido; lo que está mal y dónde, y
  las palabras del motor; con el `rt.wasm` real, la **focal del diseño** de
  las 14 lentes contra la del informe y su escala, el **giro de una
  biconvexa** (misma focal, tiraje y distorsión), el de una **plano-convexa**
  (la misma focal a 1e-4, el tiraje movido t/n —el plano principal trasero
  pasa de un vértice al otro— y otra distorsión), el del acromático
  (misma focal, otro tiraje), **añadir en cada sitio de las 14 lentes** (el
  motor la traza, un elemento más), añadir acorta la focal y borrar la
  devuelve, y el rechazo sin imagen real o afocal con su motivo; la copia en
  el *store* (la primera edición la hace, una entrada por edición o gesto,
  nada sin cambio, deshacer hasta sin copia, el catálogo intacto; aplicar
  solo la comprobada, en una entrada, con deshacer; descartar; sin lente
  trazada o con la de espejo no se abre); el proyecto de ida y vuelta (con la
  copia; las de antes, byte a byte; dañados, a la lente del catálogo y sin
  copia) y la biblioteca (renombrada, de ida y vuelta, la dañada
  rechazada); el corte con el elegido y los números, y la ventana de la
  lista. `tests/lens-editor-browser.test.ts` (3, Chromium y el `rt.wasm`
  real de la página): abre el editor, **añade un elemento** (ocho filas, la
  focal del diseño más corta, siete vidrios en el corte, el nuevo elegido),
  **gira el primero** (otra focal del sistema y otro tiraje, otro corte), dos
  entradas de deshacer y vuelta atrás, la lente de la cámara intacta hasta
  aplicar; un hueco negativo escrito (*Elemento 1*, sin aplicar, el corte
  atenuado), corregido y comprobado; un radio que deja la lente sin imagen
  (el motivo del motor); aplicar; y **nada recortado** en inglés y en español
  en una ventana más pequeña. rt-core
  `the_lens_information_tells_the_focal_length_of_the_design_before_the_scale`.
  `tools/lens-editor-check.mjs` (cinco comprobaciones en la aplicación
  construida con el `rt.wasm` real) deja `o2c-lens-editor.png` y
  `o2c-lens-modified.png`.

**No encajó con el plan.** (1) **O2 no guardaba la prescripción.** La
decisión 1.5 dice «sobre la lente propia que ya guarda O2», pero O2 (su punto
5) guardaba la clave del catálogo y los ajustes, no las superficies. O2c añade
`TracedLens.edited` (opcional, solo en una lente editada); `STUDIO-TOOLS` sí
hablaba de guardar «la prescripción y los ajustes». (2) **No había lista de
vidrios**: es la de los vidrios de las prescripciones del catálogo. (3) **La
focal no cambia en la cámara**: el motor escala toda lente a la focal de la
cámara (O2), así que lo que cambia al añadir un elemento es la **focal del
diseño**, que hacía falta que el motor dijera (`designEflMm`, sin render).
Las medidas de la lista son las del diseño, y el pie lo dice. (4) **Tamaño**
es la apertura libre del elemento (su diámetro), no su escala entera. (5) La
copia vive en la cámara (`lensDraft`) y viaja con el proyecto: así cada
edición es una entrada del *store* y una lente mala no llega nunca a la
cámara. (6) **Girar un elemento cementado gira su grupo** (girar uno solo
rompería el cemento). (7) **Lentes que no se editan**: el adaptador
anamórfico (cilindros, compuesto con otra lente) y la de espejo (pliega la
luz: sus distancias negativas no son huecos). (8) **El borde y el choque** se
comprueban solo con las aperturas dadas: con las que el motor calcula al haz
(las ensancha con rayos reales del encuadre), varias lentes del catálogo
darían choques que no existen. (9) Sin motor la lente se edita pero no se
aplica (no se puede comprobar). (10) La ventana se mueve pero no se
redimensiona ni recuerda dónde estaba (el editor de material sí). (11) El
recorrido del diafragma de una lente editada sigue siendo el de la lente de
la que salió. (12) La ventana de la lista (O2b) enseña la lente del catálogo
para la de la que salió una editada, y la sección de la cámara pregunta al
motor por la editada sin la caché de O2b. (13) Un círculo de imagen menor que
el encuadre se dice pero no impide aplicar (un ojo de pez circular lo es).
**◆ Decidido** en *Decisiones de criterio* (se acepta tal como está): el elemento nuevo
por defecto (radios ±4 f, grosor 4 % de f, el vidrio de la lente simple del
catálogo, tan ancho como el vecino más estrecho, centrado en el hueco); los
márgenes (1 % de f de aire, 5 % delante y detrás, 1e-3 mm de tolerancia en
los bordes); el paso de *Más pequeño · Más grande* (10 %); el umbral del
círculo de imagen (una luz relativa de 0,001) y si un círculo que no cubre
el encuadre debería impedir aplicar; y si una lente editada debe conservar
el recorrido del diafragma de la del catálogo.

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

## O4 · Lente simple y trazada: opciones de cada una — **Opus** — hecha

**Petición del usuario** (dos mensajes, tal cual):

> «aparte, el bokeh se elije con thin lens, y al seleccionarlo te saca si
> estabas en traced lens. Lo que quiero es que sea simple lens en vez de
> thin, y que el bokeh solo salga con simple lens.»

> «bokeh y advanced optics son de thin lens, asique lo mismo que te dije
> con bokeh, que solo aplique a simple lens, en traced no quiero estas
> opciones. Quiero meter el tilt y shift en traces, en advanced (que
> quiero llamarlo more options) y hacer que para ambos, advanced optics y
> more options sea más intuitivo y fácil de usar el tilt.»

**Qué.** (1) La *lente fina* pasa a llamarse **lente simple** en todo lo
visible, con las claves y los valores guardados intactos. (2) El **bokeh**
y la **óptica avanzada** son de la lente simple: con una lente trazada no
se enseñan, ningún camino aplica un bokeh a una cámara trazada ni la saca
de su lente (un aviso corto en su lugar), y volver a la lente simple
recupera lo que tenía. (3) El *Avanzado* de la lente trazada se llama
**Más opciones** y lleva **inclinación y desplazamiento** de la lente
trazada, en el motor si cabe, desde la literatura óptica. (4) Una
**inclinación fácil** en los dos: cantidad y dirección en vez de números de
eje, el plano de enfoque dibujado en el visor, y el plano por dos puntos.
*Enderezar verticales* no (es de K3): solo dejar el desplazamiento listo.
(5) Documentación, capturas y (6) esta fase.

**Depende de.** O1, O2, O2b.

**Criterio.** El bug con su test, que falla al quitar el arreglo, por cada
camino que lo tenía; las secciones de cada modelo y su vuelta; el cambio de
nombre con los proyectos antiguos de ida y vuelta; la matemática del plano
por puntos en TS y, en el motor, el plano por los puntos pedidos, el
desplazamiento por lo esperado e inclinación y desplazamiento 0 bit a bit;
un test en el navegador por modelo sin nada recortado; todos los *hash*
fijados intactos y uno nuevo para la lente trazada inclinada, con su
paridad wasm.

**Hecho.**

- **Lente simple.** `camera.lensThin` dice *Simple lens · Lente simple* (la
  clave y el valor guardado `thin` no cambian; `lensModelOf` lo lee) y las
  demás cadenas, la ayuda, el `bokehResetAux`, UI.md, SPEC.md y
  ARCHITECTURE.md hablan de la lente simple (un test comprueba que ninguna
  cadena de `strings.ts` dice *thin lens* ni *lente fina*). La fila *Modelo
  de lente* pone su etiqueta encima y los dos botones a todo el ancho: el
  test de recorte del navegador encontró que *Lente simple · Lente trazada*
  no cabía al lado en español.
- **El bokeh y la óptica avanzada, solo con la lente simple.** Con una
  lente trazada las secciones *Bokeh* y *Óptica avanzada* no se pintan
  (`display: none`, sin un solo mando visible). El bug tenía **dos
  caminos**, los dos en `insp-lens.ts`: la casilla de un tipo y la lista de
  *Variante*, que llamaban a `opticsForBokeh`, y esa función ponía
  `traced: null` (vuelta a la lente simple). No había más: ni la paleta, ni
  el menú de cámara, ni los parámetros de URL, ni un arrastre o una suelta
  de un recurso de bokeh aplican un bokeh (los recursos de A6 son las
  imágenes de la pupila, que solo nombra un tipo). Ahora `opticsForBokeh`
  devuelve `null` con una lente trazada, para cualquier tipo, y todos los
  caminos pasan por una orden, `applyBokeh` (`src/ui/lens-commands.ts`), que
  con una lente trazada no toca la cámara y avisa *El bokeh es una opción de
  la lente simple: esta cámara tiene una lente trazada, que hace el suyo*
  (lo que use un arrastre o un menú futuro). Cambiar de modelo
  (`opticsWithLensModel`, `setLensModel`) ya no borra el tipo de bokeh ni su
  variante: el bokeh, sus parámetros y la inclinación de la lente simple se
  quedan en `optics` y vuelven tal cual; cambiar de lente trazada tampoco lo
  borra. Los tres tipos de la lente trazada (cometa de coma, respiración de
  foco, aberración esférica variable) **no están en la rejilla** de la lente
  simple: son de sus lentes en *Lente ▸ Lente trazada* (decidido, abajo; al
  principio salían apagados diciendo dónde estaba su lente). Tests: `tests/lens-o4.test.ts` (cada tipo y cada variante
  contra una cámara trazada; la orden con su aviso; la vuelta con el bokeh y
  la óptica avanzada) y `tests/traced-lens.test.ts`, cuyo test de O2
  esperaba justo el bug («un tipo de la lente fina devuelve la cámara a la
  lente fina») y ahora espera lo contrario. Con `opticsForBokeh` y la guarda
  de `applyBokeh` devueltas a lo de antes, fallan tres tests (comprobado).
  En el navegador (`tests/lens-modes-browser.test.ts`): ninguna casilla de
  bokeh visible con lente trazada, `applyBokeh` de tres tipos sin cambiar
  de lente, y la vuelta con la burbuja marcada.
- **Inclinación de la lente trazada, en el motor**
  (`rt-core/src/optics/traced/tilt.rs`, ARCHITECTURE §5.2 sedecies). La
  lente gira respecto al sensor alrededor de la posición de la cámara (su
  pupila de entrada), el sensor queda de frente a la vista donde la lente
  forma la imagen del punto de enfoque (el encuadre no gira y el centro
  queda nítido), y el ángulo se resuelve con la óptica paraxial de la lente
  (el conjugado del plano del sensor, `Abcd`, bisección) para que su plano
  de enfoque se incline **como el de la lente simple** de la misma
  inclinación (decidido); el centro se reenfoca con rayos reales (la curvatura de
  campo donde la inclinación pone el punto de enfoque: sin eso el centro
  quedaba hasta un 4,5 % lejos en el tele); los límites de la pupila se
  trazan en 9 × 9 posiciones del sensor y el peso lleva el coseno del
  sensor inclinado. El motor dice el ángulo que gira la lente (`tiltDeg`
  en la información, la fila *Inclinación de la lente*: 5,95° para 6° en la
  doble Gauss a 85 mm). Tests de `traced_tests`: el centro a la distancia
  de enfoque (≤ 1,5 %) y la pendiente del plano igual a la de la lente
  simple más la curvatura de campo de la lente derecha a las mismas alturas
  (2 % en la doble Gauss, 0,1 % en la macro, hasta 15 % en el tele y el
  triplete con eje oblicuo); los nueve puntos de la macro sobre el plano
  (2,5 %); el encuadre sobre el punto de enfoque; cada lente del catálogo
  sin cilindros se inclina en los dos sentidos; lotes con los bits de las
  muestras solas; la luz del centro dentro del 6 %; inclinación 0 con
  cualquier eje, la lente derecha bit a bit; el adaptador (cilindros) la
  rechaza. **El desplazamiento** de una trazada ya existía en el motor
  desde O2 (sensor desplazado antes de trazar): test nuevo de que mueve el
  eje sus milímetros, derecha o inclinada. *Hash* nuevo
  `PINNED_O4_TRACED_TILT_4SPP` = `0x0b2fc327` (`example::o4_scene`, la
  doble Gauss a 6° y desplazada (2, −3) mm; `rt --write-o4-example`,
  `tests/fixtures/o4.rsb`) en escalar, SSE2 y AVX2, en el `rt.wasm` real por
  el código de la página y en CI con `tools/wasm-parity.mjs` (con y sin
  pases), y 1/4/16 hilos. **Ningún otro *hash* se movió** (ejemplo, E5,
  O1, O2, O3a y el resto: `cargo test --workspace` en verde). Sin bit nuevo
  en `rt_features` (el 32 no se usa).
- **La inclinación fácil** (`src/ui/panels/insp-tilt.ts`, el mismo bloque
  en *Óptica avanzada* y en *Más opciones*; `src/core/focus-plane.ts`). La
  pareja guardada (inclinación con signo y eje) se lee como **cantidad**
  (deslizador de 0° a 12°) y **hacia dónde de la imagen se aleja el plano**:
  un **dial** que se arrastra (un arrastre, una entrada de deshacer;
  teclado y Mayús) con **cuatro atajos** (*como el suelo*, *como el techo*,
  *como una pared* a cada lado) y el ángulo. **Por dos puntos…**: dos
  clics en el producto ponen la inclinación **y la distancia de enfoque**
  para que los dos salgan nítidos, en una entrada (*Inclinar el plano de
  enfoque por dos puntos*): de los planos por los dos, el menos inclinado;
  dos puntos a la misma profundidad solo enfocan; un segundo punto
  imposible (más de 12°, en línea con la vista, detrás) avisa y espera. La
  función resuelve también el plano por **tres** puntos (test), aunque el
  visor solo pide dos (decidido: sin tercer punto por ahora). **El plano en el visor**: un cuadrado translúcido
  con rejilla, en la tinta de la interfaz, alrededor del producto y en
  perspectiva, con el punto de enfoque (y el primer punto elegido), en
  Rápido y en Completo, mientras el puntero o el foco están en el bloque,
  mientras se eligen los puntos y siempre con *Ver el plano*
  (`ViewportPort.setFocusPlane`). El **desplazamiento** queda en el mismo
  bloque y es de la cámara (los campos de siempre). Con las *Verticales
  rectas* de K3 (llegadas al fusionar) su desplazamiento se suma al de estos
  campos al renderizar, con la lente simple y con la trazada, y el plano
  dibujado y *Por dos puntos* usan la cámara nivelada que se renderiza
  (`renderedCamera`; la distancia de enfoque vuelve dividida por el coseno
  de lo corregido, como el foco por clic de K3): test que falla sin ello.
  Con una panorámica no se dibuja plano (no tiene lente).
  Con el adaptador anamórfico el bloque dice que no se inclina. En *Más
  opciones*, además, el resto del diafragma (*Redondez*, *Giro*,
  *Obstrucción*), que una lente trazada usa y que ya no se veía al
  esconder la óptica avanzada.
- **Herramientas, capturas.** `tools/o4-check.mjs` (siete comprobaciones en
  la aplicación construida, sus capturas `o4-simple-optics.png`,
  `o4-traced-more.png` y `o4-tilt-overlay.png`), `rt --tilt-sheet <dir>`
  (luces sobre un suelo con las dos lentes, derechas y tumbadas sobre el
  suelo; su composición es `o4-traced-tilt.png`); `tools/lens-check.mjs` y
  `tools/optics-check.mjs` al día (este contaba 16 casillas con miniatura,
  como en O1: lo había dejado atrás O2), con `lens-editor.png`,
  `lens-section.png`, `camera-bokeh.png` y `camera-optics.png` regrabadas.

**Qué no encajó.** (1) **El id O4 ya estaba** en la tabla de fases de
óptica de `STUDIO-TOOLS` (más abajo), para una fase planeada y sin
empezar: *Flare con fantasmas, estrella de difracción…*. Esta fase se
queda con O4 y aquella pasa a **O6**, el siguiente libre (O5 es el editor
de lentes de la misma tabla). (2) **Qué significa
la inclinación de una lente trazada.** Se eligió que el mismo número dé el
mismo plano que la lente simple (la lente real gira el ángulo que haga
falta, y el motor lo dice), para que el dibujo del plano y los dos puntos
valgan con las dos lentes; la otra opción, que el número sea el giro físico
de la lente y el plano salga de su óptica, hace falsa la cuenta de la
interfaz con una lente trazada. (3) **Curvatura de campo.** Con una
lente trazada el plano por dos puntos es exacto en el centro y paraxial
fuera: un punto en la esquina de la doble Gauss a f/8 cae a un 3–10 % de
profundidad del plano (en el triplete, mucho más: es su campo curvo, igual
que derecha). Resolverlo con rayos reales pediría al motor el plano de una
cámara (un puerto nuevo): pendiente para después de F1 (abajo). (4) **La inclinación de la lente trazada se
guarda aparte** (`tracedTiltDeg`, `tracedTiltAxisDeg`): una cámara trazada
de antes con una inclinación de la lente simple guardada (el motor la
ignoraba) no empieza a inclinarse; el desplazamiento, en cambio, es uno
solo para las dos lentes, porque el motor ya lo aplicaba a las dos. (5) **El
diafragma y la aberración cromática y el remolino** son de la cámara, no de
cada lente (el motor los usa con las dos y así se guardaban): tocarlos con
una lente trazada deja el bokeh de la lente simple en *A medida*.
(6) **Los tipos de bokeh de la lente trazada** en la rejilla: primero
salían apagados diciendo dónde estaba su lente; con la decisión se quitan
de la rejilla. (7) El plano del visor se dibuja encima de todo
(como los glifos y el *gizmo*), sin cortarse con el producto. (8) El dial
guarda, al tocarlo, la inclinación positiva y el eje girado 180° si hacía
falta: el mismo plano (test); lo guardado antes no se toca hasta que se
edita. (9) **Coordinación**: *Por dos puntos* escribe la distancia de
enfoque, que es su resultado (F1, que trae el foco por clic y sus modos,
tendrá que decidir si pasa por sus modos al fusionar); no se tocó el clic de
enfoque ni su rayo. K3: sus verticales rectas no escriben los campos
`shiftXMm`/`shiftYMm`, suman su desplazamiento al renderizar; los dos se
componen (arriba). (10) El modo
Rápido sigue sin desenfoque: el plano dibujado es lo que lo sustituye
mientras se ajusta. (11) El límite de 12° es el de la lente simple de O1
para las dos (un descentrable real llega a unos 8,5°).

**Decidido** (por la dirección de la sesión, sobre los puntos que este
párrafo dejaba abiertos):

1. **Sin tercer punto por ahora**: *Por dos puntos* basta. El plano del
   visor se queda como está (encima de todo, al pasar el puntero, al elegir
   los puntos o siempre con *Ver el plano*). `solveTilt` sigue resolviendo
   tres puntos (test), sin mando.
2. **La inclinación de una lente trazada es «el mismo plano que la lente
   simple»**, como está.
3. **Con una lente trazada, *Por dos puntos* debe resolverse con rayos
   reales.** Hecho con F1: con el giro del plano de la lente simple, la
   distancia es la media de las que el motor resuelve con rayos reales para
   cada punto (`core/focus.ts exactFocusDistance`, `rt_scene_focus_at`);
   sin `rt.wasm`, la del plano. Lo comprueba `tests/lens-o4.test.ts`.
4. **El diafragma, la aberración cromática y el remolino son compartidos**
   por los dos modelos, como está.
5. **Los tres tipos de bokeh de la lente trazada se quitan** de la rejilla
   de la lente simple (la persona no quiere opciones de la trazada
   mezcladas). Hecho: la rejilla tiene 17 tipos; lo comprueban
   `tests/lens-modes-browser.test.ts`, `tools/lens-check.mjs` y
   `tools/optics-check.mjs`, y `camera-bokeh.png` está regrabada.
6. **El límite de 12° se queda.**
7. **La hoja `rt --tilt-sheet` se acepta.**

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
coste medido (≤ +15 % en el ejemplo con 0,3 mm). Después, llevar a
`rt-core` las recetas procedurales del catálogo (veta
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
- **Campos nuevos**: `ringContrast`,
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
- **El vaquero pasa a sarga 3/1** (`TWILL31`, clave nueva; la `TWILL` es
  2/2 y la siguen usando la sarga y el carbono): con 2/2 su
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

## L1 · Reflection placement, clear field, editable lights — **Sonnet**

**What.** Exact reflection placement with the Rust engine's `pick`
(mirror the camera ray about the picked normal and put the light at its
distance);
clear field per environment for `camera = true` (a soft disc in window
coordinates, apparent radius from the panel's size and distance,
bounded radiance), so that no light is ever seen as an object with
edges; light-by-light editing with `modified`; *Reset setup*.

**Depends on.** E4.

**Acceptance.** Geometric test: with a sphere and a click at its point
(x, y), the light ends up in the reflected direction (dot product > 0.999);
capture of BACKLIT, SILHOUETTE and ECLIPSE with the disc visible and no
rectangles.

## L2 · Own thumbnails — **Sonnet**

**What.** `tools/render-thumbs.mjs`: generates one RSB per thumbnail with
`src/io/rsb.ts` and renders them with the native `rt` binary (no
browser, in CI): the 72 light-setup thumbnails (160 × 120 and 64 × 64) with
the sample part in neutral grey, and the spheres of the 77 materials,
with the hash of their recipe in a `tEXt` chunk of the PNG; `--check` fails if
any is out of date and the suite runs it. It replaces the previous PNGs in
`public/thumbs/`.

**Depends on.** E4, E5 (so that the colour and glass ones come out right).

**Acceptance.** `--check` green in CI; changing a number in a setup
without regenerating makes the suite fail.

## L3 · Photographic review of the recipes — **Fable**

**What.** With the contact sheet from E3/E5 and the thumbnails from L2, review
the 72 setups and the 16 product-type rigs on the own engine and
adjust **data only** (`src/data/light-setups.ts`, `studios.ts`). What is
measured: one highlight per source with the shape of the source; less than 1 % of
the part's pixels blown out at exposure 0; mean luminance of the part
within ±0.3 EV between setups of the same product type; no
black areas above 5 % on light backgrounds; the thumbnail has the
brightness of the render.

**Starting data (light power correction, after U5).**
The recipes are now evaluated with the Cycles convention. With JEWELLERY, the
irradiance of the lights versus the dome on an upward-facing face is 2.31× in the far field and 1.4–1.9× integrating over the panel; the dome
still gives about half of the part's brightness, just as in
Blender with the same values. REMBRANDT versus NEON_NOIR change
48 % of the part's pixels (77 % without the dome). The balance between
lights and dome per product type is decided by Fable here;
`tools/setup-contrast.mjs` measures it.

**Depends on.** E5, L2.

## U7 · Dragging a material and box selection — **Sonnet** — done

**What.** Drag a material (a catalogue thumbnail, one from *Mine*, or
the material sphere of the selection) onto a part in the viewport or
onto a tree row, with highlighting (`UI.md` §2.2 and §2.3). With the
*Select* tool, box selection (window and crossing) at every level
(`UI.md` §4.1), which was added to the phase once it had started.

**Depends on.** U1, U4.

**Acceptance.** Drag-assignment rules as a pure action with numbers; box
selection tested on projected geometry; browser check with mouse, pen
and finger in *Fast* and *Full*.

**Done.**

*Dragging a material.* With pointer events, not with the browser's
drag and drop (a desktop webview does not always provide the
native session, and does not let you decide the ghost, the pen or `Esc`):
`src/ui/components/material-drag.ts` is the controller (5 px threshold,
ghost thumbnail above and to the right of the pointer, drop zones
registered per element, `Esc` in the capture phase, click swallowed after dragging; a finger does not drag and keeps its usual gesture). The
rules live in `src/core/material-drop.ts` and are tested with numbers: in
the viewport, a drop reaches what a click would select at the current
level (part, assembly, model or, at the *Faces* level, the whole face
under the cursor); on a tree row, the node and everything that hangs from
it. A catalogue preset or a library item enters with
**the instance that the scene already has of it** (the same one a click on
the thumbnail uses, so dropping and clicking leave the same project); the
selection's sphere links to **that instance**; with **`Alt`** the
drop gives **an own copy** (`material/assign` with `copy`, label
*assign a copy*). It is always **a single action** `material/assign` and
one undo entry, with the name of the material and of the target.
Highlighting: outline (the viewport's) on parts, tint on faces and
dashed border on the tree row, which also outlines in the viewport
what it would reach; the ghost shows *Copy* while `Alt` is held.
`src/core/materials.ts` gains `copy` and `material/assign` no longer creates
an entry when nothing changes.

*Box selection.* `src/core/box-select.ts` (pure, in screen
pixels) and `src/ui/panels/viewport-box.ts` (the gesture). **`Ctrl/⌘` +
drag** draws the box with *Select* and with *Move* (where there is no
handle under the pointer), in the three mouse schemes; without `Shift` or
`Alt` it **replaces** the selection, with `Shift` it **adds** and with `Alt`
it **removes**. Left to right is a **window** (what remains
entirely inside; continuous outline), right to left is **crossing**
(what it touches; dashed outline), both achromatic. At the *Part*,
*Group* or *Model* level the projected geometry is tested (bounding box
first, then the triangles; without looking at what covers what, as in
a CAD: a part behind another is also picked, and hidden ones do not
count); at the *Faces* level it picks whole faces (CAD or by continuity,
see **M1**) of a part, with the *X-ray* button in the view bar
to pick the hidden ones as well. A drag of a few pixels is a
click, `Esc` cancels, the pen does what the mouse does and a finger does not draw
a box (it keeps orbiting); the selection is not undoable (a box is not a
history entry). With the schemes that leave the left button free
(*Alt + left button orbits* and *Middle button orbits*), a plain
drag already draws the box and `Shift` adds without `Ctrl`; with
*Middle button*, `Alt` removes without `Ctrl`; with *Alt + left button*,
`Alt` is the orbit and removing is `Ctrl/⌘ + Alt`. Clicks do not change:
click selects, `Shift` click adds, `Ctrl/⌘` click toggles, `Alt`
click removes (except with *Alt + left button orbits*, where `Alt` belongs to
the camera). In *Full* the preview's geometry is used, just
like `pick`. New `ViewportPort` methods: `projection`,
`visibleTriangles` and `setHoverFaces`.

*Owner's decision on the gesture (2026-10-13).* The left button
still orbits by default, and **`Ctrl/⌘` + drag** is the box; the
first version armed the box with `Shift`, `Ctrl` or `Alt`. What
changes with respect to the previous viewport: with *Select* and *Move*, `Ctrl/⌘`
+ drag with the left button no longer pans (it was the hidden shortcut
of the orbit controls; the right button, the wheel and the
*Pan* tool remain). `Shift` + drag and `Alt` + drag do not arm
anything and do what the camera did before. The text of *Settings ▸
Preferences ▸ Viewport and navigation ▸ Mouse* and the tooltip of *Select*
say so in both languages, and it was checked in the browser that they do not
overflow (the Settings row goes to four lines and the tooltip fits in
its 280 px).

*Tests.* 89 new tests (25 in `material-drop.test.ts`, 35 in
`box-select.test.ts` and the 29 from M1 in `faces.test.ts`; 1031 in total);
63 mutations of the unit tests, all detected except two
equivalent ones (F9, and the one where `Ctrl` does not arm in *Alt + left button
orbits*, which already arms earlier through another branch), and 16 in the browser, all
except one order guard between the drop highlight and the hover outline
that the browser cannot observe.
`tools/material-drag-check.mjs` and `tools/box-select-check.mjs`
(Playwright with the local Chromium, in *Fast* and *Full*, with mouse,
pen and finger); captures `docs/ui/material-drag.png`,
`material-drag-tree.png`, `material-drag-faces.png`, `box-window.png`,
`box-crossing.png` and `box-faces.png`. The *Full* ones, which are very
heavy, are written to `out/` and do not go into the repository.

**What did not fit the plan:**

- **A drop on a target with different materials keeps the inline
  question from `UI.md` §4.1** (*Replace all · Keep existing · Cancel*, with an inventory): it is the case of dropping on
  a group or a model whose parts carry different materials. The
  phase asked for "a single action" and it is one (a single undo entry
  once answered), but it is not applied blindly. If it is preferred that a
  drop replace without asking, that is an interface decision (Fable);
  in the meantime §4.1 applies.
- **At the *Faces* level the catalogue only appears when a face is
  selected**, so there is no thumbnail to drag before
  picking the first one; the drop lands on **the face under the cursor**, not on
  the selected ones.
- **The drag highlight ignores the *Outline on hover* setting:**
  without it, dropping would have no signal of where it is going.
- **A finger neither drags nor draws a box** (it keeps what it did:
  panning the panels and orbiting); the pen is a mouse.
- **The box does not show a preview of what it will pick:** only the
  rectangle; the selection changes on release.
- **In the default scheme the box is not drawn with a plain drag**,
  but with `Ctrl/⌘` + drag (owner's decision): the
  left button orbits and a box with a plain drag would take the orbit away from it. Whoever wants it without a key can choose the
  *Alt + left button orbits* or *Middle button orbits* scheme.
- Two structural things: `Alt` clicks on the viewport go through
  `clickMods` to respect the *Alt + left button orbits* scheme,
  and `ViewportPort` was extended with three methods (`ARCHITECTURE.md`
  §6.1).

## M1 · Whole CAD face — **Sonnet** — done

**What.** Face selection by surface continuity: adjacency
by vertex **position**
(welding at 1e-5 of the mesh size), edge crossing if the dihedral is
smaller than the sharp-edge angle (30°) **and** smaller than 2.5 times the
clicked face's own curvature; edges marked by the
importer always cut; `Shift` gives the single triangle. With STEP (I2),
the original face ranges win.

**Depends on.** U1, I1.

**Acceptance.** Tests with a plate, a plate with duplicated vertices, a cylinder
with caps (the whole wall, stops at the caps), a flat-fillet-wall
profile, a marked edge. Verify that each one fails if its condition is
removed.

**Done.** `src/core/faces.ts` (pure model): `cadFaceRegion` grows
the face from the picked triangle with the rules above and, on
a STEP or IGES part, returns the CAD range that contains it (the
ranges win); the topology is computed once per mesh and stored in
a `WeakMap`. In the viewport, at the *Faces* level a click picks **the whole
face**: a plain click replaces, `Shift` adds **a single triangle**,
`Ctrl/⌘` toggles the whole face and `Alt` removes it; when dragging a
material the face that would receive it is tinted (`ViewportPort.setHoverFaces`).
*Separate by CAD faces* (`scene/separateByCadFaces`) stops being
*coming soon*: it is in the part menu and in the import sheet
(which now uses the same `facePieces`), each new part keeps the
colour of its face, the selection follows the parts and the level goes from
*Faces* to *Part*. The action shares `replaceByPieces` with *Separate by
material*. In addition, box selection (see **U7**) picks whole faces.
29 new tests (`tests/faces.test.ts`: plate, plate with duplicated
vertices, cylinder with caps, flat-fillet-wall profile, marked
edge, CAD ranges, separated parts; the mutations are counted in
**U7**); captures `docs/ui/box-faces.png` and
`docs/ui/material-drag-faces.png`; checked in the browser with
`tests/fixtures/box.step` (six CAD faces).

**What did not fit the plan:**

- **Edge limit with smooth curvature (pending judgement call for
  Fable).** The curvature estimate only counts the edges that
  could be crossed (test *a flat face is flat to its rim*): if it also counted
  the ones that are a boundary (marked or sharper than 30°), a
  triangle on the edge of a flat face, next to a wall, would measure the
  curvature of the corner and the face would escape through a chamfer. What remains
  is the case that a click on a mesh cannot distinguish: a triangle on the edge of a flat face whose only
  turning edge is a smooth fillet (a few degrees per step)
  looks like a facet of a curved face, and the face follows the fillet; the
  interior of the same flat face does not. It does not affect STEP or IGES (the
  ranges do not hesitate) and the header of `faces.ts` explains it. Data to
  decide whether it is enough or a mesh criterion is needed (for example,
  measuring the curvature inside the region already picked): nothing has been
  changed unilaterally.
- **Loose `Shift` and `Shift` adds.** M1 asked for "`Shift` gives the
  single triangle" and `UI.md` §4.1 "`Shift` adds": at the *Faces* level,
  `Shift` does both, `Shift` click **adds the single
  triangle**. Since `Shift` only makes the triangle single and the other
  keys keep their meaning, `Ctrl/⌘ ⇧` click toggles it and `Alt
  ⇧` click removes it (with *Alt + left button orbits*, where `Alt` belongs
  to the camera, there is no `Alt ⇧`); `Ctrl/⌘` and `Alt` without `Shift` act
  on the whole face.
- **The face box works on a single part** (`Selection.faces`
  is `{part, indices}`): the selected one and, if there is none, the one at
  the centre of the box. Without *X-ray* it only picks what is visible, measured
  with an identifier pass of the viewport (one id per triangle, with
  a one-pixel erosion so that the silhouettes of hidden things do not
  count), so a face narrower than about 3 px is not picked; with
  *X-ray* it also picks the hidden ones, by geometry.
- ***Separate by CAD faces* only exists for parts with ranges** that
  cover the mesh (`canSeparateByFaces`); on a mesh without them it stays
  disabled instead of splitting by continuity.
- **The counter says *faces* and counts triangles** (`inspector.faces`:
  a whole six-CAD-face cube says *12 faces of* its part): the data
  model stores triangles. Counting CAD faces requires also storing
  which ranges were picked; noted for later.
- **A click does not tint the face before picking it**: when hovering without
  dragging anything, at the *Faces* level only the part is outlined; the face
  is seen when it is picked. The preview tint is only that of the
  dragged material.
- The help that `UI.md` called `faceSel.help` does not exist under that
  name: it was `level.tip.FACES`, which no longer says "coming soon" (it was
  rewritten), and `ops.separateCadSoon` was removed.
- Fixes for failures that were already there: the inspector was not rebuilt when
  the first face was picked (`contextKey` did not distinguish whether there were faces;
  with a test), and `material/assign` without changes created an empty undo
  entry (it now returns the same state; with a test).

## U9 · Primitives and scale tool — **Opus** — done

**Request (2026-10-13):** add simple geometries (base rectangles,
cylinders, spheres…), plus the usual scale section alongside panning,
besides being able to scale each part with a right click.

**Lead's decisions.**
- **Add ▸ Primitive** (the *Add* menu in the header, the `+` button of the
  *Scene* panel, the command palette and the viewport's context menu on
  empty space): *Box* (with bevel radius), *Plane*, *Disc*, *Cylinder*,
  *Pedestal* (bevelled cylinder), *Sphere*, *Cone*, *Torus*, *Capsule*,
  *Tube*, *Steps* and *Infinity sweep* (the studio curve: a floor that
  rises in a curve into a wall). Stable keys in a data catalogue.
- **Parametric and live**: each primitive stores its type and its measurements in
  mm (width, depth, height, radius, bevel, segments…), editable in the
  inspector (*Primitive* section); changing a measurement regenerates the mesh with
  **one store action** and one undo entry (a drag, a
  single one). *Convert to mesh* freezes it.
- **Default size and place with a studio criterion**: it is created resting
  on the floor, next to the product or below it if it is a base (the *Box* and
  the *Pedestal* are born as a base: 1.4 × the product's footprint and the product
  resting on top), scaled to the scene; without a product, at a reasonable
  size. Neutral material from the catalogue.
- **Clean geometry**: pure, deterministic generation in `src/core/`,
  correct normals and UVs (for M2), smoothing by angle, and **CAD faces**
  (`faceRanges`) per logical face (the cap, the side, the bevel…), so
  that the *Faces* level and M1 work with them.
- **Project**: the primitive is saved as parameters (not as a mesh) in
  an optional field of the node; *schema* 2 remains valid and an old project
  opens the same. The engine receives it as one more mesh (RSB
  unchanged).
- **The *Scale* tool** (`S`) in the view bar, next to
  *Pan*: the same gizmo as *Move* but with only the scale handles
  (per axis and uniform at the centre), around the pivot, in local
  or global axes, with increments with `Shift`; the inspector shows
  the scale live. One drag, one undo entry.
- **Right click ▸ Scale…** on a part (viewport and tree): an inline
  panel with *Uniform* (%), per axis (X, Y, Z in %) or **to size** (mm of
  width, depth or height with locked proportion), *Apply* and *Reset
  scale*; it acts on the selection at the current level.

**Acceptance.** Tests of each primitive (closed where it must be, normals
outwards, UVs in [0, 1], `faceRanges` that cover the mesh, determinism,
exact measurements in mm), of the undoable regeneration, of saving and
opening, of scaling per axis, uniform and to size (around the
pivot, at each level); captures of the menu, the inspector and the
tool; strings in `es` and `en`; achromatic chrome.

**Done.** `src/data/primitives.json` (+ `primitives.ts`): the twelve shapes
with stable keys (`BOX`, `PLANE`, `DISC`, `CYLINDER`, `PEDESTAL`,
`SPHERE`, `CONE`, `TORUS`, `CAPSULE`, `TUBE`, `STEPS`, `SWEEP`), their role
(`BASE`, `FLOOR`, `BACKDROP`, `OBJECT`), their measurements (keys, minimums,
steps, scene-size factor or fixed value) and the neutral material
`WHITE_STUDIO`; the names and the labels of the measurements are interface
strings. `src/core/primitives.ts`: pure and deterministic generators,
in mm, Z up, **centred on their box** (which is exactly their measurements:
exact sines and cosines at multiples of 90°, no `h − b + b`), with
a builder that orients each triangle towards its normals and removes
slivers; surfaces of revolution with per-segment poles (the tip of the
cone has the normal of its facet), a rounded box with edges and corners
that meet bit for bit (symmetric quarter-turn table),
steps on a grid without T-junctions, unrolled infinity sweep;
watertight except plane, disc and sweep; surface normals within
each logical face; UVs in [0, 1] per face and unstretched; each logical face is
a `faceRanges` range (and its edge, a sharp edge), so *Faces*, M1 and
*Separate by CAD faces* work; measurements bounded to what a shape allows;
the mesh id `prim:<owner>:<SHAPE>:<measurements>` names content and owner.
`src/core/primitive-ops.ts`: `placePrimitive` (base 1.4 × the footprint under
the product, with the product on top; planes under it, one thousandth above the
floor; the rest next to whatever stands; without a product, at the origin and
framed), `fitSweep` (the lead's decision during the phase, after seeing the
first captures: the infinity sweep facing the active camera, rotated about
Z to its azimuth, the wall at 1.75 depths from the product behind it and behind
the setup's lights that sit behind the product
(`wallBehindLights`), width 1.3 times the framing where it touches it, above
the top of the framing, curve of 0.3 times the height;
*Fit to camera* redoes it with `scene/fitPrimitive`), and the actions `scene/addPrimitive` (one
undo entry with the lift), `scene/setPrimitive` (regenerates, keeps the
support, drags the linked copies along, the per-face materials and the selected
faces follow their faces by name) and `scene/convertPrimitive`.
`SceneNode.primitive` is the optional project field: `io/project.ts`
does not write those meshes and regenerates them on opening (schema 2, byte for byte).
*Scale* tool (`S`, next to *Pan*): the gizmo with only
scale handles (`Gizmo.setMode('SCALE')`, cubes at the end of whole axes
that can be grabbed, and the central point; one more cube length doubles);
*Right click ▸ Scale…* with `ui/panels/scale-panel.ts` (uniform, per
axis, to size with a lock, *Apply* and *Reset scale* =
`scene/resetScale`) in the viewport and in the tree; `selectionExtents` measures the
selection in the axes in force. *Add ▸ Primitive* in the header
menu, the `+` of the *Scene* panel, the palette (*Add box*…) and the viewport
menu on empty space; *Primitive* section of the inspector with *Convert to
mesh*, which is also in *Geometry ▸*. Tests: `tests/primitives.test.ts`
(each shape: same bytes, exact and centred box, UVs, normals, faces that
cover the mesh, watertightness, sharp edges, analytic volumes, bounded
measurements, id) and `tests/primitive-ops.test.ts` (placement, base and footprint,
product on top, one undo entry, locked product, planes and
sweep, the light pivot and the scale that do not see the set dressing, live editing and
undo, linked and independent copies, painted and
selected faces, convert, save and open byte for byte, unknown shape and
out-of-range measurements in a file, uniform scale, per axis (also in
local axes) and to size around the pivot at the *Model*, *Group* and
*Part* levels, *Reset scale*, the *Scale* handles, the shortcut and the
strings). `tools/primitives-check.mjs` checks it in the browser in
*Fast* and *Full* and takes the captures `docs/ui/primitives-add-menu.png`,
`primitives-base-box.png`, `primitives-pedestal.png`,
`primitives-pedestal-full.png`, `primitive-inspector.png`,
`scale-tool.png` and `scale-panel.png`, and it also checks with pixels
that the infinity sweep fills the framing (corners and centre of the top edge
light, not the dark dome) and that *Fit to camera* refills it
after orbiting. 133 new tests (91 in `primitives.test.ts` and 42
in `primitive-ops.test.ts`; 1627 in total); 42 mutations of the new code,
all detected (five were not at first: the UV clamping
hid a bad mapping and was removed, and the cone tip's normal, the
per-face materials that shift, what stands next to a sweep
and a sweep that moves away along its curve had no test or had one that was too
permissive; the tests were fixed).

**What did not fit the plan:**

- **The product, not the set dressing.** An infinity sweep six times larger than
  the product moved the lights' pivot (`rigPivot` was the centre of the
  scene), the framing of *Create studio*, the measured size (and the Doctor's
  scale check, whose fix would rescale everything) and the shadow
  map. Now all of them measure `productBounds`: the parts that are not
  primitives (if there are only primitives, all of them). It is an architecture
  criterion that was not in the plan; *Frame all* still
  frames everything. If Fable prefers to mark the set dressing another way (for
  example, only bases and sweeps, not any primitive), it is a change to
  one function.
- **The part size** is now also detected when the first product enters a
  scene that only had primitives (before, only in an empty
  scene).
- **Centred meshes, not resting on their origin**: the Doctor warned of an
  off-centre origin on every primitive and its fix moved it. The
  part keeps its support when changing measurements by the centre of the base of
  its box, in its own axes.
- **Planes, discs and infinity sweeps one thousandth above the floor**: their top
  face is where the studio floor is, which in the engine is a *shadow
  catcher*, and a distance tie between the two flickers. Above it,
  the geometry wins, and it receives real shadows in *Full*; in
  *Fast* the contact shadow stays under the sweep (the preview only
  draws it on the floor). The studio floor is not switched off when adding
  a sweep: that is a photographic decision (Fable).
- **A version prior to U9 does not see the primitives** of a new project
  (there is no mesh in the file; it opens with the missing-geometry warning):
  compatibility is backward, as requested.
- **Changing the measurements of a base does not raise the product again**, and
  a new base under a product that already sits on another goes to the floor (the
  product rests on the new one). A part scaled with *Scale* still
  shows its unscaled measurements in the *Primitive* section (the note
  says so).
- **Flip normals, Smoothing and Separate freeze the primitive** (they stop
  being parametric), because their mesh is no longer the one of their measurements.
- **The infinity sweep fits the camera**, not the world axes
  (the lead's request mid-phase): the first captures let the dark
  environment show in one corner of the framing. If the curve would reach under
  the product (a very flat product in depth), the wall moves further than
  the 1.75 depths. Moving the camera afterwards does not readjust it on its own: that is what
  *Fit to camera* is for. The test casts rays through a 7 × 7 grid
  of the framing in eight cameras (front, top-down, orthographic, tele in
  portrait, square wide angle, a thin product) and all of them hit the
  sweep.
- **An infinity sweep covered the lights that sit behind its wall
  (decided by Fable mid-phase).** With the *Standard* setup and the
  reference camera, the backlight (*RIM*, 70 W, about 290 mm behind
  the product) ended up behind the wall, which was at 154 mm: in
  *Full* the wall blocked it and the image came out flatter and greyer than in
  *Fast* (the preview does not cast shadows from lights). **Decision:** a
  photographer places the paper far enough back for the backlight and the
  rear lights to fit between the product and the backdrop, so the light that
  the owner chose keeps working. `fitSweep` (when adding and in
  *Fit to camera*) moves the wall behind each lit light of the
  setup that is behind the product according to the camera's direction, to
  1.25 times how far that light is behind the centre of the product plus half
  of its panel (`SWEEP_FIT.lights`, `wallBehindLights`; a sun does not
  count), and then computes width, height and curve to cover the framing at
  that distance as before. In the reference view the wall goes from
  154 mm to about 480 mm. Rear lights that end up inside the framing
  are outside this decision. Test: with the *Standard* setup and the
  reference camera no light is left behind the wall (it fails with the
  old distance), and without lights behind it the wall is again at 1.75
  depths.
- **The name of *Add*.** There is no *Add* menu of its own in the header
  (UI.md §2.1 lists nothing beyond the application menu): it is an *Add ▸* entry of the application
  menu, with the label *Primitive* and the twelve shapes below it.
- *Scale…* in the context menu shows no shortcut (`S` switches the
  tool on, it does not open the panel). The modifiers of the selection box and of the clicks
  are those of *Move*.
## U10 · Guided tour and AI notices — **Sonnet** — done

**Request (2026-10-13):** warn if the *inference runtime* is not installed;
on the first launch of the app, a tutorial that can be skipped but that
guides through all the options; when installing, if the AI is selected,
ask to install the *inference runtime* too.

**Lead's decisions.**
- **Guided tour** on first launch (and from *Help ▸ Guided
  tour*): a layer of its own (never browser windows) that highlights
  each area in order — header and menu, tree and selection levels,
  view tools (Select, Move, Scale, Orbit, Pan,
  Zoom, box with `Ctrl`), *Fast/Full*, inspector (product, light and
  setups, environment and sky, camera and click-to-focus, materials and
  dragging), tabs for lights, cameras and studios, *Add ▸ Primitive*,
  render window (queue, AI), results viewer and *Settings* by
  sections — with a short text per step, *Next · Back · Skip*,
  progress dots and keyboard (`→`, `←`, `Esc`); in `es` and `en`;
  achromatic; it uses the `data-guide` attributes that already exist. Whether it has been seen is remembered in the platform state
  (data folder on desktop); *Skip*
  counts as seen.
- **AI runtime notice**: if there is an AI model and the AI
  runtime is missing (or Visual C++ is missing), the AI section of the
  render window and *Settings ▸ AI post-processing* say so with an
  *Install* button; at startup, a discreet note in the status bar, only
  once per session.
- **Installer**: if any model is chosen in the *AI models* step, the
  **AI runtime** recommended for the machine is also ticked
  (Vulkan with a GPU, CPU without one), it can be unticked, and the app
  downloads it on first launch like the models (the rule from P2: the
  installer chooses, the app downloads). The same in the first-launch
  chooser of the portables.

**Acceptance.** Tests of the tour order (every step points at something
that exists; no step points at a hidden element), of *Skip* and of
the memory (it does not come back; it does from *Help*), of the notice with and without an AI
runtime, of the installer's choice file with the runtime
included (and of the NSIS script that writes it); captures of three steps and of the notice.

**Done.** *Guided tour* (`src/ui/tour.ts`, `src/ui/panels/tour.ts`,
`src/ui/tour.css`; `UI.md` §4.7): 30 steps on the web and 31 on desktop,
in the order above (welcome, menu, parts and levels, tools,
*Fast/Full*, product, light, environment, camera, materials, the three
tabs, *Add ▸ Primitive*, *Render…*, render window, queue, AI,
results, one Settings section per step and the closing), with short text in
`es` and `en`, *Next · Back · Skip*, one dot per step and `→ ← Esc`. It is
modal (it keeps the pointer and all the keys: `Del` does not delete beneath
it), achromatic, and locates the areas by the `data-guide` attributes (those of the guide and
the new ones). A step whose area is not in view brings it into view (tab, side
panel —in a narrow window only the one that is needed—, render window
or Settings window, *Queue* drawer, material catalogue, selection) and when everything finishes
everything goes back to how it was; a step whose area does not appear within 0.7 s is skipped.
The card goes beside the area, outside the render window or
Settings when there is room and, if not, inside, where it does not cover any control.
*Skip*, *Done* and `Esc` count as seen: `layout.tourSeen` in the
settings document (the data folder on desktop, nothing in browser
storage there). It appears only on first launch, after the
model chooser of a portable, and from *Help ▸ Guided tour* (a new
submenu of the application menu, and the palette).

*AI runtime notice*: `runtimeWarning` (`core/ai-runtimes.ts`, pure)
says what is happening with an installed model —missing, paused, downloading, does not
start, Visual C++ missing on Windows, no build for the system—;
`ui/ai-runtime-state.ts` holds the single launcher probe; the box with
*Install · 26 MB* (the flow of the runtime row in Settings), *Resume*,
*Pause*, *Install Microsoft Visual C++ runtime…* and *Check again*
appears in the AI section of the render window (with a mark on its
collapsed title) and at the top of *Settings ▸ AI post-processing*, and the status bar
carries a discreet note once per session. **Installer**: `repackshot
--hardware` writes `[runtime]` (the build chosen by the rule in
`ai-runtimes.json` for the system; with `--device cpu`, the CPU one), the
*AI models* step ticks the box when the first model is chosen, it can be
unticked and writes `"runtime"` into `pending-models.json`; the launcher
downloads it on first launch (`Ai::start_pending_runtime`); the first-launch
chooser of a portable offers it equally and downloads it with the first
model. Tests: the rule, the notice table, the probe, the note once per
session and the buttons (`tests/ai-runtime-warning.test.ts`); the tour
order, that each anchor exists in the code, that each step opens what it
needs and gives it back, *Skip* and what is remembered, when it starts, the keys, the
card and the texts in both languages (`tests/tour.test.ts`); the NSIS script read
as text against the launcher (`engine/crates/rt-app/tests/installer.rs`,
`tests/installer-page.test.ts`); the launcher downloading what the installer
left, over sockets with the real `curl` and a local server, and downloading
nothing with a key from another system, an unknown one or one without a runtime
(`tests/ai.rs`). Browser checks: `tools/tour-check.mjs` (the whole
tour, wide, narrow and in Spanish, with its captures) and
`tools/ai-runtime-check.mjs` (against the real launcher: chooser, notices, note,
Visual C++ and the state in the data folder). Each test fails if what it guards
is broken. Captures in `docs/ui/`: `tour-tools.png`,
`tour-camera.png`, `tour-render-ai.png`, `tour-settings-es.png`,
`ai-runtime-warning-render.png`, `ai-runtime-warning-settings.png`,
`ai-runtime-warning-vc.png`, `ai-runtime-chooser.png`, `ai-runtime-note.png`.

**What did not fit the plan.** (1) The installer's *Run on the processor*
was not applied to anything: so that the runtime the installer ticks is the one
the application expects, the first launch turns it into *Settings ▸
AI post-processing ▸ Run on* (`applyInstallerChoice`); this is a decision
that was not in the plan. (2) The installer page cannot be seen here
(*makensis* compiles it with `-WX`, but Wine does not run an NSIS installer):
its logic is covered as text, and it remains to check on a real Windows that the new
row fits on the page with six two-line models. (3) The download
of the runtime from the installer, end to end, cannot be
tested here either; the launcher (sockets) and the page (real launcher) can. (4) A missing
Visual C++ cannot be produced on Linux: the browser tests it with the
launcher's response altered. (5) The card of a Settings step goes
inside the window, where it covers no control but does cover description text; a section that is all controls would put it in the lower right corner.
(6) Whoever updates from an earlier version sees the
tour once (there is no earlier mark to distinguish it from a first
launch). (7) *Help ▸* groups what used to be three separate entries
(*Guide*, *Shortcuts*, *About*); the six-step *Guide* stays as it was and
the tour does not replace it. (8) With the models still downloading (the
installer left them pending) there is no notice: "there is a model" means an
installed model.

## M2 · Image textures and labels — **Opus** — superseded by M2a and M2b

**Note (Fable, after v0.1.5).** This phase is split into M2a (no engine:
import, slots, labels, preview and RSB contract) and M2b (the
engine), defined further up in “Materials and sets with an effect”. The following text
is kept as the origin.

**What.** Colour, roughness, metal, normal and alpha textures with
box, planar, cylindrical and UV projection, scale, rotation and offset; labels:
an image with alpha projected onto an area of the part,
placed with click and drag, with its own finish (a different gloss from the
substrate). It is the most used feature in packaging and cosmetics. The
images travel to the engine as RSB sections of their own.

**Depends on.** E5.

**Acceptance.** Capture with a labelled bottle; box projection test
(a cube receives the texture unstretched on all six faces); the project
saves the embedded images.

## N1 · Animation and video in the KeyShot style — **Opus** — done

**What.** Replace the editor from U1 (shots + cards) with the model of
`SPEC.md` §3.7 and the interface of `UI.md` §2.5, which follow how
KeyShot's works: a single timeline with **one track per target** and
draggable, stretchable **bars**; the **camera track** with spans
of active camera and **camera change** events (cut or fade to
colour); the **animation wizard** in three steps (type in a grid of
grouped cards, target, parameters) inline in the inspector; the
**animation inspector** with timing curve (including *custom*
with two handles), reverse and repeat; the animations **under their target
in the tree**; playback with playhead, fps, loop and fast preview.
New types in `src/data/animation.ts` without renaming the existing ones:
`FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC` (the latter is enabled with E5),
`PATH` reserved. A complete `evaluate(state, t)` for all types,
composition per target and visible conflicts; exploded view (centre,
layout, factor). Migration of the U1 state: the shots become
spans of the camera track and the movements become bars, losing nothing
(test with a saved U1 project). **Output**: *Animation* mode in
the render bar (range, fps, video or frames, per-frame budget,
estimate), one RSB per frame rendered by the worker pool,
encoding in the browser (WebCodecs → WebM/MP4; PNG/JPEG sequence as an
always-available alternative), animation jobs in
the queue. The *rendered preview* (engine at a few samples per frame)
and the crossfade are left for later and marked *coming soon*.

**Depends on.** U1, U3 (the pivot and the local axes of rotations),
E4 (for the rendered output; the timeline and the fast preview
do not depend on it and can go earlier).

**Acceptance.** `evaluate` tests with numbers (a 90° orbit in 4 s at
the midpoint with *soft* gives 45°; rotation with a pivot on another part keeps
the distance to that pivot; `FADE` reversed and repeated 2 times gives the
expected value at 5 instants; a custom curve with handles at (0.42, 0) and
(0.58, 1) matches the reference one ±1e-3); the 16 presets produce
a valid state at every frame; a bar dragged on the
timeline produces a single undo entry; the U1 project migrates with
the same result at `t = 2 s`; a 2 s video at 12 fps comes out and
plays; capture of the timeline with three tracks and the wizard
open at step 1.

**Do not touch.** The existing keys of `MOVE_KINDS` and
`SEQUENCE_PRESETS` (they are added to, not renamed); the engine (`engine/`).

**Audit at the start** (on `main` at v0.1.15, point by point from the
brief and the acceptance criteria; N6 and U5 had already built part of it):

| Point | State at the start | From which phase | What N1 did |
| --- | --- | --- | --- |
| A timeline with one track per target and draggable, stretchable bars | Done | N6: tree of what is animated + lanes, magnet, one drag = one undo entry | Nothing to redo; new rows for materials |
| Camera track with spans of active camera | Done | N6 (spans, draggable edge, the shot's camera in its menu) | Click on a span: its properties |
| Camera change: cut or fade to colour | Partial: only the implicit cut at the edge of a shot | U1, N6 | `Shot.transition`: cut or fade to black or white with duration; shot properties, mark on the track, the viewport and every frame |
| Three-step wizard (type in a grid of grouped cards, target, parameters), inline | Partial: three sections at once, the type in a list | U1; N6 put the selection's target | Three steps with *Back* and *Next*, the grouped card grid; target first (N6's order) |
| Animation inspector: timing curve, *custom* with two handles | Partial: curve with preview, no custom | N6 | `CUSTOM` with the two-handle editor |
| Reverse and repeat | Done | N6 (`reverse`, `repeat`) | Tested in the `FADE` criterion |
| The animations under their target in the tree | Missing | — | Under parts, groups and the model |
| Playback: playhead, fps, loop, fast preview | Done | U1, N6 | The fades, colours and the sun in the fast preview |
| Types `FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC`, `PATH` reserved | Missing | — | All five, at the end of `MOVE_KINDS` |
| Complete `evaluate`, composition per target, visible conflicts | Partial: the types of the time; conflicts marked | U1, N6 | The new types, the pivot of a rotation, the material target |
| Exploded view (centre, layout, factor) | Done | N6 | — |
| Migration of the U1 state (shots to spans, movements to bars), with a U1 project | Partial: N6's model is U1's (shots and clips) and it is read; no test said it reproduces the same | N6, U2 (`project-v1.json`) | Test with `project-v1.json` against the poses that U1's code gave |
| Output: *Animation* mode (range, fps, video or frames, per-frame budget, estimate) | Done except the video | U5 | The video |
| One RSB per frame rendered by the pool | Done | U5 | — |
| Encoding in the browser (WebCodecs → WebM/MP4), sequence always available | Missing (*coming soon*); the Doctor's `output` dormant | U5, D1 | WebCodecs, own muxers, the Doctor connected |
| Animation jobs in the queue | Done | U5 | Video jobs |
| Rendered preview and crossfade: *coming soon* | — | — | They remain *coming soon* |
| Criterion: 90° orbit in 4 s at the midpoint with *soft* gives 45° | Done | U1 (`tests/animation.test.ts`) | — |
| Criterion: rotation with a pivot on another part keeps the distance | Missing (there was no pivot) | — | `tests/animation-n1.test.ts` |
| Criterion: `FADE` reversed and repeated 2 times, 5 instants | Missing | — | Ditto |
| Criterion: custom curve (0.42, 0) and (0.58, 1) ±1e-3 | Missing | — | Ditto (against the test's own bisection) |
| Criterion: the 16 presets give a valid state at every frame | Done | U1 | Extended to the new fields of the pose |
| Criterion: a dragged bar is one undo entry | Done | N6 (test and `tools/animation-check.mjs`) | The same for a curve handle and a fade |
| Criterion: the U1 project migrates the same at t = 2 s | Missing | — | `tests/animation-migration.test.ts` |
| Criterion: a 2 s video at 12 fps comes out and plays | Missing | — | `tests/video.test.ts` and `tools/video-check.mjs` |
| Criterion: capture of the timeline with three tracks and the wizard at step 1 | Missing | — | `docs/ui/animation-n1-wizard.png` |

**Done.** What was missing or half done, without redoing N6's or U5's work:

- **New types** (`src/data/animation.ts`, added at the end; the 17 keys from
  before, untouched): `FADE` (the amount is the **final opacity** in %, by
  default 0; reversed, it appears; those of a node and its groups multiply),
  `PAN` (the camera turns where it stands: its target goes around its
  position; positive, to its right), `MATERIAL_COLOR` (the base colour of a
  material, from the one the earlier clips left, towards the clip's),
  `SUN_ARC` (the sun turns around the celestial pole, 15° per hour: the first
  sun light that is lit or, without it, the sky's own sun) and `PATH`, only in the
  catalogue (`RESERVED_MOVES`: nothing offers or plays it). `CUSTOM` is added to
  `EASING_KINDS`; `MOVE_GROUPS` gives the wizard its groups. A new target,
  `MATERIAL` (`ClipTarget`), and with it all the parts that wear it
  (`partsWearing`).
- **Rotation with pivot** (`MotionClip.pivot`): `SPIN` and `TUMBLE` of a part or
  group around the centre of another part or a point, about its own axis (Z or
  X), done in the world and returned to the parent; without a pivot, exactly what it was before.
- **Custom curve** (`src/core/curve.ts`): two-handle cubic Bézier
  (x in 0..1, y in −0.25..1.25), Newton from the phase and bisection where the curve
  goes vertical. Editor in the properties (`ui/components/curve-editor.ts`):
  drag with one undo entry, arrows, and its four numbers.
- **Camera change** (`Shot.transition`, `shotFadeAt`): cut or fade to
  black or white (0.04–10 s, 0.5 s by default) centred on the cut, with the soft
  curve and never longer than half of either of the two shots; on the
  first shot, a fade-in. Shot properties on clicking its
  span, mark over the cut on the track, the colour over the viewport frame
  during playback, and in every rendered frame (`src/core/fade.ts`: on the values
  of an 8- or 16-bit image, in linear light in EXR, 32-bit TIFF and DNG).
- **The engine untouched**: the RSB scene (`src/io/rsb.ts`) carries the fades
  as coverage (one copy of the material per opacity, with its wood or
  fabric pattern and its program; an emitter lowers its emission; at 0 % the part is not there), the colour
  of a posed material and the moved sky sun. Without new animation, the same
  bytes as before (the parity tests remain pinned).
- **Fast** (`src/render/fade-preview.ts`): the shared material set as the clip
  leaves it (and returned to its instance afterwards), a translucent copy for
  each part that fades, the arc's sun in the sky and in the lights.
- **Three-step wizard** with the card grid (icon, name, phrase),
  grouped into *Parts · Camera · Light and environment · Materials* with the target's
  group first; *A material* as a target; the colour in step 3.
- **Under their target in the scene tree**: the animations of a part or
  group under it, those of the model under the model, with their icon and short phrase;
  a click opens the drawer with it chosen.
- **Encoded video** (`src/io/video.ts`, `webm.ts`, `mp4.ts`; ARCHITECTURE
  §5.4 ter): WebCodecs queried at run time (WebM with VP9 or VP8, MP4
  with H.264 *Constrained Baseline* at the level the size requires), own muxers
  from the public specifications, a video job in the queue that passes each
  frame to the encoder and saves **one file**; the render window only
  offers what the system encodes (the rest disabled with its reason). In the
  Chromium here: **VP9, VP8 and AV1 yes, H.264 no**.
- **Doctor** (`output`): `EngineFacts.videoCodecs` comes from the browser's
  response (`ui.video`, `encodableCodecs`) and the check warns **only** of a
  video with a container that this system does not encode (fix: frames); the
  D1 tests were rewritten with that (a video that can be encoded is no longer a
  warning), and a new one follows the browser's response down to the warning.
- **Drawer accessibility** (what the H1 review left for this phase): the
  presets are buttons again, each inside a `listitem` element of a
  named list; the tree of what is animated (`role="tree"`, with a name and focus)
  says which row is active with `aria-activedescendant` (each row with its `id` and
  `aria-selected`) and **↑ ↓** go to the animation above or below; the ruler,
  which is inside the tree, is left to the pointer (`aria-hidden`, without a label;
  its help remains) because the playhead already moves with the keyboard from the tree.
  `tests/a11y-timeline.test.ts` (4, in Chromium like the H1 one) and a test of the
  keys.
- **The fade mark** on the camera track covered the beginning of the next
  shot's name and used the requested duration even though the frames cut it to half
  of a shot: `shotFadeSpan` (core) is now the span used by the
  frames (`shotFadeAt`) and the track, and the shot name starts after the
  mark (one test of the span and one in Chromium, which fail without the fix).
- **Gallery**: the four captures, with their entry in `docs/GALERIA.md` under
  *Unreleased* (by version and by feature) and a row in “Without capture” with what
  of N1 has no image (the fade in the viewport and in a frame, a part that
  fades, the pivot, the solar arc, a frame of the video and the MP4).
- **U1 migration**: `tests/fixtures/u1-hero-poses.json`, taken with U1's
  `evaluate` (commit `67b9154`) on `project-v1.json` at 0, 2, 5.5 and 9 s;
  the project opened today reproduces the same to 1e-9, with its shots as spans and
  its movements as bars.

Tests: `tests/animation-n1.test.ts` (21: pivot on another part and on a point,
also with a parent away from the origin; `FADE` reversed and repeated at five
instants, its multiplications and its partition; `PAN`; `MATERIAL_COLOR`;
`SUN_ARC` and its angle to the pole; the curve against the test's own bisection, also
with handles at the extremes, and its drag as one undo entry; the track's fades,
their span and their pixels; the 16 presets at every frame; the wizard, the
shots and the materials), `tests/animation-migration.test.ts` (2) and
`tests/video.test.ts` (12: the two containers re-read by separate readers, a
2 s video at 12 fps of 24 frames, the writer with a fake encoder, a
queue job through to the file, and real frames from libx264 and libvpx in
our MP4 and WebM read by ffprobe where the machine has ffmpeg). Mutations:
**48**, all killed (in `evaluate` of the new types and of the pivot, in the curve,
in the two muxers and the writer, in the video queue, in the Doctor, in the
drawer accessibility and in the fade mark); one survived
at first (removing the return to the parent of the rotation with pivot: the lid's parent is
at the origin) and was killed with a test on the body, which hangs from the model.
In the browser, `tools/video-check.mjs` (Chromium with real WebCodecs): the
codecs, a 2 s video at 12 fps through the application's writer in VP9
(18,760 bytes) and in VP8 (6,798 bytes) read by ffprobe (24 frames, 2 s,
320 × 180), the three-step wizard, a fade to black, a handle dragged and
undone, the fade in the viewport, and an application render in WebM VP9 of 48
frames (2 s at 24 fps, 160 × 90) read by ffprobe; captures
`docs/ui/animation-n1-wizard.png` (the timeline with three tracks and the
wizard at step 1), `animation-n1-cards.png`, `animation-n1-curve.png` and
`render-window-video.png`. The Rust engine was not touched. Gates, with `main`
merged (H1 and the gallery) and `rt.wasm` built: `npm run qa` green (169
files and 2907 tests pass, 4 files and 6 tests skipped; at the start 161
and 2836 passed, and H1 brings its own) and `npm run engine:test` green (1098 pass, 11
ignored), as before.

**What did not fit the plan** (rule 12; what is marked ◆ is a **Fable**
judgement call, who decides whether it changes):
- ◆ **The wizard order.** The brief asks for type → target → parameters; N6
  delivered target first (*+ Animate Cap…* brings it filled in) and it stays: step
  2 is the grid, with only the types of that target and its group first.
- **One track per target with bars**: N6's model stays (one row per
  target and, below, one per animation; collapsed, the bars of all of them in the
  target's row), which was already accepted.
- ◆ **What a fade is**: the amount is the final opacity and appearing is the
  reversed fade (the SPEC said “from 0 to 1 or from 1 to 0”). In the engine it is a
  stochastic coverage (with few samples it looks like a dither) and an emitter lowers
  its emission, because the engine does not give coverage to emitters; in *Fast*, a
  translucent copy without depth writing.
- ◆ **The solar arc**: a fixed pole behind the product at 45° elevation, in the frame of
  the lights (`SUN_POLE_AZ`, `SUN_LATITUDE`); the latitude and where north is
  are not part of this phase.
- ◆ **The fade to colour**: centred on the cut, half in each shot, soft curve,
  never more than half of a shot; the fade-in only on the first one, and there is no
  fade-out at the end of the animation. It is blended in the pixels after
  the engine: in the linear formats, towards the colour in linear light with the
  exposure (white is 1, which with *Filmic* or *AgX* is not the white of the
  image).
- ◆ **Video quality**: UI.md said *with quality*; there is no knob, it is
  automatic (about 0.1 bits per pixel, from 1 to 50 Mbit/s). No alpha and no sound.
- **H.264** only *Constrained Baseline* (no B-frames, so the MP4 does not need
  `ctts`); the open-source Chromium here does not encode it, so the MP4 was
  tested in Node with real libx264 frames and ffprobe, not with WebCodecs.
  WebM falls back to VP8 where there is no VP9; AV1 is not offered even though Chromium encodes it.
- **The window's fps** are 24, 25, 30 and 60: the 12 fps video of the criterion
  comes out through the application's writer (the test with the fake encoder and the
  browser with the real one); the whole application path was tested at 24 fps.
- **A video is saved at the end**: a stopped job leaves nothing; job plugins
  do not go through its frames and the history saves the first one as PNG
  (`ResultMeta.video` says which video it belongs to).
- **D1's notice “a file that a failure loses entirely”** is removed: the brief
  says that `output` should warn only of a codec that is not encoded (that was D1's ◆).
- **Pivot**: the axis is the target's own (Z or X); the free axis is not
  built. If the pivot part moves, the pivot does not follow it (it is taken at rest).
- **Material colour**: the base colour of the *Simple* parameters; a node-based
  material (M3a) does not change colour, neither in the engine nor in *Fast* (it does fade).
- **Under their target in the tree**: only parts, groups and model; those of camera,
  lights, environment and materials are seen in the timeline.
- The *quick sweep* of the motion library (A6) is still an
  orbit; the variant with `PAN` is pending.
- `ease()` in `light-math` treats `CUSTOM` as linear: a clip's curve lives in
  `clipCurve`, which is the one that uses it.
- `tools/render-window-check.mjs` stops at its step (g) (after choosing *Copper* in the
  palette, Ctrl+Shift+Enter does not start the render and waits until timing out); it passes
  the same on a `main` build without N1 (`3096821`), so it is not from this phase and
  is not touched here. That is why `render-window-animation.png` (U5) has not been re-recorded and
  still shows the video as *coming soon*; the current state is in
  `render-window-video.png`.
  *Resolved later, outside this phase*: the failure was in the tool, not in the
  interface. It closed the results viewer with Esc right after the JPEG download
  started, before the job finished and the viewer opened; that Esc reached the
  scene and deselected the body (`Esc` deselects, UI §2.3), so *Copper* asked for
  *Replace all* inside the palette, which was still open (it is modal) and swallowed
  Ctrl+Shift+Enter. It happened or not depending on timing. The tool now waits for the viewer,
  checks the selection and that the palette closes, and `render-window-animation.png` and the
  other three U5 captures were re-recorded.
- **The timeline ruler** is not a `slider`: it is inside the tree, which
  can only contain its rows, and the playhead already has the keyboard (Home, End,
  ← →) from the tree; it is hidden from assistive technology. If a dedicated control
  for the playhead is wanted, it goes outside the tree (another drawer structure).
## N2 · Queue, passes and batches — **Sonnet** — done

**What.** Render queue with progress and cancellation on top of the engine's `render()`;
alpha, depth, normals and part-id passes as optional integrator outputs
(`RNDR` section with a pass mask; 16-bit PNG or EXR); batch of cameras × studios with
a file name from a template (`{project}_{camera}_{studio}`); download as an own ZIP (no
dependency: the ZIP store format is trivial).

**Depends on.** E4.

**Acceptance.** File-name and queue tests (order, cancelling the
second leaves the third); a 2 × 2 batch produces 4 images.

**Done.** The audit below says what was already there (the queue, its cancellation, the six
engine passes and the camera batch came from U5, U14, X2 and E4) and what was missing; N2
built only what was missing:

- **Engine: the alpha pass** (`rt_core::passes`, the seventh, bit 6 of `RNDR.passes`, without
  changing the section size or moving a hash): the object coverage of each
  pixel, from 0 to 1; it is sampled like the albedo (it shares with it the camera ray of each
  sample, so the edges come out smoothed just like the image) and is divided by the
  reciprocal of the number of samples, bit for bit like `Film::resolve`. `PASS_EXACT` remains
  `0b111110` and `PASS_X2` (the six from before) is what the X2 hashes pin.
  `rt_render_tile_alpha` in `rt.wasm` (with no new `rt_features` bit), the page's pool and the
  launcher's `RPP1` carry it, and the `RPP1` reader no longer has an arm
  that would have swallowed a new plane.
- **Passes as files**: *Alpha*, *Depth*, *Normals* and *Part ID* next to the
  image, in 32-bit EXR (default) or 16-bit PNG (`encodeExrPlanes`,
  `encodePngWords`, `core/pass-files.ts`, `io/passes.ts`), with the part legend
  (`<name>_partId.json`) and the depth range in a `tEXt` chunk.
- **Cameras × studios batch**: *Studio* in the window (the scene as it is, one saved, or
  all of them); with *All cameras*, 2 × 2 are four jobs, camera by camera, each
  with its camera and its studio and with the template's name; warning about repeated names.
- **Own ZIP** (`io/zip.ts`, store method, CRC-32, UTF-8 names, no ZIP64) and the queue's
  ZIP group: one *Render* command is a single file when the last job finishes, with
  an alternative of loose files if it cannot be assembled.
- **Queue**: the missing test (*Stop* the second leaves the third) and an old failure
  in `ensureLoop` (see below).

Numbers. Web: `npm run qa` green (types, interface and 177 test files with 3005 tests and 6 skipped, after merging `main`; before the phase there were 168 files and 2902 tests). Engine: `cargo test --workspace --release` 1112 tests and `npm run engine:test` 1106 (debug), with no failures; in WebAssembly (WASI) 588 from `rt-core`, scalar and with simd128; `cargo fmt`, `clippy -D warnings` (also for Windows), `cargo check` for aarch64 and riscv64, and the real `rt.wasm` equal to the native one in every parity block of `engine.yml`. With the machine heavily loaded, `ai_post::retries_lower_the_strength_…` (a wait on sampling) failed in two full runs and passes on its own (9 of 9): it touches nothing of this phase. New tests: `tests/batch.test.ts` (28),
`tests/zip.test.ts` (10), `tests/pass-files.test.ts` (17), 6 in
`tests/passes-engine.test.ts` and, in the engine, those of alpha in `passes_tests.rs` (coverage,
floor and background, equal to the film with a transparent background bit for bit, with other passes and with
other tiles, light panel, with edge samples, equal in scalar, SSE2 and AVX2), in
`rt-wasm` (`the_alpha_pass_through_the_c_api_is_the_engines`) and in `rt-app` (`RPP1` with
mask 127). **New hashes** pinned: `PINNED_PASS_ALPHA = 0xd4eaac78` (sample) and
`PINNED_E5_PASS_ALPHA = 0xef9ead68` (E5), equal in the real `rt.wasm`
(`wasm-parity.mjs --expect-alpha`, in `engine.yml`) and in scalar and simd128 WASI; **none
of the earlier ones moved** (albedo `0x43571da9`, normals `0x0aabfd24`, depth
`0x25f8dd11`, ids `0xccd3d6c7`, circle `0xdf87494c`, nor those of the images). Each new test
was checked with a mutation: 46 mutants (38 in the page, one in the queue and 7 in
the engine), all killed; two taught something: dividing by the number of samples instead of
multiplying by its reciprocal survived until it was tested with 7 samples, and one mutant
hung the tests (it was the `ensureLoop` failure). `tools/batch-check.mjs` (Chromium and the real
`rt.wasm`): a 2 × 2 batch with three passes in a 20-file ZIP that `unzip` and `fflate` accept,
the EXRs read by the specification, the 16-bit PNGs, and *Stop* on the second leaves the
third. Captures `batch-window.png` and `batch-queue.png`.

**Audit at the start** (on `main` at v0.1.16, point by point from the
brief and the acceptance criteria; U5, U14, X2 and X4 had already built part of it):

| Point | State at the start | From which phase | What N2 did |
| --- | --- | --- | --- |
| Render queue with order and progress, on top of the engine's `render()` | Done | U5 (drawer, reorder, edit, duplicate, pause, finished), U14 (live view), E4 (the tracer) | Nothing to redo |
| Cancellation | Done | U5: *Stop* the running job (ends as *Cancelled* and the next continues), *Remove* a waiting one, *Pause* | Nothing to redo; the test |
| Depth, normals and part-id passes as integrator output, with a mask in `RNDR` | Done in the engine | X2 (`RNDR.passes`, `rt_core::passes`, six passes with pinned hashes), X4 (three.js draws them for the AI) | Nothing to redo in the engine; they are only read by the AI guard and the denoiser: no pass reaches a file |
| Alpha pass | Missing (only the image's alpha with a transparent background existed) | — | The seventh pass, `alpha`, bit 6 of the mask: without changing the size of `RNDR` or moving a hash |
| Passes as files: 16-bit PNG or EXR | Missing (the image writers exist: PNG 8/16 bits, EXR, TIFF, DNG) | U5, U12 | `encodePngWords` and `encodeExrPlanes`, the numbers of each pass and their names |
| Selectable passes in the render window | Missing (a *coming soon* row) | U5 | Chips and format |
| Batch by cameras | Done | U5 (*All cameras*, one job per camera with its aspect ratio) | — |
| Batch by studios | Missing (saved studios were not an axis of the queue) | U4 (the library's studios), L6 | The studio as an axis: `studio` in the settings and in the job |
| Name from a template with project, camera and studio | Done where it matters | U5 (`{project}`, `{camera}`, `{studio}`, `{date}`, `{n}`: the keys in English, the chips in es and en) | `{studio}` becomes the job's saved studio (it was the product-type name); warning about repeated names |
| Download as an own ZIP | Missing (a ZIP writer existed only in `tests/zip.ts` for test files, and fflate to *read* 3MF) | — | `io/zip.ts` and the queue's ZIP group |
| Criterion: name and queue tests in order | Partial: the order and stopping the first | U5 (`tests/render-queue.test.ts`) | `tests/batch.test.ts` |
| Criterion: cancelling the second leaves the third | Missing | — | Two tests (stopping it and removing it) and the same case in Chromium |
| Criterion: a 2 × 2 batch produces 4 images | Missing | — | Test with the queue, the ZIP read by fflate and `tools/batch-check.mjs` |
| E8, native batches (`rt` reads projects) | Missing | — | Not built here (it overlaps; it stays in its phase) |

**What did not fit the plan** (rule 12; what is marked ◆ is a **Fable**
judgement call, who decides whether it changes):
- **The name chips** are `{project}`, `{camera}`, `{studio}`, `{date}` and
  `{n}` (U5's model, with keys in English and chips labelled
  in each language), not `{proyecto}_{camara}_{estudio}` as the brief says: what
  exists is kept, since it already does what is asked (in Spanish the chip says *Proyecto*,
  *Cámara*, *Estudio*). There is no Spanish alias inside the template.
- **`{studio}` changes meaning in batches**: it was the product-type name
  (*Jewellery*) and now, in a job with a saved studio, it is that studio's name;
  without one (everything from before) it is still the product type.
- ◆ **What alpha is.** The brief asked for an “alpha” pass and nothing more. It was built as an
  **object mask**: each sample counts whether its camera ray finds a
  surface of an instance; the studio floor (visible or shadow catcher), the
  environment, the background and the visible light panels are worth 0, and cut-outs and glass
  count as surface, as in all the X2 passes. It is therefore not the alpha of the
  image with *Transparent background* when there is a shadow catcher (there the alpha is the
  shadow) nor of what the path sees through glass; where there are only opaque objects and
  background, it is the film's alpha bit for bit (test). Decide whether the floor goes into the
  mask, and whether cut-outs with an alpha texture should give partial coverage (today they do not).
- ◆ **Which passes are offered**: the four in the brief. The engine also renders the albedo, the
  material id and the circle of confusion (those of the AI): they could be offered through the same
  channel, and the material id would need its legend.
- ◆ **How the numbers are written.** Default format of the passes, **EXR** (depth
  and normals are floating point); in 16-bit PNG, depth is a z map with
  **near is white**, 0 the background and the distance range in a `tEXt` chunk; the
  normals, `n × ½ + ½` (the background, mid grey); the ids, the instance number with the
  floor at 65535 and a cap of 65534 parts. All of that is prepared, not decided: they are
  photographic and convention choices.
- ◆ **The ZIP**: off by default (today each file is downloaded separately, as always), a
  group is what **one** *Render* or *+ Add to queue* command puts together, and it is called
  `Project_0001-0004.zip` (with the render numbers). Decide whether a batch to *Downloads*
  should be packaged by default, and the name.
- ◆ **The order of a batch** is camera by camera (each camera across all studios), that of
  the `{camera}_{studio}` templates; the other order (studio by studio) is equally
  defensible.
- **The studio does not move the camera.** `studio/restore` does set the studio's camera (its
  view and its optics); a batch keeps the job's own, because otherwise 2 cameras × 2
  studios would be 2 images. A pure `restoreStudio` with `{ camera: false }` does both things.
- **The batch's studios are the saved ones**: those of the *Studios* tab (library, in the
  browser or in the desktop data folder) and those that an old project kept
  inside. A job stores the id and the name, not the studio: opened on another machine without
  that studio it fails with the reason. ◆ Whether the studio should travel with the project (decided: yes; done in N2b).
- **A job with a studio does not go through the AI** (its passes are drawn from the open project in
  Fast mode); a notice says so and the engine's image is saved. Job plugins
  save separately, outside the ZIP.
- **The passes are for images**: an animation does not write them (nor carry a studio), and with
  *Finish by noise* the alpha, like the albedo, carries the samples of the first round.
- **The ZIP is assembled in memory** and written when the last job of the group ends: closing the
  page before that loses it (the image results are in the history), there is no ZIP64 and
  a huge batch of 32-bit EXRs may not fit. A group that is paused waits in memory.
- **Cancel**: it was already there; the test was missing. *Stop* (the running one) and *Remove* (one
  waiting) are the two modes; a waiting job does not become *Cancelled*, it leaves the list.
- **Desktop**: the launcher renders the alpha and stores it in its `RPP1` (tested through the
  API with 1 and 4 threads, and the page's reader with a file written by the launcher),
  but `tools/batch-check.mjs` only covers the web: the batch in the native window was not
  recorded. **E8** (native command-line batches) is not built here.
- **Changes outside the plan, from a bug that almost got in**: the launcher's `RPP1` reader
  (`kept.rs`) had a `_ =>` arm that would have stored any new plane in the circle of
  confusion; now alpha has its own and the test file
  `tests/fixtures/passes-3x2.rpp` includes it (its first six planes are the same bytes).
- **An old queue failure, found while testing**: a *Start* with nothing waiting
  ended the loop before its first `await` and left the already finished promise as “the
  running loop”; no later *Start* launched another. Fixed in `ensureLoop`
  (the promise clears itself on finishing) and with its test, which fails if the old code returns.

## N2b · The studio travels with the project — **Opus** — done

**What** (from *Judgement calls*, N2). The studio of a batch job travels **inside
the project**: a project opened on another machine, or in another browser profile, does not
fail its jobs because a library studio is missing there.

**Done:**

- **The copy in the project** (`core/job-studios.ts`). `render.studios` is a list of
  `{ hash, studio }`: `studio`, the `SavedStudio` that `restoreStudio` applies (lights,
  environment, image, camera, per-part materials and visibility, with its id and its name);
  `hash`, the SHA-256 of its content without id or name as JSON with sorted keys
  (`canonicalJson`, `studioHash`, with the `core/sha256.ts` that already existed). **One copy per
  id and hash**: the four jobs of a 2 × 2 over two studios are two copies, and
  *+ Add to queue* twice with the same studio is still one. Each job
  names it with the optional field `RenderJob.studioCopy` (its `settings.studio` does not change:
  `{ kind: 'ONE', id, name }`). The queue *reducer* stores the copy with the jobs
  in the same action (`render/enqueue` and `render/updateJob` receive in `studios` each
  `StudioRef` with its `snapshot`; the interface supplies them with `studiosForJobs`), so
  undoing *Add to queue* takes both things away, and it only keeps the copies that some
  job names (`pruneEmbedded` in `withQueue`: removing the last job of a studio
  removes its copy, undoing returns it; *Duplicate* shares the original's).
- **The large things, once.** The lights carry their IES profile in the JSON, like those of the project
  (L5); the HDRI, the background image and the copy's textures are `ImageRef`s, and their
  files go in the `images` block with those of the project (U2/E5/M2a), **once for each
  image** whoever names it (`embeddedImageRefs` in `serializeProject`). On opening,
  `placeImages` and `placeTextureImages` place them with those of the project, decoding each
  one only once, and change its id at the same time in the project and in the copies when in the
  session another image already uses it; `replaceProject` keeps the copies' images in the registry.
- **On opening and on rendering.** `migrateRender` takes from `render.studios` what has the shape
  of a copy (a 64-digit hash, a studio with id and name, no repeats) and `studioCopy`
  from each job; `checkState` reads each copy like the project blocks (environment,
  image and camera completed with the values of a new project and with the types
  checked, IES profiles with `withReadableProfile`, materials with `readMaterial`, which is
  what was there before extracted into a function, and the materials that name their present parts); a
  damaged copy is removed, not the project. On rendering, `resolveStudio` gives the job's
  studio: **its copy**; without one, the library one with that id; if not, one that the
  project kept inside (`studio.saved`); if not, the failure with its reason, as before.
- **Format.** The conventions of `io/project.ts`: two fields added with their default
  value, with no schema step; **the schema stays at 2** (header of `io/project.ts` and
  `ARCHITECTURE.md` §8). An earlier project opens the same (no copies, the same jobs;
  `project-v1.json` and `project-v2.json`), and an earlier version opening a new one ignores
  the two fields and looks for the studios in its library.
- **Add to my library.** In the *Queue* drawer, between the header and the list, one line per
  studio that came with the project and is not in the library (nor saved in the project):
  *The studio “Studio A” came with the project; it is not in your library* · **Add to my
  library** (`studiosToAdopt`, `addProjectStudioToLibrary`), which saves it in *Mine* with
  its id and removes the line. In the render window, when editing a job whose studio is only
  in the project, the list names it *Studio A (in the project)* instead of *(no longer
  saved)*. Strings in `es` and `en` (`queue.studioInProject`, `queue.addToLibrary`,
  `rw.studioInProject`).

**Tests.** `tests/job-studios.test.ts` (13): the **2 × 2 over two library studios**
saved, opened on another “machine” with an empty library through *Open
project* and rendered: the four jobs finish, with the template's names, each
with the product type, the lights and the exposure of its studio and through its camera; **without
the change it fails** (all four *Failed* with “The studio “Studio A” is not saved any more”:
checked with `git stash` of `src/` and the same test without importing anything new). The copy wins
over a library studio saved on top with the same id, and a new one takes the current one;
one copy per studio (two identical *Add*s, the file has it once and the jobs
name it by its hash); the hash does not depend on key order, id or name;
the copies follow the jobs (undo, remove, duplicate); editing keeps the copy or
takes that of the new studio; **the project's HDRI in a studio is not duplicated** (one entry
in `images`, the file grows by less than half of the image's base64; opened
in a new session the copy names the placed HDRI, and in a session where `hdri:1` is another image
the project and the copy move to the same new id) and an HDRI that only the studio has travels
equally; earlier projects open the same; a job from before N2b uses the library and,
without the studio, fails with the reason; editing it gives it a copy; a damaged copy is removed and the
project opens; *Add to my library* (what it offers, the id it keeps, that it does not touch the
project). In `tests/batch.test.ts`, the N2 test “a studio that is no longer saved
fails” now says the current thing: deleted from the library, the job renders its copy; without
a copy either, it fails with the reason. Each new test was checked with a mutation (10
mutants, all killed: without the copies' images in the file, without changing their id
on opening, without pruning, the library before the copy, without removing repeats, the hash without
sorting keys, an edit that changes the copy, without reading the copies on opening, without
keeping their images on opening, and the render without looking at the copy); two survived at
first (the hash without sorting and the edit) and their tests were strengthened.
`tools/batch-check.mjs` (g), in Chromium with the real `rt.wasm`: two studios and a batch
over both added to the queue in one profile, *Save project* (the `.repack` has both
copies and the jobs name them), opened in another profile with an empty library: the queue
offers the two lines, *Start queue* gives distinct `Studio 1.png` and `Studio 2.png`, and adding
one leaves the other's line. New capture `batch-queue-adopt.png`.

**Gates.** `npm run engine:build` and `npm run qa`: types and build green; of 3180 tests
(192 files), 3148 pass, 31 are skipped and one, `tests/material-program-cross.test.ts` “has a
fixture of every case”, exceeded the 5 s time limit with the machine loaded by other agents
(it touches nothing of this phase): on its own it passes (3 of 3). `tools/batch-check.mjs` in Chromium with the
real `rt.wasm`: the nine checks green, (a)–(f) from N2 and (g1), (g2) from N2b. The engine
is not touched.

**What did not fit the plan** (rule 12; what is marked ◆ is decided in *Judgement calls*: it is accepted as it stands):

- ◆ **The copy wins** over a library studio with the same id and different content
  (saved on top), for the jobs that already had it; a new job of that studio
  takes the library's as it is and carries another copy with the same id. There is no *Update
  from library* nor a notice that they differ.
- ◆ **Editing** a job without changing its studio keeps its copy, even if the library
  has changed; changing it takes that of the new studio (and the old one leaves if nobody names it).
- ◆ ***Add to my library*** saves the studio with **its id** (the jobs find it
  there too), it is not undoable (the library belongs to the person, with no history, U4: rule 6
  is met in everything about the project, which does not change) and it is only offered for an id that the
  library does not have: a copy with the id of a library studio that was saved on top is not
  offered as a separate studio. It is in the *Queue* drawer, not in a job detail
  (there is no detail view).
- ◆ **The schema stays at 2**, by the format's convention (what is added with a default
  value does not raise the schema): an earlier version opens a new project without error, without
  the copies.
- **A job from before N2b receives no copy on opening** (opening does not change the project: earlier
  projects open the same), nor on saving (the file does not see the library): it looks for its
  studio in the library, as before; it receives one when edited or added again.
- **The copy may carry more than the library.** The library does not store images (E5):
  after reloading the page its studios have no HDRI; the copy carries what the studio
  had when the job was created (in the same session, its HDRI too, which then does travel).
- **What is repeated, small**: the IES profile of a light in the copy that is also
  in the project goes twice in the JSON (the format has no profiles block: L5 carries them
  in the light), and the copy's materials, as in every saved studio. Images
  are never repeated.
- **The studios that an old project kept inside** (`studio.saved`) still do not
  write their HDRI to the file, as before N2b: it is not part of this phase.
- **The hash is not recalculated on opening**: it is the copy's name (completing its fields on
  reading would change the text); a hand-edited copy keeps its hash.
- **The reason for the failure** is still “The studio “…” is not saved any more”, also for an old
  project opened on another machine.
- `tools/batch-check.mjs` was run with `--shots` to a separate folder and only the new
  capture was copied: those of N2 (`batch-window.png`, `batch-queue.png`) do not change.
## D1 · Engine Doctor — **Sonnet** — done

**What.** The checks that depend on the engine: `rt.wasm` loaded and
number of workers (and a warning if the browser only gives one), SIMD available
in wasm, denoise, view transform, caustics (fireflies: very bright
isolated samples detected in the accumulation), video output
format, estimated time against the budget. *Fix all* in one
click.

**Depends on.** E4.

**Acceptance.** `tests/doctor-engine.test.ts` with a fake engine that simulates
each state; each check fires and clears.

**Done.** The engine checks live in a module of their own,
`src/core/doctor-engine.ts`, plugged into `runDoctor` and `fixDoctor` through their
default branch: the ten scene checks, their keys and their tests were not
touched. What the engine and the system say is not project data, so the page
hands it to the Doctor as `EngineFacts` (`setEngineFacts`, like the particle
cap from S4a) through `installDoctorFacts` (`src/ui/doctor-facts.ts`),
which builds it from the interface state and the viewport's `status()`, requests
`doctor/refresh` only when something changes (volatile, with no undo entry) and
repeats it after undo and redo; `main.ts` gives it a one-second pulse for what
only the engine knows. Without facts, the seven engine checks and the two that are not
touched (`lighttree`, `persist`) remain *unavailable* with the same shape as
before. The catalogue goes to **19** entries: `simd` after `engine` and `budget`
after `output` (new), and the texts of `engine`, `denoise`, `color`,
`caustics` and `output`, which spoke of Cycles, rewritten for this engine with
their keys intact. Detection, fix and test of each one:

- **`engine`**: the availability of `ui.engine` (`NO_WASM`, `OUTDATED`,
  `FAILED`, `NO_WORKERS`, each with its sentence) and a pool of a single worker
  with the WebAssembly engine. No fix; if it is *Threads* that limits it
  (Automatic would give more), the notice brings the **Settings** button that opens that row.
- **`simd`**: `EngineInfo.simd` against what the system supports and the setting:
  without simd128, *SIMD* set to *Off* (with a button to that row), missing
  `rt-simd.wasm`, or a desktop engine without a vector path.
- **`denoise`**: in the viewport and not in the render, at strength 0, or an `rt.wasm` without
  `rt_denoise` (the workers say so in their first message, `ready.denoise`; before,
  nobody outside the worker knew). Off everywhere does not warn. Fix:
  *Both* / 100 %, through `render/set`.
- **`color`**: with *Standard*, the fraction of the frame more than one stop above
  white (2 linear, with the exposure applied) read from the accumulation's stop
  histogram; with *Filmic* and *AgX* no image is needed. Fix:
  *Filmic*.
- **`caustics` (Fireflies)**: `render/frame-scan.ts` reads the accumulation that the
  page already has (without touching the engine): a pixel is a firefly if its mean
  exceeds white, is 4 times that of the best of its eight neighbours and, with
  squared luminance, a single sample contributes half of its light or more (the
  quotient `lum2 / (Σ luminance)²` is an exact lower bound of the share of the
  largest sample). It warns from 8 pixels or 10⁻⁵ of the frame; fix: caustics
  *Off* → *Automatic* and indirect clamp at 10, or, if already there, just
  “more samples”. It is done by `status().scan` of the pool and the launcher, read again
  when the samples double (from the 16th onwards).
- **`output`**: video with a codec that the system does not encode, or video plain
  (a file that a failure loses entirely). Fix: frame sequence.
- **`budget`**: with the speed the engine measured (`ui.throughput`, never
  invented), the *Time* setting's time does not reach a Draft (64), or that of
  *Whichever comes first* half of the samples. Fix: raise the time to what is
  needed plus a quarter of headroom (`BUDGET_HEADROOM`), rounded to the ten
  seconds: the browser test showed that the speed the viewport measures
  moves from one reading to the next and a tight budget fell short again
  right after being fixed.

A scan belongs to **one image**: it carries the project it comes from (`basis`) and
`sameImage` (which repeats `touchesImage` of the two engines, with a test that
compares them) says when it stops being valid; the Doctor does not use a reading from another image
(`Measuring…`). The store reruns the Doctor when what the
checks read changes (`engineInputsChanged`). The fixes go through the store and are
one undo entry; *Fix all* joins them into one, and what the project
cannot change is a notice with its explanation and no false fix.
`tests/doctor-engine.test.ts` (72 tests) carries a fake engine that writes
where the real one writes and uses the real `installDoctorFacts`: each of the
fourteen failures in the table fires and clears, plus *Fix all*, the
thresholds at their boundaries, `doctorSentence` in both languages, and that undo
refreshes; `tests/frame-scan.test.ts` (17) reads synthetic accumulations, the
`status().scan` of the pool with fake workers and that of the launcher with its simulator;
`tests/frame-scan-engine.test.ts` (3), the real `rt.wasm`. Each new check
was tested by **disabling its detection** (and each fix, and each threshold):
about a hundred mutations, all killed except three equivalent ones: not clipping the
top or bottom row of the neighbours (outside the frame `undefined` is read and
beats nobody) and the `full` of the pool's `status()` (the cache, which asks for 16
samples, already covers it). `tools/doctor-engine-check.mjs` runs it in Chromium with the real `rt.wasm`
(27 checks: the engine and the viewport healthy, *SIMD* set to *Off* with
its button to *Settings*, denoise only in the viewport and a 5 s budget with the
speed the engine measured, *Fix all* and an undo) and leaves
`docs/ui/doctor-engine.png`. The Rust engine was not touched: neither `rt_features` nor
any pinned hash moves. Gates: `npm run qa` green (159 files and
2746 tests pass, 4 files and 6 tests skipped; at the start 2635 passed) and
`npm run engine:test` green (1098 pass, 11 ignored). With K1 on the
same branch the two coexist: `runDoctor` gives the 19 of `DOCTOR_CHECKS` and, with the
*Interior* type, the seven of `INTERIOR_CHECKS` after them; `fixDoctor` routes each key to its
Doctor (`isInteriorCheck`) and *Fix all* clears both classes in one undo
entry (four tests in `tests/doctor-engine.test.ts`, which also pins that the
interior keys are neither scene nor engine ones). Cost: reading the
accumulation runs on the main thread every time the samples double
(from 16 onwards: five or six times per view) and takes, measured in Node with
hot code, 40 ms at 1280 × 720, 160 ms at 2560 × 1440 and 330 ms at 4K.

A failure that appeared while testing and was fixed with its test
(`tests/store.test.ts`): an action that a store listener dispatches while being
notified of an undo, a redo, a reset or the closing of a transaction
waited for the next `dispatch` (`apply` was only drained in `dispatch`); the
Doctor needs to request `doctor/refresh` after undo, and it did not arrive.

**What did not fit the plan** (rule 12; what is marked ◆ is a judgement call and is
left noted for whoever decides, rule 11):
- ◆ **`color` does not have in this engine the original's check** (“the scene's
  transform does not match the one chosen in the settings”): there is a single source
  (`image.viewTransform`) and the page converts the sums itself, so there
  is nothing to disagree. The proposal is something else that the engine does know: with
  *Standard* the highlights are clipped. Pending: whether that is a failure (a plain
  white background is wanted clipped), the threshold (**1 %** of the frame, more than
  **one stop** above white: `CLIP_FRACTION`, `CLIP_OVER_WHITE`) and whether the
  fix is *Filmic* or *AgX*.
- ◆ **`caustics` / Fireflies changes meaning**: the original warned of
  caustics that were *on* needlessly; here caustics are a photon map that removes
  fireflies, and when off they leave them. Proposed thresholds, all in
  `render/frame-scan.ts` and `core/doctor-engine.ts`: brightness ≥ 1 (white), isolation
  ×4, share of one sample ≥ 0.5, 16 samples minimum, 8 pixels or 10⁻⁵ of the
  frame, indirect clamp **10** (a clamp removes energy: it is a bias, not a
  free fix). Real data was looked at (`tests/frame-scan-engine.test.ts`): two
  ordinary scenes at 16 samples, 0 fireflies; mirrors with pinpoint lights at 64,
  4 with one sample of up to ~76 times white; it was not tuned with more scenes.
- **What is not measured**: two fireflies stuck together look like a bright neighbour to each
  other and do not count; with the launcher viewport's denoise on, the sums that
  reach the page are the filtered image (`fireflies: null`, and the check says
  there is nothing to count; the pool always reads the unfiltered sums); in *Fast*
  there is no accumulation.
- ◆ **`budget`: what “too slow for the budget” is**. There is no time budget
  if it finishes by samples or by noise (it does not warn); with *Time*, that of
  a Draft (64 samples) is the minimum for a usable image; with *Whichever comes
  first*, half of the requested samples (`BUDGET_REACH`). The fix
  raises the time (with 25 % headroom) and does not lower the samples (the other honest
  way out); an animation is
  judged by the budget of each frame, and its total is compared with nothing.
- ◆ **`output` dormant**: until N1 the settings force the frame
  sequence, so only a project from a future with video triggers it. It is to be decided
  whether it should also warn when the codec can be encoded (today it does, because of “a file
  that a failure loses”); the fix is always the sequence, without changing
  codec.
- ◆ **`denoise`**: it only warns of the viewport without the render (not the other way round: the raw
  viewport is an everyday decision) and of strength 0; the fix is *Both* / 100 %.
- **`lighttree` and `persist`** remain in the list as *unavailable* with their reason
  (the light tree belongs to K4; persistent data belongs to Blender and has no
  equivalent): the keys are stable and are not removed. If preferred, `persist`
  can be withdrawn from the catalogue in a clean-up phase.
- **Application settings**: what limits *Threads* and *SIMD* does not belong to the project
  and is not undoable; the Doctor points to it with a button that opens the row and does not
  change it. If a fix that changes it is preferred, that is a decision (rule 6 says
  that every mutation is undoable).
- `sameImage` repeats the list of `touchesImage` of the pool and that of the launcher (they
  were already two copies): `tests/doctor-engine.test.ts` compares them across sixteen
  actions. It differs in the playhead, on purpose (the Doctor does not run on every frame).
- The help bubble of *Fix* uses the catalogue text; the engine ones
  say it in general (“No fix in the project: …”), and the notice of each case, the
  reason.

## U5 · Render window and results viewer — **Opus** — done

**What.** `UI.md` §2.5, §2.7 and §2.8: the bottom bar loses quality,
resolution, budget and format, and is left with *Animation*, *Queue* (with
counter and progress) and **Render…**; the KeyShot-style **render window**
with *Image · Animation*, *Output* (name from a template with
chips, folder when done with access to the browser's file system
where it exists and *Downloads* where not, format, transparent,
camera one or all, size in pixels and print size with linked **dpi**
written into the file —`pHYs` in PNG, JFIF density in
JPEG—), *Quality* (*Finish by* samples or time, *whichever comes first*
in advanced, estimate from the measured samples per second),
*Animation* (range, fps, video or frames, per-frame budget,
total estimate; the frame sequence already works, encoded
video arrives with N1 and is marked *coming soon* until then),
the *AI post-processing* section as a collapsed placeholder (*coming soon* until
X3), and the footer with **+ Add to queue** and **Render** (the latter puts
the job first and starts it); a complete `RenderJob` in the store
with migration of the U1 state; *Queue* drawer with reorder, edit,
duplicate, pause and finished; **results viewer** over the viewport
with zoom, data and the generic **comparison component with a sliding
divider** (any two images), which X3 reuses;
results history in browser storage (IndexedDB or
OPFS) with a limit and deletion; shortcuts `Ctrl ⏎`, `Ctrl ⇧ ⏎`, `⏎`, `⇧ ⏎`.

**Depends on.** E4 (render always with the tracer).

**Acceptance.** Tests: `px = size × dpi` in both directions with
rounding and lock; the PNG carries `pHYs` with the dpi (reading the
file in the test) and the JPEG its density; name template with all
the chips; *Render* and *+ Add to queue* produce the expected queue;
*All cameras* creates one job per camera; *Finish by time*
cuts at the limit (±1 pass); migration of a U1 project; the
window does not appear in the viewport capture. Captures of the window in
*Image* and in *Animation*, of the *Queue* drawer with three jobs and of the
results viewer with the divider.

**Done.** The bottom bar is left with *Animation*, *Queue* (counter and
progress), the latest result and **Render…**; the render window
(`ui/panels/render-window.ts`) with *Output* (template with chips,
*Downloads* or a chosen folder with the permission remembered, PNG 8/16 bits,
JPEG with quality, uncompressed linear EXR, transparent, active camera,
one or all, pixels ↔ print with lock and dpi), *Quality* (*Finish
by* samples, time or whichever is first, estimate with the measured samples per
second, advanced with bounces, clamp and seed), *Animation*
(range, fps, frames already working, video *coming soon*), the collapsed
placeholder of AI post-processing and the footer with **+ Add to queue** and
**Render**. The dpi go into `pHYs` (PNG) and into the JFIF density (JPEG).
*Finish by time* is decided by `render/schedule.ts` between passes,
measuring the time per sample, always within one pass of the limit.
Complete `RenderJob` with pure migration of the U1 state and
`PROJECT_SCHEMA = 2`. Queue with reorder, edit, duplicate, pause and
finished; results viewer with zoom, data and the generic component
`ui/components/split-compare.ts`; history in IndexedDB (50 results or
500 MB) with memory as a fallback. 621 tests; 31 mutations checked;
8 checks in the browser (`tools/render-window-check.mjs`), among
them that the window never appears in the viewport image. Captures
`render-window-image.png`, `render-window-animation.png`,
`queue-drawer.png` and `results-split.png`.

What did not fit the plan: the queue becomes **undoable** (U1 made it not
undoable; this brief governs); *Render* with the queue running does not
interrupt the job in progress, it goes first and starts afterwards; in
*Animation* a *Frame size* row is needed (pixels only) and
the sections are stacked; the history stores only the first frame
of an animation; *Pause* restarts the job, because a render is not
resumed halfway; `{n}` is the render number in an image and the frame
number in an animation; EXR also for sequences, without dpi; the advanced
settings only apply to the render, not to the Full viewport; *Open
folder* is hidden in the browser. Observation for L3: with the jewellery
studio, REMBRANDT and NEON_NOIR change only 3 % of the pixels; it
is reviewed with the recipes on the own engine.

## U6 · Settings window and model manager — **Opus** — done

**What.** Request: professional Settings, everything
configurable separated into modules and grouped in a column on the
left. `UI.md` §2.9 in full: the window (960 × 680, search box,
groups *Application* · *Render* · *System*, changes immediately, dot and
*Reset* per row and per section, direct links and
`?settings=<section>`), and its sections **General**, **Preferences**,
**Accessibility**, **Keyboard shortcuts**, **Render engine** (with
a real *Measure performance*), **AI post-processing**, **Storage**,
**Desktop** (only in the desktop application) and **About** (with
the complete third-party licences). The settings are a typed object
with version, factory values and migration in `src/core/settings.ts`
(pure), saved by `src/ui/prefs.ts`; today's loose preferences
(theme, language, widths, viewport mode) migrate into it.

The **model manager** of `AI-POST.md` §5 (it absorbs X5): the list in
`src/data/ai-models.json` (from X1 part A) and the imported ones; downloads
with progress, pause, resumption after closing (`Range` requests), and
`sha256` per file; storage in OPFS on the web and in the data folder
through the launcher on desktop (P2), behind a single
`ModelStore` interface; *Use*, *Delete*, *Import model…* with the
`model.repackshot.json` manifest validated and *pickle* rejected;
licence shown and accepted before the first download; the
**configuration of the active model**; the **machine detection** (WebGPU limits
on the web; the launcher's `/api/hardware` on desktop) and the
**recommendation rule** evaluated over the JSON table. If the
installer left a choice, its downloads start on first
launch. In the desktop portable versions the chooser appears
once on first launch; on the web, the first time post-processing
is enabled (`AI-POST.md` §2.2) and always in *Settings*, because today there
is no model for the browser. As long as X3 does not exist, post-processing does not
run: the section says so in one line and everything else works.

**Depends on.** U5 (the render window links to *Manage
models…*), X1 part A (the JSON with files and `sha256`). The desktop part
of storage is tested with the P2 launcher.

**Acceptance.** Tests: migration of the loose preferences; every setting
has a factory value and *Reset* returns it; the search finds
a setting by a keyword in `es` and in `en`; the recommendation rule
gives the row of `AI-POST.md` §2.4 at the edges of each band
(case file `tests/fixtures/ai-recommend-cases.json`, the same one
used by P2's Rust test); without detection it does not recommend; an invalid manifest
is rejected with the reason; a `.ckpt` is rejected; a non-commercial model
cannot be the default one; deleting the active one returns to the
recommendation; an interrupted download resumes from the last byte
written (test server with `Range`) and a wrong `sha256` leaves the
file *Damaged*; high contrast and interface size change the
tokens and remain achromatic. English captures of *General*,
*Accessibility*, *Render engine* and *AI post-processing ▸ Models*
with a download in progress.

**Done.** `src/core/settings.ts`: some 57 typed settings with version,
factory values, validation, migration of the loose preferences and
a metadata table (`SETTING_ROWS`) from which the window, the
search in both languages, and the *changed* dots and *Reset* are derived. The
window (`ui/panels/settings-*.ts`) with the groups *Application*,
*Render* and *System*, direct links and `?settings=`; every section
genuinely connected (navigation and mouse buttons, resolution during
gestures, interface and text size, high contrast, reduce
motion, announcements for screen readers, engine *Automatic ·
Native · WebAssembly*, threads and SIMD, viewport limit, *Measure
performance* with a real 10 s render, history limits, data
folder, complete third-party licences copied at build time).
*Last project* works: the header asks on startup whether to open
the last file. Model manager with a `ModelStore` interface and three
implementations (OPFS in a worker with the same layout by
`sha256` as the launcher, the launcher, and memory), downloads in
4 MiB chunks with `Range`, resumption after reload, own streaming SHA-256
(file *Damaged* if it does not match), two files at a time, shared
files once, licence accepted before downloading, import
with manifest and *pickle* rejection, the installer's choice on
startup and the chooser once in the portables. 939 tests; checks
in a web browser (`tools/settings-check.mjs`) and on desktop with
the real launcher (`tools/settings-desktop-check.mjs`). Captures
`settings-general.png`, `settings-accessibility.png`,
`settings-engine.png`, `settings-ai-models.png` and `settings-desktop.png`.

What did not fit the plan: *Coming soon* are the automatic backup, the access
letters, changing shortcuts, *Check for updates* and the AI pipeline; the
catalogue downloads through the launcher were not tested with multi-GB
files (the import covers the store end to end); the U2 limits test
had a false positive and the achromatic test was reading empty strings instead of the CSS
(both fixed, with their case); *On start*
is *Empty project* by default, as until now, with the standard mode
already mounted. It found a P2 failure: an empty project is never
rendered natively (the launcher asks for meshes that are not there).
## N3 · Camera walk — **Sonnet**

**What.** The `WALK` animation type from `SPEC.md` §3.7: a
*Trace walk* tool in the viewport (click on the floor per point, `⏎` finishes,
draggable points, the curve drawn in ink), *Walk around the
selection* in one click, centripetal Catmull–Rom travelled at
constant speed by arc length with soft start and stop, eye height,
look-ahead / towards a target / by points with smoothed turning, and **Simulate steps** (cadence, vertical and lateral sway,
tilt, synchronised with the distance and switched off when stopping). It is
edited in the animation inspector and appears as a bar in the camera
track. *Room walkthrough* is enabled once K2 exists.

**Depends on.** N1.

**Acceptance.** `evaluate` tests: the speed is constant ±1 % over the
whole curve except start and stop; the camera height is the eye
height ±0 without steps and oscillates with the requested amplitude and cadence
with steps; with *towards a target* the target stays at the centre of the
framing ±0.5°; stopping halfway along the curve switches off the sway in less than
one step; the same `t` always gives the same camera. A 4 s video of the
walk around the bottle, with and without steps.

## X1 · Confirm the AI model — **Fable**, with Sonnet preparing

**Part A, brought forward (U6 needs it) — done.** Sonnet prepared and the
lead confirmed the data (2026-10-13): the seven keys with their files
pinned to a commit, sizes and `sha256` checked against two sources, and the
licences quoted in `docs/ai-licences.md`. The lead's decisions:
`ZIMAGE_WEB` stays **unavailable** (the published ONNX export
does not include the VAE encoder; X3 exports it); official Qwen3-4B text encoder,
ggml-org's Qwen2.5-VL and Unsloth's klein Q4_K_M, all three to
be tested in part B; storage by `sha256` so as not to download shared files
twice. What did not fit the table: SD 1.5 weighs 3.6 GB and not
3.1 (the encoder and VAE were missing) and Qwen-Edit 19 GB (the vision
projector was missing); the "lighting LoRA" has no chosen file and comes from
the description. The JSON enters the repository with P2.

What was asked for: Sonnet prepares and Fable confirms `src/data/ai-models.json`: for each key of `AI-POST.md` §2.4,
the source repository, each file with its direct download URL,
exact size and `sha256`, the licence with its quoted text and its URL, and the
recommendation rule as a data table. No measurements yet: the
thresholds are those of the table, marked *provisional*.

**Part B, after X3c.** `AI-POST.md` §2: re-read and quote verbatim the licences
of Z-Image-Turbo, its encoder, its VAE and its ControlNet, and of FLUX.2
klein 4B, and that of stable-diffusion.cpp and ggml; Sonnet prepares a
**tool** that generates the comparison sheet (8 engine renders
—product and interior—, 3 interventions, the two models, with the metrics of the §3.2
guard, the time and the memory peak, on Vulkan
and on CPU) and that is run **on a machine with a GPU** (there is none here); with
that sheet **Fable chooses** the model and sets the initial tolerances
(ΔE₀₀, edges, sharpness) and the thresholds of the §2.4 rule. The web `sha256`s
(q4f16) are pinned by X3d.

**Depends on.** X3c (the pipeline has to exist in order to measure).

## X2 · Engine passes for the AI — **Opus** — done

**What.** Contract in `AI-POST.md` §7.4 and `src/core/passes.ts`. In
`rt-core`: albedo (first non-specular bounce), normal,
depth, part id, material id and blur map (circle of
confusion of the thin lens) passes, with a pass mask in `RNDR`; export
in `rt-wasm`, accumulation in the E4 pool and reading in TypeScript; in the
launcher, `passes=…` in `/api/render` for final jobs, which stores them by id
for the pipeline, and `GET /api/render/<id>/passes`. It coincides
with the passes part of N2 and brings it forward.

**Depends on.** E4, and **E5 merged** (both touch the integrator).

**Acceptance.** Tests: the part id of each pixel matches the `pick`
at the pixel centre; the albedo of a diffuse material is its colour; the
blur map is zero at the focus plane and grows with
distance according to the thin-lens formula (±1 %); requesting passes does not change
a single pixel of the image; determinism and native/wasm parity intact.

**Done** (2026-10-13). `rt_core::passes` with the contract of §7.4:
`RNDR.passes` (40 B; earlier RSBs request none, unknown
bits are preserved), `render_tile_exact` (normal, depth,
ids and circle of confusion from **one ray through the pixel centre and the
lens centre**, `render::centre_ray`, once per tile) and `render_tile_albedo`
(the camera ray of each image sample, summed in `f32` in sample
order and divided like `Film::resolve`), on top of `integrator::first_hit`
(the nearest between geometry and floor; a light panel visible to the camera
crossed earlier is background) and `PassFilm`/`Passes`. The studio floor
(visible or shadow catcher) is `FLOOR_ID` in both ids; the background, 0 and
+∞. The passes have rays of their own: the image keeps its hashes
(`0x223515c3`, `0xbf8abd5b`, `0x2fcb098a`) with all the passes
interleaved. Pinned hashes of the six planes of the sample (albedo
`0x43571da9`, normal `0x0aabfd24`, depth `0x25f8dd11`, ids
`0xccd3d6c7` both, `coc` `0xdf87494c`) and of the E5 sample (`0xace93461`,
`0x714253d6`, `0x9b1b61c8`, `0x2c21fa55` ×2, `0x73bf76f1`), equal in
scalar, SSE2 and AVX2, in both WASI passes, in the real `rt.wasm`
(scalar and `simd128`, `tools/wasm-parity.mjs --expect-passes`, in CI),
through the launcher API with 1 and 4 threads and through the page code
(`tests/passes-engine.test.ts`). `rt-wasm`: `rt_render_tile_passes` and
`rt_render_tile_albedo`; the pool requests them with the job's mask and
joins them with `PassAccumulator` (`src/render/pass-planes.ts`), and
`renderPixels` returns `RenderPasses`. Launcher: `passes=` on
finals (400 if it names a pass that does not exist or in the viewport), a store of
the **last four** renders with passes by id (linear image and passes;
those over 64 MiB in `<data>/cache/ai/<id>.rpx` and `.rpp`, which is
cleaned on startup; the job's `DELETE` does not remove them), served as
`RPP1` in `GET /api/render/<id>/passes` (404 if it does not exist or was evicted,
409 while it is rendering), `Engine::kept` for X3c; `native.ts` requests it
and reads it with `parsePasses` and also returns `renderId`. The circle of
confusion is that of `lens-coc.ts` (both sides read
`tests/fixtures/lens-coc.json`) and matches within 1 % (in practice,
1e-5) the blur measured from the lens of `Camera::generate_ray`.
The three.js passes of X4 match those of the engine in ids and
depth in their test scene (compared in
`tests/ai-passes-browser.test.ts` with the real `rt.wasm`), except the
floor. Tests: 22 new in Rust (15 in `rt-core`, 1 in `rt-wasm` and 6 in the
launcher: store, `RPP1` format, jobs and API) and 12 in vitest; 19
mutations checked (each test fails if what it guards is broken).

**What did not fit the plan.** (1) **The floor in the three.js passes**: the
corrected contract (floor = `FLOOR_ID`) is met by the engine; the X4
preview still draws it as background (0, +∞). It is not touched here:
§7.4 gives it to X3c, and the browser test today accepts 0 on the floor
pixels and notes it. (2) Decisions where the contract said nothing,
noted in §7.4: the albedo of an emitter is its `base_color`; that of the
floor, `FLOR.color` also in the shadow catcher (which does not use it to
paint); with depth of field the albedo follows each sample through the
lens and is blurred like the image (X2's comparison with the X4
reference only requires the exact colour where `coc` < 0.25 px); a
cut-out or a glass stops the passes' ray, like `pick`; an
instance with an out-of-range material index carries `materialId` 0.
(3) In the sample and in the E5 one, instance *i* carries material *i*, so
their id planes have the same hash: the order of the two planes
is guarded by the file `tests/fixtures/passes-3x2.rpp` (written by the
launcher and read by the page) and by the X4 scene, where they do not coincide.
(4) The mask travels by two routes in the launcher (`RNDR.passes` and
`passes=`): a final renders the union. (5) The passes' rays
count towards the job's rays (`rays` of the frame): one per pixel for
the exact ones and one per sample for the albedo. (6) `engine/README.md` is
entirely in English; its passes section too, so as not to split the
file. (7) **With P3a** (merged afterwards): the passes are rendered with
the threads or workers that the render has, also when the viewport
is still alive in its share (`share=`, the pool's lanes), and the same bits come out
(proved by the launcher and the pool); a cancelled, orphaned
(its page stopped asking) or failed final stores nothing; `native.ts` reads the
passes with the render's cancellation signal and before releasing the
job (`DELETE`, `pagehide`), and `GET /api/render/state` gives the mask of
each job.
## X3 · Post-processing pipeline and guard — split into X3a–X3d

The lead's decision (`AI-POST.md` §7): on desktop everything native (the
page only sends settings and receives results), the guard in a crate of its own
without dependencies, and the web behind it.

### X3a · `rt-post`: the guard and the pixels — **Opus** — done

**What.** `AI-POST.md` §3.2 and §7.2: `engine/crates/rt-post` (`std` only,
`f32`, deterministic, no `unsafe`) with conditioning (edges at the id and
normal changes, normalised depth), a tile plan with overlap and blending,
padding to a multiple of 16 and cropping, the complete **guard** (shading
transfer, frequency separation, regions by id with ΔE₀₀, sharpness against
the blur map), the checks and the step machine with backoff; `rt-post-wasm` →
`public/engine/post.wasm`; in `src/ai/`, the TypeScript wrapper of that
wasm and the prompt from materials and lights (`prompt.ts`). Report with the
shape of `GuardReport` (`src/core/ai.ts`).

**Depends on.** Nothing (the passes are synthesised in the tests).

**Acceptance.** The guard, tested with a synthetic "model" that does
forbidden things (moves an edge, changes the colour of a material,
blurs what is in focus, sharpens what is blurred, changes the size, touches
outside the regions): each one is detected and corrected or rejected;
with intervention 0 the output is bit-for-bit identical to the input without
calling the model; the output resolution is always the job's; the
same result native and in wasm, bit for bit; engine gates
(`fmt`, `clippy`, no dependencies in `Cargo.lock`).

**Done.** `engine/crates/rt-post` (`#![forbid(unsafe_code)]`, only
`std` and `rt-core` for `fmath` and the tone curves) with the step machine
`plan(&job) → Plan` (tiles of ≤ 1024² with overlap ≥ 128 px and
the same size, padding to a multiple of 16 repeating the edge; no tiles
if Intervention is 0 or all the aspects are at 0, and then the output
is the input bit for bit without calling the model), `tile_input` (the engine's
image with its exposure and curve, 8-bit sRGB), `conditioning`
(edges 255 on both sides of each change of `partId`, `materialId` or
a normal of more than 30°; depth normalised over the whole image, near
255, the farthest surface 16, background 0) and `accept(&plan, &original,
&passes, &outputs, attempt) → Accepted{image, report} | Retry{strength,
attempt, reason} | Rejected{report}`; `run` is the driver for a
model given as a function. The guard always multiplies the engine's
image by a gain: (a) transfer `ln blur(model) − ln
blur(engine)` (normalised Gaussian over the open regions,
σ = 16·√MP between 8 and 32, computed on a grid up to 8 times
coarser and returned with a cubic B-spline), brought to scene light by the
local slope of the tone curve and split into common change (Style
strength), local luminance (Light, grey gain) and local colour
(Bounces), each part by its control and capped by control × strength of the
attempt; (b) the model's mid band (σ 3 px to low σ) only on materials
with wear, in focus (coc ≤ 1 px, none at ≥ 3 px) and more than 8 px from
an edge; (c) background and locked materials intact and the colour change
of each material reduced until its mean and p95 ΔE₀₀ are within
80 % of the tolerance. Checks independent of how the
result was made: size, pixels changed outside what is allowed (bit
for bit), edge displacement (gradient peak with parabolic refinement,
in the channel with the largest jump), high-band SSIM, sharpness
per 32² block against the blur map and ΔE₀₀ per material
(Sharma, Wu and Dalal's CIEDE2000, 2005, tested with its 34 pairs).
**Provisional** tolerances in a single `struct` (`Tolerances`, stable keys,
can be passed in the job to calibrate): mean ΔE ≤ 2,
p95 ≤ 3, edges ≤ 1.5 px, high SSIM ≥ 0.98, focus ≤ 15 %, caps of
Light 0.3, Bounces 0.15, Style 0.2 and Wear 0.15 (natural logarithm, at
control and intervention 100). JSON report written by hand with the exact
shape of `GuardReport`. `rt-post-wasm` → `public/engine/post.wasm`
(189 KB, no imports) from `npm run engine:build`; `src/ai/post-wasm.ts`
(`PostGuard`, `PostSession`, `runGuarded`, `encodeJob`; worker and Node,
checks the sizes before passing pointers) and `src/ai/prompt.ts`
(`buildPrompt`, fixed negative, `guardMaterials`); `AiGuardMaterial`
added to `src/core/ai.ts`. 50 Rust tests (47 in `rt-post`, 3 for the ABI)
and 16 in vitest; the synthetic "model" moves edges, changes the colour of
a material, blurs what is in focus, sharpens what is blurred, touches the background,
puts wear everywhere and returns another size, and each test fails
if the step that covers it is switched off (checked by switching them off one by one in the
code). Parity: `tests/fixtures/ai-guard.json` (five scenarios:
intact, forbidden, strong, limited, rejected) is pinned by the native test and
the real `post.wasm` reproduces it bit for bit (image, model inputs and
JSON), also in CI. Single-thread native performance: ≈ 2.3 s per attempt
at 1 MP and 7 s at 4 MP.

What did not fit the plan: (1) "Transfer in the logarithmic
domain" was done as the logarithm of the ratio of the blurs (of
light, not of logarithms: blurring logarithms turns smudged text
into a change of light, by Jensen's inequality), as §3.2 says.
(2) The guard works in scene light: the change the model
makes on screen is carried to the scene by the curve's slope, and Light
is a grey scene gain (like more light in the engine); at the shoulder
of the curve that desaturates slightly, so the ΔE₀₀ per material is measured
against the engine's image **with the allowed change** (style and
luminance within the caps) seen through the same curve: it measures the change
in the material's colour, not that of the light. **Fable must confirm that
criterion** in X1b. (3) Sharpness, detail and edges are measured in scene
light (the curve compresses the contrast of highlights as a brighter
render would, and that is not blur), and detail and focus look at
the interior of the regions (4 px from an edge, the jump of a
silhouette changes when relighting only one side; edges have their own
check). The high-band SSIM also excludes the pixels where
Wear may add detail. (4) Edge check per channel
(maximum of the three): with luminance only, relighting a part to the
luminance of the background "erased" an edge that is still seen through
colour. (5) A tile of another size is rejected at the first attempt (a lower strength would not
fix it) and the engine's image is delivered. (6) Provisional
rules it leaves noted for X1b: wear is admitted by every family
with wear types in the catalogue (all but the emissive one; perhaps
glass should not), emitters stay locked, depth of the farthest
surface 16. (7) `AiPostRequest` does not carry the guard's material table
nor the RSB's material order: X3c will have to
add `materials?: AiGuardMaterial[]` (or derive it in the launcher)
and `io/rsb.ts` export the order (`guardMaterials(state, order)` already
expects it); the tone curve code (`tonemapFor`) also lives in
`io/`, so the job receives it as a number. (8) The reason of a
LIMITED says how much was reduced, not why the first attempt failed; the
reason for each retry comes out in `Retry.reason` for the log. (9)
Alignment: the `post.wasm` ABI receives *little-endian* bytes, not
aligned `f32`, so as not to require pointer alignment.

### X3b · stable-diffusion.cpp on desktop — **Opus** — done

**What.** `AI-POST.md` §7.1: `src/data/ai-runtimes.json` with the official
builds pinned (Vulkan and CPU, Windows and Linux x86_64:
URL, size, `sha256`, quoted licence, version, `supports` checked),
the selection rule (Vulkan with a GPU, CPU without one) evaluated identically by the
interface and the launcher, download and installation from *Settings ▸
AI post-processing* (*Inference runtime* row, with progress, resumption
and `sha256`, to `<data>/ai/runtimes/<sha256>/`), the helper process in
`rt-app` (startup, arguments per model key, progress,
cancellation, time limit, shutdown with the application, no
console window on Windows) and the API `/api/ai/runtime` (state as
`AiRuntimeStatus`) and `/api/ai/run` (one *img2img* inference without guard:
image, control, prompt, strength, seed).

**Depends on.** P2.

**Acceptance.** Tests with a **fake** helper process (a test binary
that speaks the same protocol): exact arguments per key, progress,
cancellation, time limit, hung process, output of a different size rejected; a `sha256` that does not
match is not installed. With the real Linux CPU build, `--help`/version are
read and the *Settings* row shows it. Without downloading multi-GB weights in this environment: the
first real image is made on a machine with a GPU.

**Done.** `src/data/ai-runtimes.json` pins the official release
**`master-959-d637cfb`** of stable-diffusion.cpp (commit `d637cfb9…`,
2026-10-12; ggml `d25b121c…`): `SDCPP_WIN_VULKAN` (30,139,117 B),
`SDCPP_WIN_CPU` (17,558,769 B), `SDCPP_LINUX_VULKAN` (37,009,067 B) and
`SDCPP_LINUX_CPU` (26,143,940 B), each zip downloaded once to measure it
and compute its `sha256`; MIT licences quoted in `docs/ai-licences.md` §7.
`supports`: the six desktop keys according to the tag's documentation
and the arguments we build; `verified: []`. In the same JSON, as
data that X1 can correct without touching code: the **selection rule**
(`choice` rows, evaluated identically by `src/core/ai-runtimes.ts` and
`rt-app/src/ai/catalogue.rs`, both against
`tests/fixtures/ai-runtime-cases.json`) and the **profiles per family**
(load arguments with `@role`, steps, cfg, sampler, *flow shift*,
image as `init` or `init+ref`, ControlNets). In `rt-app/src/ai/`, `std` only:
own *inflate* (RFC 1951) and zip (APPNOTE, Zip64), a complete PNG reader
(all types, filters, Adam7), base64; the runtime store
(`<data>/ai/runtimes/<sha256>/`, `sha256` before installing, safe
decompression, `--version` and `--list-devices`); the **server mode** (`sd-server`,
native API `/sdcpp/v1/img_gen`, the model stays loaded) on a random local
loopback address, with progress read from standard output,
cancellation, time limit, hang detection, crash handling, rejection of a different
size, release on inactivity and on closing, and clean-up of
one left over by a previous launch; the API `/api/ai/runtime`,
`/api/ai/runtimes/<key>/…` and `/api/ai/run`. Interface: `src/io/ai-runtime.ts`
and the *Inference runtime* row of *Settings* with *Run on*
(`ai.backend`). Tests with `rt-fake-sd`, a test binary that speaks
the same protocol, and with the real `curl` against a local server. **For
real**, here: the four zips unpacked by our reader come out
identical file by file to those of Python's `zipfile`; the real
Linux CPU build is installed through the launcher and answers `--version`
(*stable-diffusion.cpp version unknown, commit d637cfb*), `--list-devices`
and `--help`, and the row shows it; the real download from GitHub with a pause at
4.7 MB and resumption takes 4.3 s; and a real *img2img* with `SD15_LIGHT` on
CPU (512², 8 steps × strength 0.5 = 5 sampling steps, pinned weights
checked by `sha256` and deleted afterwards) gave a correct image in
**1307 s** end to end (the machine shared with other agents, with
a load average of 10 to 15 on 4 vCPU: 1 s to start the server,
3.5 min reading weights on first use, 6 min until the first step (encoding the
image), 2.5 to 3 min per step and 3.5 min decoding; it is not a
performance measurement, which belongs to X1 part B).

**What did not fit the plan.** (1) The download cannot be done by the page
like the models': GitHub release downloads do not send CORS
headers. The launcher does it with the system's `curl` (on Windows
since 10 1803), with the same progress, pause, resumption and `sha256`; without
`curl`, *Install from a file…*. (2) There is no official "AVX2"
build: the CPU one carries all the x86-64 variants of ggml and chooses at
run time. (3) The Windows ones need the Visual C++ 2015–2022 runtime
(they do not bring it): if it is missing, the row says which DLL; the installer
(P2) should install it. The Linux ones need glibc 2.38 (Ubuntu 24.04
or later). (4) `sd-server` reflects any `Origin` and numbers its
jobs: hence the random address `127.a.b.c`. (5) It loads the weights
on first use: the first job shows *Loading*. (6) The editing ones
(klein, Qwen-Edit) go as *img2img* plus a reference image
(`init+ref`): our own construction, untested. (7) `ai.gpu` (which GPU) is
not passed: there is no reliable correspondence with the Vulkan indices; stable-diffusion.cpp
chooses. (8) The limits (load 30 min, image 60 min,
silence 10 min, inactivity 5 min) are starting values, for X1. (9) The catalogue of builds is
always the bundled one; the tests supply their own with `server::Options` when building the server, a field that the
application never fills. (10) *About* does not yet list
stable-diffusion.cpp and ggml: their texts go in the runtime folder and in
`docs/ai-licences.md`.

**Correction after merging (CI in release).** The first version read
`<data>/ai/runtimes-override.json` only in debug builds, and the tests
came in through there. The engine job in CI also runs
`cargo test --workspace --release`, and there 9 of the 11 tests in
`tests/ai.rs` failed: the tests were more permissive than the real
binary. Now the catalogue and the test downloader enter through
`server::Options { ai_runtimes }` (`Server::start_with`). `Ai::new` no longer
reads anything from the data folder in any build, and
`a_catalogue_in_the_data_folder_is_never_read` checks it, failing if the reading
returns. There was a second debug assumption: the pause and resume test
expected more than 1 MB downloaded, and in release the fake takes up less than 600 kB. The
file now carries 8 MiB of padding and the pause is requested at 1/8 of the total. Both pass: `cargo test --workspace`
and `cargo test --workspace --release`.

**Second correction (CI, the orphan server).** On the GitHub
runner, `a_server_left_by_a_previous_launch_is_stopped_at_start` failed
one time in two with "the orphan still runs". The cause was in the
test. It started the fake server an instant before the clean-up.
`posix_spawn` is a *vfork*, and Linux lets the parent continue before the
child's `execve` finishes, while the child is still using the parent's memory.
At that moment `/proc/<pid>/exe` still names the test's executable,
so the clean-up was right not to kill it. It was reproduced
locally by holding the child's `exec_update_lock` (`/proc/<pid>/syscall`):
the `exe` read was the test binary. Now the test waits, by condition and
with a 60 s deadline, for the fake to have created `args.log`
(which its own code does), and kills it at the end even if it fails. With
the lock held it passes 20 of 20 times; the earlier form failed 2 of
20. While reviewing how the process is recognised, a real orphan appeared:
the clean-up compared the path as it was written, and if the data folder
is behind a symbolic link, the kernel gives the path with the link
resolved. A server left there was never stopped. Now the file is compared
(device and inode, `proc::runs_server`), or the path with links resolved
when the file no longer exists. Checked by
`a_server_left_in_a_data_folder_behind_a_link_is_stopped_too` and the
unit test `a_server_is_recognised_through_a_link`; both fail
with the previous comparison.

### X3c · The complete desktop pipeline — **Opus** — done

**What.** `AI-POST.md` §7.3: `/api/ai/post` in the launcher (stored passes
of the render → `rt-post` → stable-diffusion.cpp per tile →
`rt-post` → retries), progress and cancellation; the desktop
`AiPostService` in `src/io/`; integration in the queue (the job stores the
two images and the report; the history keeps them); `AI_AVAILABLE`
becomes whatever `status()` says. In addition, what X3a and X4 left noted: the floor with `FLOOR_ID`
(`AI-POST.md` §7.4) in the guard, the synthetic service and the three.js
passes; the guard's material table in `AiPostRequest` and the
material order exported by `io/rsb.ts`; the real prompt from
`src/ai/prompt.ts`; the `RENDER` source in the queue; the Visual C++
libraries that stable-diffusion.cpp needs on Windows (next to the
executable or in the installer); stable-diffusion.cpp and ggml in *About*.

**Depends on.** X2, X3a, X3b; X4 to see it end to end.

**Acceptance.** End to end with the fake helper process: a final
render with AI leaves two images and the report in the history; with
intervention 0, the AI image is the engine's bit for bit; cancelling
halfway leaves the engine's; a model that the build does not load comes out with
the reason. A short checklist for a machine with a GPU (Vulkan,
a 1024² image, time noted).

**Done** (2026-10-13). **Launcher** (`rt-app/src/ai/post.rs`, which now links `rt-post`):
`POST /api/ai/post` with `{source: {kind: RENDER, renderId}, settings, prompt, negative, modelKey,
materials}` or, for the preview, the binary `RPI1` body (JSON, `RPL1` image, `RPP1` passes,
≤ 512 px); `GET /api/ai/post/<id>?after=n` (state, `stage`, tile and attempt from 1, fraction
that does not go backwards, `calls`, the `GuardReport` at the end), `GET …/image` (`RPL1`, linear with straight
alpha) and `DELETE`; `aiPost: 1` in `/api/info`. The native driver is the step machine of X3a
(`plan` → `tile_input` and `control_planes` per tile → the `sd-server` of X3b, loaded between
calls → `accept` → retries at `RETRY_FACTOR` up to `MAX_ATTEMPTS`); with Intervention 0 the plan
has no tiles, the inference runtime is neither prepared nor started (it works without it installed) and
the image is the engine's bit for bit; a tile of another size reaches the guard as such (the
`size` check) and is rejected at the first attempt; a post that nobody asks about for 2 min is stopped.
The X2 store keeps with each render its exposure and its curve (`Look`, also on disk), and the
linear image is the page's conversion (`linear_of`: the sums by `fround(1/n)`, the colour divided by
the coverage where it is not opaque, the threshold `1 − 1e-6` in `f64` like the JavaScript number; an
`f32` threshold would have called the `f32` just below opaque, and the test watches for it). The fake
`rt-fake-sd` gains a `gain` mode (it brightens smoothly, like a model that obeys) and `acceptMs` (an engine that takes time to accept the job, to see the start state of each tile). **Visual C++**:
`proc::missing_dll`, `Probe.dllMissing` and `needs_vc_runtime` (Windows, a DLL that is missing and some from the
Visual C++ runtime absent from the engine's folder and from `System32`) → `vcRuntime: "missing"` and
`vcRuntimeUrl` in the row; the interface shows *Install Microsoft Visual C++ runtime…* (Microsoft's official
page with `openExternal`: we do not redistribute its DLLs) and *Check again*.
*About* lists stable-diffusion.cpp and ggml with their MIT texts, copied byte for byte from the pinned commits
(`tools/third-party/`, `tools/licences.mjs`). **Page**: `src/io/ai-post.ts`
(`DesktopAiService`: `status()` is `/api/ai/runtime` with the person's settings and the active model,
`aiRuntimeQuery` from `src/ui/ai-query.ts`; `post()` sends, follows, reads the image and forgets; an abort sends `DELETE`); `main.ts` uses it
when the launcher says `aiPost`, the web continues with `notBuiltService` and `?ai=synthetic` with the
synthetic one; **`AI_AVAILABLE` no longer exists**. The queue asks the render to leave the guard's passes in the
launcher (`aiPasses`, `passesInLauncher`: they do not even come back to the page; without albedo, which the guard does not
use and which costs one ray per sample), sends the `RENDER` source with the material table
(`guardMaterials` over `ProjectScene.materialOrder`) and the prompt from `src/ai/prompt.ts`, shows the
progress per tile in the row (*AI · tile 2 of 4 · attempt 2*, `RenderProgress.ai`) and writes the
AI image from linear light with the render's exposure and curve (`straightBytes`,
`straightWords16`, `straightExr`: 8- and 16-bit PNG bit for bit with the engine's, EXR on every opaque pixel);
stopping or pausing during the AI keeps the engine's image in the history and, with *Pause*, the job
goes back to waiting as in P3a. **The floor, `FLOOR_ID`**: in the guard it was almost a region, but
`FLOOR_ID` is `u32::MAX`, the same value the region cache started with, so a floor seen
before any part stayed as background; now it is a real region, which is relit and has
its colour check (*Floor*, no wear); the control's depth is normalised over the parts
and the floor is drawn at that scale, clipped (its plane reaches the horizon); the synthetic service names it;
the three.js passes find it with the engine's central rays (`floorHits`, perspective and
orthographic, also from below the floor) and match the engine's on every floor pixel,
horizon included. **For real here**: the real launcher with all of the page's code (native engine,
queue, desktop service) against the fake installed where the pinned Linux build would go
(`tests/ai-desktop.test.ts`); and once the whole pipeline with real stable-diffusion.cpp and SD 1.5 with its
depth ControlNet on CPU (`real_post_with_sd15_and_its_depth_controlnet_on_the_cpu`, ignored without the weights): the 256 × 192 sample with the floor, Intervention 100 and 10 steps (5 of sampling at strength 0.4), **53 s** on 4 cores (13 s of weight loading, ~6.5 s per step), accepted at the first attempt: detail 0.998, edges 0.02, ΔE₉₅ 1.9 on the coral and 1.6 on the blue; the floor reached 2.2 and the guard left its colour change at 71 %. The weights were deleted afterwards. **With the fake**: everything else. Tests: 13 new in
Rust (3 in `rt-post`, 3 unit tests in `rt-app` and 9 in `tests/ai_post.rs`, one more ignored with the real
weights) and 29 in vitest (14 for the service and what is asked of it, 4 against the real launcher, 4 for the queue, 3 for the passes, 1 for the
synthetic, 3 for the runtime row and *About*), plus those of X2 and X4 that change with the floor; 26
mutations checked, each test fails if what it guards is broken.

**What did not fit the plan.** (1) **The control**: §3.2 asks for edges and depth from the ControlNet, and *tile*
for large outputs; `sd-server` carries a single loaded ControlNet and only SD 1.5 has any in the
profiles (*tile* and *depth*), so the depth from the passes is sent (the first `depth`, `tile`
that the family has) in preview and in final alike, so as not to restart the server between one and
the other; edges have no ControlNet in the profiles. Provisional decision for X1b. (2) **Depth
with floor**: §7.2 says "normalised over the whole image"; with the floor as a surface, its plane to
the horizon left the product in a few levels, so the scale is that of the parts and the floor is
clipped to it (without parts, the floor sets the scale). Pending for Fable in X1b. (3) **EXR in the
viewer**: the history stores the AI image of an EXR job as it is (EXR) and browsers do not
show it: the thumbnail comes from an 8-bit copy, but the viewer does not compare *Render | AI* in EXR (it would need
a second view image in the history, like the engine's `display`; noted). (4)
**Pause during the AI**: the job goes back to waiting (P3a: a render is not resumed halfway) and the engine's
image is already in the history, so *Resume* leaves a second result of the same job. (5)
**`AiPostRequest`** gains `materials?` (added); the rest of the added contract goes outside `core/ai.ts`:
`FrameRequest.aiPasses`, `FrameResult.renderId` and `tone`, `AiEncodeOptions.tone`, `AiPort.materials` and
`renderSource`, `AiPort.scenePrompt(state, settings?)`, `RenderProgress.ai`, `PassIds.floor`,
`RenderOptions.passesInLauncher`, `AI_GUARD_PASSES` (`core/ai-post.ts`). (6) The AI fraction takes up the
job's bar in its place (the render has already finished): the row says what it measures. (7) The Visual C++ libraries do not go
next to the executable nor in the installer: they are not redistributed; the button leads to Microsoft. (8) *Settings ▸
AI post-processing* no longer says *arrives in a future version* where the service does not say `NOT_BUILT`.
(9) Switching the toggle off releases the model (`DELETE /api/ai/sidecar`, which does nothing if a job
is using it). (10) The `detailSsim` tolerance (and the others) can be passed in the request (`tolerances`) to
calibrate in X1b; the tests use it to force retries. (11) With the real engine, the first
call says *inference* half a second before `sd-server` paints its loading bar (the job is already
`generating` and there is no bar yet); the fraction does not go backwards and then says *loading*: cosmetic,
noted for X3b. (12) **The active model in the render window**: without a hand-chosen model, the active one
is the recommendation for the machine, and the machine detection was only launched by *Settings*; with the
desktop service, the toggle said *No model downloaded* and led to *Settings* even though the model
was installed (the captures against the real launcher showed it). Now the desktop with `aiPost`
detects the machine at startup, the section also launches it, and the section asks again when what
it asks about changes (`aiStatusKey`: the device, the backend, the active model, the installed models), with its
test. (13) **The results viewer header** squeezed the guard report into a narrow column
next to the title, one or two words per line (the button bar did not give way): now the report has its
own line at full width (a single one, with an ellipsis and the full text in the tooltip), the bar goes under
the title when they do not fit together and *Close* stays in the corner. `tools/ai-post-check.mjs` (j) measures it at
1600, 1280 and 960 px in English and in Spanish (overlaps, header overflows, a single line, full width, the
full title) and fails with the earlier header; captures `docs/ui/ai-results-viewer.png` and
`ai-results-light.png` redone.

### X3d · The web — **Opus**

**What.** `AI-POST.md` §2.3: ONNX Runtime Web (MIT) with WebGPU in
per-stage workers, **export the VAE encoder to ONNX** from the Apache-2.0
`ae.safetensors` so that `ZIMAGE_WEB` exists (with its
`sha256`s), cache in OPFS with `persist()`, fragments of ≤ 1 GiB, the
step-machine driver in a worker with `post.wasm`.
New dependency noted in `ARCHITECTURE.md` §1.

**Depends on.** X3c.

**Acceptance.** The same as X3c with the web service; without WebGPU, the
toggle stays disabled with the reason.

## X4 · Post-processing interface — **Sonnet** — done

**What.** `AI-POST.md` §4 and §7.5: toggle, six-control
configurator, protection chips, *Another variation*, preview in Fast
mode with a divider (the §7.4 passes drawn with three.js at the preview's
size), updating on release with the measured time, a full-engine
preview option, the guard's report in the results viewer
with U5's divider, and the two thumbnails in the queue; the
settings in the store (§7.5). All against `AiPostService`
(`src/core/ai.ts`) with a **synthetic service** (deterministic, no
model) until X3c connects the real one; in the meantime the toggle says
*coming soon* outside the tests.

**Depends on.** U5, U6; the contract in `src/core/ai.ts`.

**Acceptance.** Each control at 0 does not change the look (test with the synthetic
service); the preview is not recomputed during a drag; the
three.js passes match the engine's in ids and depth in a test
scene; captures of the section and of the viewer with the divider.

**Done.** *Store* (§7.5): `RenderSettings.ai` is `{ enabled, previewFullEngine }
& AiPipelineSettings` with `DEFAULT_AI`; `normaliseAi` leaves the controls as
integers 0..100, an unknown style as `NATURAL` and the seed as u32, and
returns the same object when nothing changes; an old project (`{ enabled }`)
opens with the default values; each control is an undoable `render/set`
action (dragging a control, one step), *Another variation* changes the seed
(`nextSeed`, congruential without repetition), jobs copy the settings and
the default intervention from Settings reaches new projects. **Render
window** (`ui/panels/ai-post.ts`): toggle with the line for the model in
use (data from the Settings manager), the reason from `AiUnavailableReason` when it
cannot, and open Settings when the model or runtime is missing; the six controls with their
sentence, the six chips with a lock and no toggle, and *Another variation*; Fast-mode
preview at 384–512 px with U5's divider, **on release** (the
brain is in `ui/ai-preview.ts`, without DOM: `hold`/`touch`/`release`, the
frame is reused while only the controls change, an old preview
is abandoned), time **measured** around the pipeline call,
the Fast-mode note and the full-engine option. **Passes with three.js**
(`render/preview-passes.ts`, `PreviewEngine.aiFrame`): albedo, world normal
with Z up, depth along the axis, part and material ids
(RSB index + 1, which `projectScene` now delivers in `ids`) packed
into bytes in an 8-bit target without filtering or multisample, and the circle of
confusion of the thin lens (`core/lens-coc.ts`). **Synthetic service**
(`ai/synthetic.ts`): a soft gain over the engine's image (light lifts
the shadows, bounces warm the low frequencies, style tints, wear
adds nothing, the seed only ripples), everything at 0 returns the input
bit for bit, a **measured** guard report (size, pixels outside, edge
displacement, high-band SSIM, sharpness per tile, ΔE₀₀ per material with
CIEDE2000) and the retry rule of §7.2 (`LIMITED`, `REJECTED`). It only runs
with `?ai=synthetic`; without it the toggle says *coming soon*. **Viewer and
queue**: the job stores the engine's image and, next to it, the AI's
(`…_AI.png`); the result keeps both and the report (`ResultMeta.ai`,
only added fields); the viewer opens *Render | AI* with the divider, the line
*Checked: …*, *The AI was limited to N %* or the rejection sentence, and saves
each image separately; the queue and the history show the two thumbnails.
**Storage of the second image**: an optional fourth parameter `ai` of
`ResultsStore.add` and `ai?` in what `get` returns; IndexedDB stores it in the
same blob record and the desktop, through P3e's slot, as
`<data>/results/<id>.ai.<ext>` with `PUT`/`GET /api/store/results/<id>/ai`
(a small change in `rt-app/src/appdata.rs`, its test and the crate's
README); no new access to browser storage on
desktop. Tests: 1,390 in vitest (98 for X4, 6 of them in a Chromium with SwiftShader
that is skipped where there is no browser: three.js against the CPU ray with the
engine's rules) and one new launcher test (`rt-app`, 9 in `appdata`);
8 mutations checked; 25 browser checks in
`tools/ai-post-check.mjs` (and those of U5 and U6 remain green).
Captures: `docs/ui/ai-section-dark.png`, `ai-section-light.png`,
`ai-results-viewer.png`, `ai-results-light.png` and `ai-queue.png`.

**What did not fit the plan.** (1) `AI_AVAILABLE` is no longer read by the store:
`patchSettings` left `enabled` false while the constant was, and
with a service that says `available` that cannot hold; the toggle and the
queue look at `AiPostService.status()` (U5's test *“video and AI stay off”*
became *“video stays off…”*). (2) Until X3c the AI's input in the queue
is **INLINE**: the 8-bit image that has already been stored is decoded
(`display ?? file`) and the passes are drawn with three.js at the job's size,
instead of the `RENDER` source that the launcher will store with the
linear image; that is why the AI image comes out at 8-bit quality, even
in an EXR or 16-bit PNG job. The preview treats the Fast-mode image
(with its tone curve) as linear light decoded with sRGB; which curve
the real model sees is decided by X3c. (3) The `coc` follows `Camera::generate_ray`
(sensor at the focal length, aperture `focal/fstop`, focus plane at
`focusDist`): the footprint of a pixel on the focus plane is
`sensor/longSide × focusDist/focal`; the exact thin lens changes `focusDist`
to `focusDist − focal`. **X2 must emit the same formula.** (4) The
three.js passes are an approximation of the contract: the albedo is the base colour of the
first hit (it does not follow specular bounces), the floor and the light panels
do not count (background 0 / +∞), both faces of a triangle count and the
normal is given oriented towards the viewer; X2 has to decide the same or the difference
is noted. (5) *ΔE max* is the largest **mean** ΔE₀₀ of a material, and
*geometry ✓* gathers edges, pixels outside and high-band detail; if the real guard
splits the checks differently, `reportItems` changes. (6) The
synthetic service uses as limits the factory values of Settings ▸
Advanced, not X1's. (7) Animations do not go through the AI (the toggle
is disabled in *Animation*, with *coming soon*); the AI image is
saved alone next to the engine's, with the `_AI` suffix, so that a batch
has it without opening each result. (8) `numberField` and `slider` gain `onHold` and
`onRelease`, and the slider **now follows the value on undo** even if it has
focus (before, the knob stayed where it was while the field changed:
the browser check found it, and now guards it). (9) The
prompt is a placeholder (`AiPort.scenePrompt`: empty and the fixed negative of §3.2)
until X3a brings `src/ai/prompt.ts`; `rw.aiWhy.NO_WEBGPU` goes into
`WEB_ONLY_STRINGS` (it names the browser and can only occur on the web).

**Waits for X3c.** Connecting the real service (today `main.ts` chooses between the
synthetic one and `notBuiltService`), changing the queue's input to the
`RENDER` source with the passes that the launcher stores, the per-tile progress in the
job (today `onProgress` is ignored in the queue), X3a's prompt, removing
`AI_AVAILABLE`, and having the two history images come from the engine's linear
image. And X2: the same ids, the same depth and the same `coc`
that the preview draws (the browser test is the yardstick).

## X4b · Own prompt and variants — **Opus** — done

**Request (2026-10-13):** if the model supports it, leave a text
prompt in the settings of that render, and let a few
variants be made; by default, just one.

**Lead's decisions.**
- **Own prompt** in the *AI post-processing* section of the render
  window (it belongs to the job: it is stored in the project, is undoable and each
  job in the queue carries its own): a multi-line field, empty by
  default, of up to 400 characters, with the note *Describe the light or the mood; the geometry, the materials and the focus stay protected*.
  It is **appended** to the prompt generated from the scene (`src/ai/prompt.ts`),
  never replaces it, and the fixed negative remains. It only appears if the active
  model supports it: a new `textPrompt` capability in
  `src/data/ai-models.json` (added, nothing renamed; the bundled models
  have it; an imported one declares it in its `model.repackshot.json`);
  otherwise the field is shown disabled with the reason.
- **Variants**: a number from 1 to 8, **1 by default**, next to *Another
  variation*. A job with N variants makes **a single engine render**
  and N AI passes with consecutive seeds (seed, seed + 1…),
  with the model loaded once; the queue says *AI · variant 2 of 4 ·
  tile 3 of 4*; each variant carries its guard report. The preview
  remains a single variant. The estimated time is shown (N × what was measured)
  when there is a measurement.
- **Results**: a result stores the render and its N AI images
  (on desktop, `<id>.ai.<n>.<ext>` in the results folder; the earlier
  `ai` is read as variant 1); the viewer shows a strip of
  thumbnails to choose a variant, the divider compares the chosen one with the
  render and one can *Save this variant* or *Save all*; the
  history and the queue show how many there are. File names with the
  suffix `_AI`, `_AI_2`, `_AI_3`…

- **System prompt** (request, 2026-10-13): in *Settings ▸
  AI post-processing* a *System prompt* section, general for all
  images (it is an application setting, not a project one), with a
  multi-line field, *Restore default* and a note that
  the guard's protections do not depend on it. Order when composing:
  **system → scene → the job's own**; the fixed negative, separate. The
  default is set by the lead, in English (the models' text encoders
  perform better in English):

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

  For models with a prompt length limit (SD 1.5: 77 CLIP tokens;
  a `maxPromptTokens` capability in `ai-models.json`), the short version
  is used, also from the lead, and the rest is trimmed in this
  order (the job's own first, then the scene, then the
  system), warning about what was trimmed:

  > photorealistic product photo, same composition, geometry, materials
  > and labels, same lighting and depth of field, natural soft shadows,
  > subtle bounce light, realistic highlights, fine micro-detail,
  > true-to-life colours, nothing added

**Acceptance.** Tests: the own prompt reaches the model after the scene's
and the fixed negative is intact; without the `textPrompt` capability, it is not sent and the
field says so; N variants = one engine render and N calls with
consecutive seeds, and cancelling halfway leaves the render and the finished
variants; save and open (project and results, including those with a
single earlier `ai`); undo of the prompt (a text change is one
entry on leaving the field) and of the number; strings in `es` and `en`; achromatic
chrome; captures of the section and of the viewer with several variants.

**Done** (2026-10-13). **Own prompt**: `AiPipelineSettings.userPrompt` (trimmed, up to
`MAX_USER_PROMPT` = 400 characters) in the render window section, under the six controls: a
multi-line field (`textArea` from `ui/components/controls.ts`) with a counter and the lead's note; it is
saved on stopping typing (700 ms) and on leaving the field, and everything in one visit carries the same gesture,
so it is **one** undo entry (*AI post-processing: Own prompt*); while it has focus, what
comes back from the store does not overwrite what is typed (trimming a trailing space does not eat it). It goes in the
project and each job carries its own; an earlier project opens without it. It is composed **system → scene →
own** (`composePrompt`, `src/core/ai-prompt.ts`; `buildPrompt(state, settings, context?)` in
`src/ai/prompt.ts`, which without context still gives only the scene's) and the fixed negative goes apart, the same. **Capabilities**: `capabilities: { textPrompt, maxPromptTokens? }` in each model of `ai-models.json` (all
with `textPrompt`; `SD15_LIGHT` with 77) and in the manifest of an imported one (the import form
asks for it); `ModelView.textPrompt`/`maxPromptTokens`; the model the service says is active governs
(`promptCaps`; the synthetic one admits everything, an unknown one nothing). Without `textPrompt` the field is shown
disabled with the reason and is not sent. **System prompt** (`ai.systemPrompt`, *Settings ▸
AI post-processing ▸ System prompt*): the lead's text by default, multi-line field,
counter, *Restore default* and the note that the guard does not depend on it; it may be left
empty; on desktop it goes in `settings.json` like every setting (test with P3e's spy). With
`maxPromptTokens` the **short version** is used while the text is the default (with the same
spaces or not) and it is trimmed word by word from the end, **the own, then the scene, then the
system**, with a conservative estimate documented in `AI-POST.md` §4; the line under the field in the
window says what is left out, and the one in Settings what the model in use receives. **Variants**:
`AiPipelineSettings.variants` (1–8, 1 by default) next to *Another variation*, undoable, with the line
of the seeds and the estimated time; changing it does not redo the preview (it is still one image). In the
queue, `aiStep` makes **one render** and N requests from the same origin (the stored `renderId`, or the image
decoded only once) with `variantSettings` (seed + n − 1), each image with its report and
`aiFileName(name, n)` (`_AI`, `_AI_2`…); the row says *AI · variant 2 of 4 · tile 3 of 4* and the bar
measures the variants together; stopping halfway keeps the render and the finished ones; a rejected one is left with
its report and no image; if one fails, the earlier ones stay. **Results**: `ResultMeta.aiMore` (the
first still in `ai`), `aiVariantsOf`/`aiImagesOf`, `ResultsStore.add(…, ai, aiMore)` in memory, in the
IndexedDB record and in the launcher as `<id>.ai.<n>.<ext>` with `PUT/GET /api/store/results/<id>/ai/<n>`
(`appdata.rs`, additive: `aiVariants` in the index; the earlier `<id>.ai.<ext>` is read as variant 1 and
`…/ai` remains); the migration from the browser copies them. The viewer has the **thumbnail strip** (a
line of its own between the header and the image), the divider compares the chosen one without losing the zoom
(`SplitCompare.setB`), its report on the line, *Save this variant* and *Save all*; the queue and the
history show *×4* and the queue *AI × 4*; the window footer, *AI on · 4 variants*. Tests: 39
new in vitest (22 for the prompt, the capabilities, the system and the store; 15 for variants against the
synthetic one, a service like the launcher's and the `DesktopAiService` against a stand-in launcher; 1 for
persistence of the setting on desktop; 1 end to end with the real launcher and `rt-fake-sd`: three
variants, one render, seeds 20, 21 and 22 in the fake engine's log, which does not start again), plus
those that changed (the launcher double learns `…/ai/<n>` as strict as the real one); 1 in Rust
(`appdata`); 10 new browser checks in `tools/ai-post-check.mjs` (k, l and the strip in j;
36 in total, all green);
18 mutations checked. Captures: `docs/ui/ai-section-prompt.png`, `ai-results-variants.png` and
`settings-ai-prompt.png`.

**What did not fit the plan.** (1) `userPrompt` and `variants` are **optional** in the contract
(`AiPipelineSettings`, so as not to break whoever builds one without them) and mandatory in the store
(`AiSettings` is `Required<…>`); the launcher does not read them: each request is one image with its seed and the
prompt already composed. (2) The composition and the count live in `src/core/ai-prompt.ts` (pure, so that
Settings can use them without the AI port) and `src/ai/prompt.ts` calls them. (3) On desktop the new variant 1
is written `<id>.ai.1.<ext>`, as the plan asks; `<id>.ai.<ext>` is kept for reading earlier ones. (4) The
*token* estimate is genuinely conservative: the short version counts 65 of the 77 (with real CLIP, about
45), so with SD 1.5 the own prompt almost never fits; refining it (or bringing the CLIP vocabulary,
1.6 MB) is left for X1b. (5) The system and scene prompts are also sent to a model without
`textPrompt` (as the scene's was before); only the job's own is withheld. An imported `sd15` or
`sdxl` without `maxPromptTokens` reads 77. Z-Image, FLUX.2 klein and Qwen carry no limit: their encoders
read hundreds of tokens and the longest composed text fits; X1b confirms it. (6) **The estimated time** is N ×
the job's pixels / the AI speed measured around each request of the last AI job
on this machine (`UiState.aiThroughput`), not N × the preview's measurement (at 512 px it says nothing about the
tiles of a final); without a measurement, the line says it is measured with the first one; it includes loading the model
if there was one, so it errs on the high side. (7) When comparing with another result (*Compare with…*) the strip only
changes the report line: the divider compares the two results. (8) `src/main.ts` did not pass the list
of variants to the history (`results.add` with four arguments): reading found it before a test did; it is guarded by
browser check (k), which is the one that goes through `main.ts`.

## X5 · Settings and models — absorbed into U6

The model manager, the chooser and the machine detection arrive in
**U6**, because they do not need the pipeline. What does need it (checking
live that the active model fits, and a one-image test from
*Settings*) moves to X4.

## K1 · Scene type, interior lighting and interiors Doctor — **Sonnet** — done

**What.** `scene.type ∈ {PRODUCT, INTERIOR, CATALOGUE}` in the store and in
the inspector's *Product* section, with the table of default values
from `INTERIORS.md` §3.1 applied on changing it (defaults only: no
control disappears); a new **Interior** style in `LIGHT_STYLES` and
`LIGHT_SETUPS` (*Morning window*, *Midday window*, *Afternoon window*,
*Overcast*, *Night lamps*, *Blue hour*, *White studio room*),
each recipe with `world` and exposure, without touching the 72 existing ones; the
scene checks of the interiors Doctor from `INTERIORS.md` §3.6 that
do not depend on the engine (scale and units, missing opening with sun or
sky, thick glass, lens < 18 mm, eye height, near clipping,
inverted normals) with their fixes.

**Depends on.** U1, L4.

**Acceptance.** Switching type and back leaves the state identical except what
the owner touched (test); the new setups pass the count and normalisation
tests; each new check detects its case and its fix
clears it; capture with the *Interior* type active.

**Done.**

*Scene type.* `ProjectState.scene.type` (`PRODUCT` · `INTERIOR` · `CATALOGUE`, `Product` by default) and the
action `scene/setType`, a single undo entry. The values are data (`src/data/scene-types.ts`, `SCENE_TYPES`:
stable key, label and intent in both languages, and the default values of each type) and what applies them is
`src/core/scene-type.ts`. In the inspector's *Product* section, above *Product type*, a segmented control
*Product · Interior · Catalogue* with each type's intent in its help and a note saying that no control moves;
the *Light* section jumps to the *Interior* style when it is chosen (interface state, not project state) and goes back to *All* on
leaving it. **Switching type and back leaves the project as it was except for what was touched in between**: each value that a
type writes is a slot (10 fixed ones and one per camera, `camera.focal:<id>`) with what was there (`base`) and what the type
put (`applied`), stored in `scene.typeBase`. On switching, a slot whose value is still `applied` was touched by nobody
and goes back to `base` before the new type writes its own; one that no longer is was touched by the person, and its value is the new
`base`. A type that writes what was already there remembers nothing, and going back to Product leaves no memory (`scene.typeBase` disappears).
A loaded HDRI is not replaced by any type (it is the table's “or interior HDRI”, and `worldFor` also lets it win) and a
locked camera keeps its optics. **Project**: `scene.type` is saved and, as long as it is not Product, `scene.typeBase`; the
schema stays at 2; an earlier project has neither and opens as Product, a type this version does not know opens as
Product and of the memory only the slots this version knows are kept, with values that slot admits
(`normalizeSceneType`, `normalizeTypeBase`).

*The table of `INTERIORS.md` §3.1, as applied* (what Product does not write is what the project already has; the
rows that name something that does not exist yet are under “What did not fit”):

| Row | Product | Interior | Catalogue |
| --- | --- | --- | --- |
| Environment | writes nothing | environment type *Sky* (sun and sky) | *Studio dome* and white colour background `[1, 1, 1, 1]` |
| Bounces | writes nothing (those of the quality level) | 16 (`render.advanced.maxBounces`) | 8 |
| Caustics | writes nothing (Automatic) | Off | Off |
| Floor shadow | writes nothing | no contact shadow (`studio.shadow` off) | contact shadow on and soft (`environment.groundShadow` 0.35) |
| Transform | writes nothing | AgX | Standard |
| Target samples | writes nothing (256) | 512 (the level becomes *Custom*), finish by noise and denoise in viewport and render | 256 (the *Preview* level) |
| Camera | writes nothing | 28 mm on each camera that is not locked | 50 mm |

*Interior style.* `LIGHT_STYLES` goes from 9 to 10 entries (`INTERIOR` last) and `LIGHT_SETUPS` from 88 to 95: the seven
recipes are **at the end**, so no earlier key or order moved (the 72 setups of the base catalogue and the
16 sets, intact: a test compares the 71 rigs with the fixture from before L6). Each recipe is a set without decoration:
it chooses its world (`SKY` with a sun light that places the sky's sun, or `STUDIO`), and brings its exposure offset
(`exposureEv`) and the environment intensity (`envStrength`), because the time of day **is** the image's brightness and here,
unlike the other setups, choosing one does change the look. The lights are normalised to the product-type level
as all of them are (a test with the 16 types: error < 10⁻⁶). A recipe that mixes a sun with panels carries *shares* on
the `specIrradiance` scale (a sun counts its irradiance in W/m² and a panel its watts over 4π d²): the *share* of a
panel that gives `r` times what the sun does is 4 d² r times the sun's (hence the windows carry 5 to 14 against the sun's 1; the
calculation is in the comment in `light-setups.ts`). The figures of the seven recipes are a proposal (◆ pending Fable: the
table is under “What did not fit”, 1). Looking at the thumbnails (`SPHERES`, 256 × 256, 96 samples) the morning leans warm, midday is
neutral, the afternoon is amber, *Overcast* and *White room* are soft and bright, the lamps leave the room dark and the blue
hour splits warm on the left and blue on the right. **Thumbnails**: the seven were rendered with the native engine
(`node tools/setup-thumbs.mjs --keys INT_WINDOW_MORNING,…`: 21 s of rendering in total) and are in
`public/thumbs/setups/` (`thumb_int_*.png` and `setup_int_*.png`) and in `manifest.json`, which goes to 95 entries (the test that
rebuilds each scene with the code and compares its hash checks it); `tests/set-heroes.ts` sets `SPHERES` as the style's object.

*Two fixes in `core/sets.ts`, each with its test.* A recipe is a set without decoration, and that uncovered three things that
a set with decoration did not make noticeable: (1) `applySet` switched on the floor and contact shadow with any set, also
with one that brings nothing to rest on (against the *Interior* that carries no shadow of its own); now only with decoration
(`hasDecoration`: backdrop, floor, puddle or cards, all 16 sets have it). (2) A recipe chosen after a set with a backdrop
left **the set's backdrop** in the frame (the thumbnail showed it: the sweep's light backdrop behind the spheres); now the
backdrop goes back to the product type's, as when choosing any other setup. (3) Leaving a recipe for another setup
restored the product type's backdrop even though the recipe never touched it, overwriting the person's backdrop (the white of
*Catalogue*); now only whoever left a backdrop restores it (`presetLook(…, background)`). Mutations: all three
are reintroduced and `tests/interior-setups.test.ts` fails (the second also the thumbnails test, because the scene's hash
changes).

*Interiors Doctor.* `core/doctor-interior.ts` (logic) and `data/doctor-interior.ts` (descriptors in both languages,
`INTERIOR_DOCTOR_CHECKS`), plugged into the Doctor in a few lines: `runDoctor` adds `runInteriorDoctor(state)`, the `default`
of `fixDoctor` calls `fixInterior`, `doctorCheck(key)` knows both lists and the Doctor window looks up the
descriptor with `doctorCheck`. **They only run with the *Interior* type**: in a product scene they are not in the results
(and `DOCTOR_CHECKS`, the Doctor's list, is not touched). Seven stable keys: `interiorScale`, `interiorOpening`,
`interiorGlass`, `interiorLens`, `interiorEye`, `interiorClip`, `interiorNormals`. All with a fix, which is a
normal store action (one undo entry):

| Check | Detection | Fix | Test | Mutations |
| --- | --- | --- | --- | --- |
| Scale and units | the scene's largest size (the box of the parts that are not decoration) outside 100 mm–30 m | rescales by the importer's factor (metres, micrometres) if it falls in the range; if not, by the smallest power of ten that achieves it; if none, up to the limit; the importer's factor is used up | “scale and units” (5 tests: the limits, ×10, ×100, ×1000, ÷1000, the most absurd, the importer and the product-type size) | 6 |
| Opening for sun and sky | the active camera inside the scene's box (more than 1.5 m on each side), the sky or a lit sun lights it and no visible part carries a glass material, with `transmission` ≥ 0.5 or `opacity` ≤ 0.5 | sets the *White studio room* setup (panels and lamps instead of sun and sky) | “an opening for the sun and sky” (5) | 9 |
| Window glass | a visible, flat part (thickness ≤ 12 % of its longest side, with two large sides and the longest ≥ 300 mm, measured in its own box by its matrix scale: a rotated or stretched part of a cube is equally flat) with a `GLASS` material with `SOLID` walls | sets `walls` to `THIN` (the same `material/setParam` as the interface); if the material is shared by a part that is not a pane, a `material/detach` gives the panes a copy and only it is made thin | “window glass” (5) | 8 |
| Lens | a perspective camera with less than 18 mm | 24 mm and no lens preset, on all that fail it | “a lens wider than 18 mm” (3) | 7 |
| Eye height | a perspective camera, not locked, less than 0.3 m or more than 2.2 m above the floor (z = 0) | 1.5 m: changes the elevation looking at the same point from the same side at the same distance; if it does not reach that reasonable angle (80°), it backs off and drags the focus along | “eye height” (5) | 8 |
| Near clipping | a perspective camera inside the scene's box whose `clipStart` reaches the nearest face of that box (the wall) | `clipStart` to half that distance (minimum 0.01 mm) | “near clipping against the wall” (4) | 6 |
| Normals | a closed surface (`solidOrientation`, new in `core/solid.ts`) that faces outwards with the camera inside its box, or inwards with the camera outside (a solid inside out, a room with the walls to the outside; a mirrored part is looked at as it ends up in the world); and, with the camera in the room, a flat wall (over 1 m and as thin as 2 %) whose faces do not face the camera; with a budget of 500,000 triangles per pass, in tree order | `scene/flipNormals` of those parts | “inverted normals” (7, one of them the triangle budget) + 3 in `solid.ts` | 11 |

There are 57 Doctor mutations (2 of them for the scene type: that it runs or fixes in a product scene; each
check's detection switched off, each fix emptied, each threshold and each condition, the rest) and 1 for `solidOrientation`; every one is caught by some test (two survived the first round, the glass's
rotation and the lens preset, and their test was fixed). The Doctor's own scale check
(`scale`) does not compare an *Interior* scene with the product-type size (a 5 m living room against the 200 mm of
*Standard* gives twenty-five times): it keeps asking about the declared size.

*Tests.* New: `tests/scene-type.test.ts` (32: each type's table, the five round trips with a new
project and with all the slots touched by hand, what the person touched, the HDRI, the locked camera, each camera with
its own, the same type with no change, a single undo, the project saved and opened, an earlier one, an unknown type, the damaged
memory, the command and its strings), `tests/interior-setups.test.ts` (14: the style, the worlds, the recipes as sets
without decoration, the sky's sun where the light says, normalisation with the 16 types, choosing and leaving a recipe),
`tests/doctor-interior.test.ts` (41) and 3 in `tests/solid.test.ts`. Updated with their new numbers, without touching what does not
change: `data.test.ts` (95 setups and 10 styles, 7 `SKY` worlds, 7 suns), `rig.test.ts` (78 setups normalised with the
16 types), `sets.test.ts` (the 72 from before without L6 fields; 95 scenes in the manifest) and `palette.test.ts` (95
setups). Scene-type mutations: 5 (not restoring, restoring everything, not saving the memory, not normalising the type,
writing a locked camera), all detected. In the browser: `tools/scene-type-check.mjs` (Playwright, *Fast*: the
control, that the inspector has the same controls with each type, *Interior* in one undo entry with its seven
recipes and their thumbnails loaded, the contact shadow off and AgX, the seven Doctor rows, a recipe, *Catalogue*,
back to *Product*); capture `docs/ui/scene-type-interior.png`.

**What did not fit the plan** (rule 12; what is marked ◆ is a Fable judgement call: noted, not decided).

1. ◆ **The figures of the seven recipes** are a proposal, **pending Fable**: sun height, azimuth and temperature,
   weight of the window and of the bounce, sky intensity and exposure offset. They follow the orders of magnitude of
   interior photography and are normalised like the rest, but they are photographic decisions and have not been taken. The
   comment in `light-setups.ts` says so. The proposal, recipe by recipe (azimuths relative to the camera; sizes in
   part sizes, at the stated distance; *share* on the `specIrradiance` scale, see above):

   | Recipe | Label | World | Environment intensity | Exposure (EV) | Lights: type az/el/temperature, size in part sizes at its distance, *share* |
   | --- | --- | --- | --- | --- | --- |
   | `INT_WINDOW_MORNING` | Morning window | `SKY` | 0.12 | +0.2 | sun −65°/20°/4300 K ×1; panel −70°/30°/7200 K 5×4 at 2.6 ×12.2; panel 70°/12°/5200 K 4×4 at 3.5 ×5.9 |
   | `INT_WINDOW_NOON` | Midday window | `SKY` | 0.15 | +0.2 | sun −55°/62°/5600 K ×1; panel −75°/40°/6800 K 5×4 at 2.6 ×8.1; panel 70°/12°/5600 K 4×4 at 3.5 ×4.9 |
   | `INT_WINDOW_AFTERNOON` | Afternoon window | `SKY` | 0.11 | 0 | sun 70°/14°/3200 K ×1; panel 75°/24°/5600 K 5×4 at 2.6 ×10.8; panel −70°/10°/4600 K 4×4 at 3.5 ×7.4 |
   | `INT_OVERCAST` | Overcast | `STUDIO` | 0.8 | +0.3 | panel −75°/38°/7000 K 7×5 at 3 ×0.5; panel 0°/82°/6800 K 6×6 at 2.8 ×0.25; panel 75°/14°/6800 K 5×5 at 3.6 ×0.25 |
   | `INT_NIGHT_LAMPS` | Night lamps | `STUDIO` | 0.04 | −0.7 | disc −110°/28°/2600 K 0.7 at 2.2 ×0.45; disc 125°/48°/2400 K 0.5 at 2.8 ×0.25; square 0°/80°/2900 K 1.4 at 2.8 ×0.2; panel 60°/12°/8500 K 4×4 at 3.5 ×0.1 |
   | `INT_BLUE_HOUR` | Blue hour | `SKY` | 0.45 | −0.5 | sun 115°/3°/2300 K ×0.15; disc −100°/28°/2700 K 0.7 at 2.2 ×20; disc 135°/45°/2500 K 0.5 at 2.8 ×12; panel 75°/25°/10500 K 5×4 at 2.6 ×14; panel −35°/12°/7500 K 4×4 at 3.5 ×7 |
   | `INT_WHITE_ROOM` | White studio room | `STUDIO` | 1 | +0.5 | panel 0°/85°/5600 K 6×5 at 2.6 ×0.3; panel −80°/28°/5600 K 6×5 at 2.8 ×0.3; panel 80°/22°/5600 K 5×5 at 3.2 ×0.2; panel 0°/15°/5600 K 4×4 at 3.5 ×0.2 |

   The azimuths are relative to the camera (`LightSpec.az`). The orders of magnitude: the sun 2 to 4 times the sky at midday and
   1.5 to 2 in the evening (the environment intensity comes from the sky giving the studio dome's irradiance, about 2 per unit
   of intensity in the normaliser's units, and the sun `sin(height)` times its energy), tungsten lamps at 2400–2900 K, a clear sky through
   glass at 6500–10,500 K.
2. ◆ **The interiors Doctor's thresholds**, a proposal **pending Fable** (`INTERIORS.md` §3.6 names the
   checks, not the figures); they are constants exported from `core/doctor-interior.ts`:

   | Constant | Value | What for |
   | --- | --- | --- |
   | `INTERIOR_MIN_MM`, `INTERIOR_MAX_MM` | 100 mm and 30 m | the size of a scene that is a piece of furniture or a room (a vase and a loft) |
   | `WIDE_LENS_MM` | 18 mm | a lens that stretches the edges (the figure is that of §3.4) |
   | `INTERIOR_LENS_MM` | 24 mm | what the fix sets: the widest of the interior lenses of §3.4 |
   | `EYE_MIN_MM`, `EYE_MAX_MM` | 0.3 m and 2.2 m | plausible eye height above the floor (z = 0) |
   | `EYE_STANDING_MM` | 1.5 m | what the fix sets: a person standing (§3.4) |
   | room, pane, wall | 1.5 m per side; thickness ≤ 12 % and ≥ 300 mm; ≤ 2 % and ≥ 1 m | which box is a room, which part is a window pane, which flat part is a wall |
   | clipping | half the distance to the wall (≥ 0.01 mm) | what the fix sets |
   | `INTERIOR_NORMALS_TRIANGLES` | 500,000 | triangle budget of the normals check per pass |

3. ◆ **Values in the §3.1 table that are a number where the document gives a range or a word**: *Bounces* “16–24” is
   16 (the lower limit; the *Final* could ask for 24); *soft contact shadow* is an opacity of 0.35 in the viewport (the engine's contact
   shadow has no intensity: it is the shadow catcher, and its softness comes from the size of the lights); *white
   dome* is the studio dome with a pure white colour background. The scene type **does not change the light setup**: it chooses
   the environment, and the *Light* section opens on the *Interior* recipes, but which of the seven is the starting one is a
   photographer's decision that has not been made.
4. **Rows of §3.1 that are not applied because they name something that does not exist yet or that is not part of the project.** *Environment*: the catalogue
   cyclorama (K2). *Exposure*: the automatic one with its EV knob (K3; the exposure stays at the product type's
   and the recipe's offset). *Camera*: the 1.5 m eye height and straight verticals (K3), and “elevation or three-quarter” (a
   view, not a value: the existing one stays). *Transform*: “long shoulder” and *Low contrast* — the tone mapping has no
   shoulder parameter and *Contrast* is stored but the engine does not apply it yet (`image.postSoon`), so only AgX is set
   (and, incidentally, `INTERIORS.md` §3.5 asks for a curve per recipe: `LightSetup` has no field for it). *Displayed units*:
   it is an application preference (*Settings ▸ General*), not a project one, and moving it with the type would break “every mutation
   goes through the store and is undoable” and the round trip; the Doctor does speak in mm and metres. “**Interior HDRI**”: there are no
   environment recipes of their own yet (`STUDIO-TOOLS.md` §2); the HDRI the person has loaded is respected.
5. **The table says “Product (today): Standard / AgX” and the new project starts at *Filmic*.** Product writes nothing, so
   there is no conflict; the table row is not what the project brings.
6. **The sky haze per recipe** (turbidity is `environment.skyTurbidity`, not the setup's) **is not there**: `LightSetup`
   has no field for it and adding it requires a rule for what to return when leaving the recipe. The day recipes use whatever haze
   there is (3 by default); *Overcast* is the studio dome with a diffuse window, not a covered sky (there is no cloud
   model). ◆
7. **Without K2's `ROOM` node the Doctor uses what there is.** “Closed room” is the camera inside the box of the parts;
   “opening” is a glass or transparent material; “wall” is a face of that box. K2 replaces the first two
   with the room's openings; the checks and fixes remain. **The opening fix is a stand-in**:
   the lights of the *White room* recipe are around the product at distances in part sizes, so in a really closed
   imported room they end up outside its walls; the good fix (*add a window*) belongs to K2.
8. **Normals: only closed surfaces and flat walls with the camera inside.** An open mesh that is not a wall (more
   than 1 m, 2 % thick) is not examined, nor are parts beyond a budget of 500,000 triangles per pass, in tree order
   (the first time a mesh is examined its vertices are welded and a whole furnished room would stall the first
   scene change; triangles are counted and not what is in the cache, so the same scene always gives the same
   answer), nor is the “one face” case detected (a wall with no thickness where light leaks in at the corners); a known edge case: a closed
   room seen **from outside** with the faces pointing inward (a cutaway) gives a warning.
9. **The interior checks are not in `DOCTOR_CHECKS`** (the 17 the Doctor already had) but in their own,
   `INTERIOR_DOCTOR_CHECKS`, so as not to move that list (another phase, D1, adds its engine checks) nor the order of
   the results of a product scene; `doctorCheck(key)` knows both.
10. **Switching to *Interior* does not move the camera**: it sets 28 mm and the part looks smaller until K3 brings the eye height
    and the interiors framing. *Create studio* writes the product type's quality and samples again (as
    always) and does not reapply the scene type's values.
11. Mixing a sun with panels in a recipe (which `specIrradiance` measures in different units) forces *shares* of 5 to 20
    on the windows and on the blue hour's lamps; those made only of panels add up to 1 like the others. It is the
    normaliser's usual scale, not a new one: it is explained in the comment.

## K2 · Room, portals and exterior view — **Opus**

**What.** A parametric `ROOM` node from `INTERIORS.md` §3.2 (width, depth,
height; openings with position, size and sill; material per surface;
skirting; *hide the wall on the camera side*; cyclorama variant with the
infinity sweep profile of the primitives), editable in the inspector
and in the viewport (handles on the openings), saved in the project and exported to the RSB as meshes
plus a `PORT` section per opening; **automatic portals** also
for imported rooms (heuristic: glass or transparent quadrilaterals
in the envelope), with no jargon in the interface; a thin, non-refractive
*Window glass* material; **exterior view** as an image
on a plane behind each window with optional parallax (M2's RSB image
section). A procedural example room (*Load example room*) with a sofa and a lamp.

**Depends on.** U3, I3, M2 (for the view image).

**Acceptance.** Geometry tests (cut-out openings with the expected number of
triangles, portals with the exact area of each opening, wall
hidden only in camera); the heuristic marks the glass of an imported-room fixture
and does not mark a drinking glass; capture of the example room
in the preview.

## K3 · Interiors camera — **Opus** — done

**What.** `INTERIORS.md` §3.4: shift with automatic calculation
(*straight verticals*, can be switched off), eye height with presets, interior
lenses, **per-object camera visibility** (in the preview and in the
RSB), orthographic for elevations and plan, equirectangular 2:1
**panoramic** camera and *fisheye* (in the preview, by six faces; in the
engine, by strips), **automatic exposure** with an EV knob and presets
and the exterior multiplier on the camera ray, WASD walking with
fixed height. Exposure and curve as passes of the `image` state.

**Depends on.** U1, E3.

**Acceptance.** *Shift* test: with the camera tilted 10° the verticals
of a cube stay parallel in the projection (±0.1 px at 1080p); the
preview panorama matches the engine's in six test
directions; the plan does not show the ceiling and the room
stays lit by it (comparison of means); captures.

**Done.**

*Engine.* Two new projections in `rt_core::scene` (`Projection`, `Camera::panorama_dir`): the **equirectangular**
(longitude and latitude over the image, 360° × 180° at 2:1) and the **equidistant fisheye** (`θ` proportional to the distance
from the centre, black beyond a half turn), pinhole and from the camera's base; the passes' depth is the
distance, and the pixel footprints of particles, textures and caustics take the sphere's cone. `CAMR` gains 16 bytes at the
end (`u32 projection; f32 fov_x_deg fov_y_deg exterior`) that **are only written if any is not the default**: earlier
files keep their bytes and no hash moved. **Visible to camera** per instance: `INST.flags` bit 2
(`INSTANCE_NO_CAMERA`, value 4, next to bit 1 `INSTANCE_NO_SECTION`); only the `RayClass::Camera` queries (primary
rays and their straight continuations, passes, section caps) skip it, in the BVH, in brute force and in the
caps. The **exterior multiplier** (`CAMR.exterior`) multiplies the environment a camera ray sees on escaping
(also through thin walls and cut-outs) and the shadow catcher's background. `rt_features` and `/api/info` raise bit 4 (value
16, `FEATURE_CAMERAS`). Three parity scenes over the box room of `example::k3_room` (`rt
--write-k3-plan-example`, `--write-k3-panorama-example`, `--write-k3-fisheye-example`, and their `tests/fixtures/k3-*.rsb`):
`PINNED_K3_PLAN_4SPP` = `0x6efb1e66`, `PINNED_K3_PANORAMA_4SPP` = `0x96de8d73`, `PINNED_K3_FISHEYE_4SPP` = `0x9b85a1b6`,
equal in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, in scalar and `simd128` WASI, in the real `rt.wasm` and (the
panorama) through the launcher API; a K3 parity block in `engine.yml`, image alone and with `--passes`.

*Page.* `CameraState.projection` (`PERSPECTIVE · ORTHOGRAPHIC · EQUIRECTANGULAR · FISHEYE`) in the *Projection* list of the
*Camera* section, `fisheyeFovDeg` (60°–360° on the diagonal of the frame) and the *Elevation* and *Plan* views (orthographic).
**Straight verticals** (`straightVerticals`, `core/interior-camera.ts`): the camera is written levelled at the same
position and the same azimuth, with the shift `−f · tan(tilt)` added to that of the lens in the O1 `LENS` that already
existed (as O4 asked: a tool that moves the shift, without reordering the lens); the preview applies the same
correction in the projection (`render/camera-projection.ts`, `P · Rx`), so picking, outline and gizmo follow it. **Eye height** (`camera/eyeHeight`, presets *Standing* 1.5 m and *Seated* 1.1 m) and **interior lenses**
(`camera/interiorLens`, 24 · 28 · 35 mm), one undo entry each, nothing with the camera locked. **Visible to
camera** on *Part* (`SceneNode.cameraHidden`, inherited, `scene/setCameraHidden`): bit 2 of `INST` for the engine; in
Fast, a material that writes neither colour nor depth and still casts shadow, out of picking, of the box, of the
tints and of the id pass. **Panoramas in Fast** (`render/panorama-pass.ts`): the scene on the six faces of a cube
(half float, linear) and the canvas from the cube with `PANORAMA_GLSL`, the same map as the engine
(`core/panorama.ts`), over the whole canvas with the output frame inside, like the Full viewport's image; picking
follows the map. **Exposure as a pass** of the `image` state (`core/image-passes.ts`): `exposureMode` *By hand ·
Automatic*; the automatic one measures in the page the accumulation sums (`f32` luminance, the engine's `log2`, 10 % darkest
and 5 % brightest left out, mean to 18 % grey, ±16 EV, hundredths), and `exposureEv` becomes the *Brightness (EV)*
compensation; the viewport redoes it when the samples double, and the final render measures its sums before the
denoise, in the pool and in the launcher. Presets *Bright day · EV 7* and *Evening lamps · EV 5* (manual exposure,
`log2(683/1.2) − EV₁₀₀`) and the *Exterior (camera ray)* slider (`environment.exterior`, also in the background of
Fast). The *Interior* type switches on straight verticals and automatic exposure through K1's slot mechanism
(`image.exposureMode`, `camera.verticals:<id>`): switching type back leaves the project as it was. Project, library and
studio save and normalise the new fields; an earlier project opens the same.

*Acceptance, in numbers.* **Verticals**: with the camera tilted 10° (28 mm, 1920 × 1080), the vertical edges of a
600 mm cube are **0 px** from parallel in the page's projection and in Fast's, and **0.0001 px** with the
engine's rays (`rt-core`, reading the file the page writes, `tests/fixtures/k3-verticals.rsb`); without
straight verticals, 7.5 px (page) and 6.4 px (engine). Fast and engine match point by point to < 0.01 px; the target
stays at the centre (< 10⁻⁶ px). **Panorama**: in a closed room of six walls of six colours, the six
directions ±X ±Y ±Z of the equirectangular (and five of the 360° fisheye, and black outside the image circle) give
their wall's colour in the real `rt.wasm` and in Chromium, and Fast's picking takes that wall. **Plan**: in the
test room, the mean of the floor seen from above with the ceiling hidden to camera is **0.010220**; the same
room seen from below the ceiling, **0.010220** (+0.0000 %); without a ceiling, 0.002109 (20.6 %), and the ceiling does not appear
(0.000000 of what the camera sees of it). In the browser (`tools/k3-check.mjs`), the plan with the ceiling hidden changes the
Fast image and the Full viewport shows it lit (viewport mean 85 out of 255; the test's threshold is 12) with the automatic exposure measured (+2.6 EV).

*Tests.* `scene::camera_tests` and `render::k3_tests` in rt-core (maps, CAMR round trip and invalid ones, verticals,
the three pinned images, plan means, passes, ray classes with caps, exact exterior at half,
the room without K3 fields the same as before), `rt-cli/tests/example.rs` (1, 4 and 16 threads, writing the examples),
`rt-app/tests/parity.rs`; `tests/interior-camera.test.ts` (24: the verticals criterion in page and Fast, the
limit, eye height, lenses, views, maps, `CAMR` and `INST` byte for byte with `rt`, inheritance, exterior, project,
`readsCameras`, *Interior* round trip, the real `rt.wasm` with the three pinned and the six directions),
`tests/image-passes.test.ts` (11: the meter), `tests/panorama-browser.test.ts` (4, Chromium: six and five directions,
the image circle, a wall hidden to camera is neither drawn nor picked) and a pool test in
`tests/pathtracer.test.ts`. **Mutations**: 28, all detected. In the engine (8): the BVH not skipping what is hidden to camera, what is hidden to all rays (shadows too), brute force not skipping it, the section cap of a hidden part seen by the camera, the sign of the equirectangular longitude, the fisheye without blindness beyond a half turn, the exterior unapplied and the `CAMR` fields always written. In the page (20): the sign of the longitude in the map and in the GLSL, the fisheye circle in the GLSL, the sign of the shift, the camera not being levelled, Fast's projection without rotating, the `INST` bit unwritten and written for an engine that does not read it, the exterior unwritten, the `CAMR` fields always written, the inheritance of *Visible to camera*, Fast drawing and picking a hidden part, the meter's two clippings, the sum instead of the mean of the samples, the logarithm of the mean, the progressive meter measuring every frame, the pool not giving the reading and the preset against the wrong zero. Three survived the first pass (the fisheye circle in the GLSL, what is hidden also to shadows and the hidden cap) and the tests were strengthened until they were detected: a canvas corner outside the image circle, a shadow segment that ends between ceiling and floor, and two rays at the height of the ceiling cap, from the removed side and from inside the slab.

*Captures.* `docs/ui/k3-verticals.png` (the room in Full with straight verticals and the *Camera* section),
`k3-plan.png` (the plan in Full with the ceiling hidden and the automatic exposure in the status bar) and
`k3-panorama.png` (the 2:1 panorama in Full), with their Fast versions in `-fast`; entries in `GALERIA.md`
under *Unreleased*.

**What did not fit the plan** (rule 12; what is marked ◆ is a **Fable** judgement call and is left proposed, undecided):
(1) **There is no WASD walking** with fixed height: N3 (*Camera walk*) covers it, with the specification deferred in `TODO.md` §3 (*Walks on foot*).
(2) **There is no `ROOM` node** (it is K2): the tests and the browser check use a box room and
per-part camera visibility, which works for any geometry; the hidden front wall and the automatic near
clipping of `INTERIORS.md` §3.4 are left for K2. (3) **The engine does not render the panorama in strips**: it renders it
whole, by tiles like any image; the strips for large sizes belong to K6. (4) **The shift goes in `LENS`,
not in `CAMR`**: straight verticals move the shift of the O1 lens (what O4 asked for); the engine knows nothing about them.
(5) **The curve is the view transform**: *Low contrast*, the long shoulder and ISO and shutter under *Advanced* are still not
done; the curve pass is `RNDR.tonemap`. (6) **Interior does not move the camera to eye height**: doing it as one more
slot broke the round trip of K1's interiors Doctor checks (which measure the framing); the
presets are in *Camera*. (7) In Fast nothing is drawn over a panorama (outline, gizmo, glyphs), and the
gradient or image background is seen as a colour. (8) The plan is orthographic at 89.9° (the camera's elevation cap),
not at 90°. (9) No check for “tilted camera without straight verticals” was added to the Doctor. (10) The automatic
exposure is measured by the page: a scene exported and rendered with `rt` outside the application carries only the
compensation in `RNDR.exposure_ev`. (11) **For F1** (exact picking by the engine's primary ray): a pixel →
ray API has to serve orthographic (origin on the image plane, fixed direction), both panoramas (the
`Camera::panorama_dir` map from the position, no lens, and “nothing” outside the fisheye circle) and straight
verticals (the camera that is rendered, `renderedCamera`, not the orbit's); `focusDistanceFor` already gives the
focus distance with straight verticals and is not used until F1. ◆ (12) **Eye-height presets** 1.5 and 1.1 m and
**interior lenses** 24 · 28 · 35 mm (28 without a lens preset: `INT_28` is only a focal length), taken from §3.4. ◆ (13)
**Automatic exposure measurement**: trimmed logarithmic mean (10 % below, 5 % above) to 18 % grey, ±16 EV.
◆ (14) **EV presets** 7 and 5 from §3.4 and their calibration `EV₁₀₀ = log2(683/1.2) − exposure` (that the engine's EV 0 be
EV₁₀₀ ≈ 9.15). ◆ (15) **Exterior multiplier** 1 by default (no effect) and a range of 0.05–1. ◆ (16) **Interior
switches on straight verticals** by default (as §3.1 says), and up to **30°** of corrected tilt
(`VERTICALS_MAX_TILT_DEG`). ◆ (17) The 180° fisheye **on the diagonal** of the frame (it fills the frame; wider,
the circle is seen).

## K4 · Engine for interiors, minimum set — **Opus**

**What.** `INTERIORS.md` §4, points 1 to 7, in `rt-core`: origin offset
by ULP (Wächter and Binder) and a two-level BVH with instances;
sun as a disc with cone sampling and excluded from the environment; physical
sky (done in E5c: the Hošek–Wilkie shape with own coefficients,
without their tables) and HDRI with a 2D CDF; rectangles and discs by solid angle;
thin glass; **portals** (`PORT` section) with a summed-area table per
portal and MIS; **light tree** (Conty and Kulla, compact node as in
pbrt-v4; all lights if ≤ 8); direct and indirect *clamping* in
exposure units, regularisation, roulette; **adaptive sampling**
by two half buffers in blocks; AOVs (albedo, normal, depth,
variance, count) and variance-guided demodulated à-trous **denoise**
at the end and in previews; *Interior* scene-type settings passed
through RSB.

**Depends on.** E5, K2.

**Acceptance.** Test scenes of our own (a closed room with one
window, a room with twelve lamps, a glass table) with numerical tests:
with portals the squared error at 64 samples drops by at least half
compared with without them; the light tree gives the same mean as
sampling all of them (±1 %) with less variance; the image without *clamping* and
with it differ by less than 2 % in mean; the denoise at 64 samples ends up
closer to the 4096 reference than the 256 one without denoise (PSNR);
determinism and native/wasm parity intact; contact sheet of the
seven interior recipes with mean, blown-out and blocked pixels.

## K5 · Path guiding — **Opus**, with **Fable**'s approval

**What.** The SD tree of Müller, Gross and Novák 2017 implemented **from the
paper** (the reference is GPL and is not looked at): a binary spatial tree
with directional quadtrees in the leaves, iterations that double the
samples, structure frozen per iteration and summed across workers without
shared memory, MIS with explicit light sampling and portals;
configurable memory budget; on by default in *Interior*.
Automatic portals by visibility map as a by-product.

**Depends on.** K4.

**Acceptance.** In the one-window room, the same quality (PSNR against
reference) with at least 1.5× fewer samples than K4; no loss on the
product bottle (±2 % of time); tree memory below the
budget in the three test scenes.

## K6 · Furniture deliverables — **Sonnet**

**What.** `INTERIORS.md` §3.7 on top of N2: silhouette on white with alpha and with
dimensions (the bounding box's dimensions drawn on a layer), a sheet of
fabric and finish **variants** of a scene (list of materials ×
parts → batch), panorama by strips in the browser, elevations and plan
as batch jobs, name template with variant.

**Depends on.** K3, N2.

**Acceptance.** A batch of 3 variants × 2 views produces 6 images with
correct names; the 4096 × 2048 panorama is assembled without seams
(continuity test at the strip edges); capture of a variants
sheet.

## K7 · Sample assets and interiors in CI — **Sonnet**

**What.** A procedural example room with a sofa and a lamp (K2) and, as
assets downloadable on demand and never in the base package, a
selection from Poly Haven (furniture models, CC0) and ambientCG
(textures, CC0) with **licence and origin recorded per file** in an
`assets.json`; **no third-party HDRI** (owner's decision,
`STUDIO-TOOLS.md` §2: the environments are recipes of our own); nothing from Quaternius or 3D Warehouse;
attribution for Khronos if used. Interiors contact sheet in CI
with `rt`.

**Depends on.** K2, K4.

**Acceptance.** A test that fails if an asset has no recorded licence or
if its licence is not on the allowed list; the contact sheet comes out
in CI.

## K8 · Light groups after the render — **Opus**

**What.** *LightMix*-style: each light (and the sun, the sky and the
emitters) belongs to a **group**; the engine emits one pass per group
(linear sum) and the interface offers, after the render or in the viewport, a
mixer with intensity and colour per group whose output is a linear
combination; saving the mix as a scene setting (it applies the
factors to the real lights) and as variants (*day*, *evening*,
*night*) for the queue.

**Depends on.** K4.

**Acceptance.** The sum of the per-group passes equals the full render
(±1e-4); a saved and re-rendered mix matches the mix
(±2 %); capture of the mixer.

## P1 · Releases and public demo — **Haiku** — done (v0.1.0)

**What.** Request: the first release with **Windows
portable**, **Linux portable** and **Windows installer**. While
GitHub Actions has no minutes, the release is built **locally** with
`npm run release` (from P2: `packaging/release.mjs`), which leaves in
`out/release/` the three packages, their `sha256` in `SHA256SUMS.txt` and the
notes. Version in `package.json` and in the engine workspace, tag
`vX.Y.Z` created on publishing, `docs/CHANGELOG.md` from the start,
release notes in English (what is there, what is not, requirements: Windows 10/11
x64 with Edge, Linux x86_64 with a Chromium browser, SmartScreen warning
because it is unsigned). The `release.yml` workflow that will do the same
in CI on pushing a tag is left written, along with the GitHub Pages one for the demo,
for when there are minutes again.

**Depends on.** P2.

**Acceptance.** `npm run release` reproduces the three packages from a clean
tree; `SHA256SUMS.txt` adds up; the tag points at the release
commit; the CHANGELOG lists the phases that are done.

**Done.** `docs/CHANGELOG.md` with v0.1.0 and its limitations,
notes in English in `docs/release-notes/v0.1.0.md` (the path that
`release.yml` reads), and `npm run release` from the commit tagged `v0.1.0`:
Windows portable, Linux portable and Windows installer, checked
with `packaging/smoke.mjs` (native and under Wine, pinned hash) and
`sha256sum -c`. The release is published by hand from the tag while
there are no Actions minutes. The engine keeps its own version (0.3.0);
the application's is that of `package.json`.

**How it is published now (since 0.1.4).** With Actions minutes, the
release is published by `release.yml` launched by hand (*workflow_dispatch*)
**on `main`**, with `tag` = `vX.Y.Z` (the `package.json` version) and
`commit` empty or a commit already on `main`: it builds, creates the
tag and the release at that commit and uploads the four files. No session
needs to push tags. Launched from another branch, GitHub refused to create
the release with *Resource not accessible by integration* (twice, with
0.1.4); from `main` it worked first time. The workflow now stops at the
first step if a publication is not launched on the default branch. Without
`tag`, any branch will do to build the test artefact.

**With a plugin (since 0.1.6).** The `.rpk` package that
`src/data/plugins.json` names (its `url` points at the assets of that version's release)
is uploaded by hand to the release once published, with the REST API
(`gh release upload <tag> <file>`), and checked against the registry's `sha256` and
`bytes`; the activation key is not uploaded anywhere
(`docs/release-notes/plugins.md`).

**With the version's captures.** The notes of each release
(`docs/release-notes/vX.Y.Z.md`) carry that version's new captures:
those that `docs/GALERIA.md` keeps under *Unreleased*, which the version PR
moves under the new version. A release body is read outside the
repository and does not resolve relative paths, so each image goes with an absolute URL
and that same version's tag (created on publishing):
`https://github.com/Grohle-developer/Repackshot/raw/vX.Y.Z/docs/ui/<file>.png`.

## P2 · Desktop: own launcher, portables and installer — **Opus** — done

**Decision taken (Fable), replaces the Tauri one.** The desktop is
an **own launcher in Rust with `std` only** (`engine/crates/rt-app`,
binary `repackshot`), described in `ARCHITECTURE.md` §5.5: local
interface server with a *token* and `Host` checking, an Edge or Chromium
application window with its own profile, **native engine** with
all threads, data folder (or `data/` in portable mode), model store
with its own SHA-256 and machine detection. Tauri is ruled out
because it needs crates.io (blocked here) and compiling on Windows (no
Actions minutes), and the own launcher keeps the project free of
dependencies in Rust.

**What.**
- `rt-app`: minimal HTTP/1.1 server (statics with MIME types, `Range`,
  API with *token*), opening the window and ending the application on
  closing it, single instance, log in the data folder; API:
  `/api/info`, `/api/render` (RSB → passes accumulated in `f32`, with
  cancellation), `/api/models/*` (list, write in chunks with
  offset, resume, verify, delete, serve with `Range`),
  `/api/hardware`, `/api/open-folder`; command line `--hardware
  <file>` (INI read by the installer), `--serve-only` (no window,
  for tests) and `--version`. Own SHA-256 with the NIST vectors.
  The recommendation rule evaluated over `src/data/ai-models.json` with
  the same case file as the TypeScript test.
- In `src/`: `render/native.ts` (`RenderEngine` against `/api/render`,
  chosen when `/api/info` responds; Full mode and Render use
  it) and `io/native.ts` (the launcher's model store and data folder)
  behind the same interfaces as the web; no further changes.
- `packaging/`: `release.mjs` (builds the interface and the two wasm,
  compiles `repackshot` for `x86_64-pc-windows-gnu` with mingw-w64 and for
  static `x86_64-unknown-linux-musl`, and assembles the packages), the
  **Windows portable** (`Repackshot-<v>-windows-x64-portable.zip`:
  `repackshot.exe`, `app/`, `portable.txt`, licences), the **Linux
  portable** (`Repackshot-<v>-linux-x64-portable.tar.gz`, the same, plus an example
  `.desktop`; AppImage if the tool can be obtained with a
  permissive licence) and the **Windows installer** with NSIS
  (`Repackshot-<v>-windows-x64-setup.exe`): per user, without administrator
  permissions, in `%LOCALAPPDATA%\Programs\Repackshot`, with licence,
  folder, Start shortcuts and an optional desktop one, a registered uninstaller,
  the **AI models** step (`AI-POST.md` §2.2: reads the INI from
  `repackshot --hardware`, ticks the recommended one, one, several or none,
  licence visible, and leaves the choice for the application to
  download) and *Open Repackshot* at the end. Achromatic application
  icon, generated from `docs/media/logo.svg`.

**Depends on.** U5, U6 for the models step and the store; it can
start earlier with the launcher and the native engine.

**Acceptance.** `rt-app` tests (`cargo test`): SHA-256 with the NIST
vectors; the server rejects a foreign `Host` and an API call without a *token*;
`Range` returns the requested bytes; a model written in
out-of-order chunks and resumed gives the expected `sha256`; the recommendation
rule with the case file. Parity: the same scene through
`/api/render` and through wasm gives the same hash. The `.exe` starts under
Wine with `--serve-only` and serves the interface (smoke check; the real
window is tested on Windows). The Linux portable
starts, opens the window with the local Chromium and renders natively
(capture `docs/ui/desktop-linux.png`). The installer is built with
`makensis` without warnings.

**Done.** `engine/crates/rt-app` (binary `repackshot`, `std` only, no
`unsafe`): HTTP/1.1 server on `127.0.0.1` with `Host` checking
(421), a 128-bit *token* per launch in the URL fragment (401) and a foreign
`Origin` rejected (403); Edge or Chromium window with its own profile,
single instance and ending on close or when the heartbeat is missing; **native
engine** through `/api/render` that repeats `rt`'s loop and gives the same
hash as `rt` and the wasm pool (`0x223515c3` in the sample, with 1 and 4
threads, also the `.exe` under Wine), with *Finish by* samples, time
or whichever comes first, cancellation and `f32` sums for 16-bit PNG and EXR;
model store **by `sha256`** with its own SHA-256, writing in
out-of-order chunks and resumption; machine detection and the recommendation rule
in Rust and TypeScript over the same file of 36 cases,
with memory read as *measured / 0.94*. `packaging/release.mjs`
(`npm run release`): Windows portable (zip), Linux portable (tar.gz,
static musl binary) and NSIS installer (per user, English and Spanish,
AI models step, uninstaller), with an achromatic icon of its own,
third-party notices (three, rhino3dm, occt-import-js with their licences and
sources) and `SHA256SUMS.txt`; three builds give the same bytes.
846 web tests and 241 engine tests. Capture `docs/ui/desktop-linux.png`.

What did not fit the plan: AppImage only on demand (its runtime links
libfuse LGPL); 64-bit installer only; the installer's rows have no room for summary, quality
or speed; on Windows `--version` is only seen
redirected (graphical subsystem); untested on a real Windows (Edge via
App Paths, VRAM with real drivers, the installer clicked through by hand,
SmartScreen: the `.exe` is not signed).

## Q1 · Section view — **Sonnet** — done

**What.** A cutting plane by click + axis, by two points, or animated as one more
motion (`MOVE_KINDS` gains `SECTION`); implemented in the
integrator (discard the part beyond the plane, cap with the material's
colour) and in the preview with three's `clippingPlanes`.

**Depends on.** E3, N1.

**Acceptance.** A region comparison like that of
`tests/textures-full-browser.test.ts`: the sample bottle cut in
half, with the real `rt.wasm` through the page's writer against
*Fast* (three.js in Chromium), and the agreement stated in numbers. Tests that
fail without the feature: plane from click + axis and from two points, round trip through
RSB, the engine discards the removed side and caps closed meshes
(a box cut in half: area and colour of the cap),
interpolation of `SECTION`, undo and redo, determinism with 1, 4 and
16 threads, wasm parity (`rt --write-q1-example` with its hash pinned and a
block in `.github/workflows/engine.yml`).

**Done.** (1) *Data*: `state.section` (`core/section.ts`), a single plane
per project: `{ enabled, point, normal, cap }` with the normal towards the side
that **is removed**; actions `section/set|patch|enable|flip|clear` through
the store (undoable, a drag is one entry, nothing for what does not
change), saved in the project (an earlier file opens without a plane).
It is set in three ways: **click on the part + axis** (X, Y, Z or the surface
normal; the side facing the viewer is removed), **two
points** (the plane contains both and the view direction; what lies
to the left of the line from the first to the second is removed) and
**numbers** (point and normal); plus *Flip side*, *Cap the cut* and the
switch, which without a plane makes one through the centre of the product, facing the
camera. (2) *Animation*: `SECTION` is one more motion of
`MOVE_KINDS`, on the scene (`{ kind: 'SCENE' }`, like `HDRI`): its
amount is the plane's displacement along its normal in
part sizes (negative cuts deeper, positive uncovers; default −0.5), with
the clip's curve, adding with other clips and splitting without a
jump; `Pose.sectionOffsetMm` carries it to both engines. (3) *Engine*
(`geometry/section.rs`, `geometry/solid.rs`): the plane lives **inside
`Geometry`**, so camera, reflections, refractions, shadows, photons,
picking and passes see the same thing without touching the SIMD kernels or
the integrator: a ray is clipped to the interval in which it is on the side that
remains (a half-space cuts a ray in an interval, and `t` is the same in
the world and in mesh space) and is an ordinary ray with another
`t_min` and `t_max`. **The cap** goes where the cut passes inside a closed
solid: the first surface the ray meets after the plane
is seen **from behind** (`Solid::inside_before`), and then the crossing was
inside; the hit is flat, on the plane, with the plane's normal facing the ray
and the solid's material (no texture, pattern, program or
bevel: the plain colour). The solid analysis (welding vertices by
position and then with tolerance, each shared edge by exactly
two triangles in opposite directions, signed volume for the orientation)
is done once per mesh (`SolidCache`) and `core/solid.ts` repeats it in TypeScript
so that *Fast* caps the same parts. (4) *Format*:
new `SECT` section (20 B: `u32 flags` with bit 0 = cap, `f32
normal[3]`, `f32 distance`), at most one, after `FXAM` and before
`IMGS`, `BMAP` and `ENVR`; without a plane it is not written (the bytes from before);
new `rt_features` bit (4) and in `/api/info`. (5) *Preview*
(`render/section-preview.ts`): a `THREE.Plane` shared by all the
model's materials (far away when there is no section: the shaders
do not change when switching it on), cap with a copy of each closed part's
geometry that paints only the back faces with the part's material and
the plane's normal (the equivalent of the stencil), double-sided materials while cutting, and picking, the selection box (which looks at the vertices when
the part's box is cut), the outline and the gizmo (which hides
for a selection that the cut has taken away entirely) ignore what is removed. (6) *Interface*: **Section** section of the
Scene inspector (decision and why below), click modes with a
notice in the viewport and `Esc`, palette actions *Section
view on or off* and *Section view: flip the side*, motion sentences, all in
`es` and `en`. (7) *The studio is not cut*: the pieces of a set
(*Backdrop*, *Floor*, cards) are not the model; the writer marks them
with bit 1 of `INST.flags` (`INSTANCE_NO_SECTION`, only while a
plane cuts) and the engine also looks for them on the removed side, skipping
the surfaces of the cut model (at most 48; a scene without
marked instances does not take that path); *Fast* gives them a copy of the
material without the plane.

*Measured.* **Region** (`tests/section-full-browser.test.ts`, bottle
cut along the axis with a plane through the camera, 300 × 220, 32
samples; the engine is the real `rt.wasm` through `projectScene` + `writeRsb`):
the per-pixel agreement on what both images take as settled is
**1.000** (8,903 pixels), the union of the body, cap, collar and core sections overlaps at **0.963** (IoU) and, by class, body 0.962,
cap 0.948, collar 0.839 (a ring a few millimetres wide) and the core disc
hidden inside the body 0.977 (only the first surface
after the plane can tell). Without caps the cut stops being flat in
both images (highlight irregularity 0.054 versus 0.027 in *Fast*,
0.100 versus 0.034 in the engine) and by tone they agree at 1.000. The
controls fail as they should: the engine's plane moved 15 mm leaves the
core at 20 pixels against *Fast*'s 1,954 (agreement 0.74) and
flipped, 19 (agreement 0.46). The **studio**: a set floor under the
bottle has 31,335 pixels in *Fast* and 31,317 in the engine
(IoU 0.996) and fills the bottom strip of the frame (1.00 and 1.00); the same
floor as an ordinary part is cut in both (20,512 and 20,809,
IoU 0.983; bottom strip 0.00 and 0.00); the gizmo and the box selection
do not reach the label that the cut took away entirely and do reach the body and
the cap. Captures: `docs/ui/section-fast.png` and `docs/ui/section-full.png`
(`tools/section-check.mjs`). **Pinned**:
`PINNED_Q1_SECTION_4SPP = 0x7a4182ea` (the E5 scene cut at `x = 0`,
with its lacquered floor as studio, equal in scalar, SSE2 and AVX2, with 1, 4 and
16 threads, in scalar and `simd128` wasm); no earlier hash moved
(the scene without a plane is E5's bit for bit). **Cost**: at 640 × 480 and 32
samples with 4 threads, the cut scene gives 4.99 Mrays/s against 4.74 for
E5's without a plane (with half removed it drops from 7.1 s to 6.4 s); the
studio path is not noticeable.

**What did not fit the plan** (rule 12; what is marked ◆ is a
Fable judgement call: noted, not decided).

1. ◆ **Where the control lives**: in the **Scene inspector**, between
   *Ambient* and *Camera*, collapsed and with the switch in the header, and
   not in the viewport bar. It is a stored and animated scene object,
   like the environment and the ambient; the bar's tools
   are for navigation and transformation. The click modes do notify
   in the viewport. The guided tour does not list *Ambient* or *Section*, so it does not
   gain a step.
2. ◆ **Cap of a glass.** In the engine a cut glass solid has
   a cap that **refracts** (physically it is a cut glass, seen
   through); *Fast* draws it as transparent glass. An **opaque**
   cap in the glass's colour would be an option for the
   photographer; it was not done. The interface says so in a note.
3. ◆ **The studio is not cut.** The brief said "one side of the model"; it was
   understood that way (a cut floor leaves the product floating over the
   background). Any other use of the plane on the studio (cutting the
   background to see behind it) cannot be requested today: there is no per-part
   switch.
4. **Open meshes, inside-out solids and parts with per-face material.**
   An open mesh has no inside: the cut shows its interior (and a note says so, with the
   parts). A closed solid with faces inside out is capped by the engine (it decides by the sign of the
   volume) and not by *Fast* (it treats it as open). A part with a material per face is not capped
   in either (the engine sees each group as a sheet) and neither is a thin-walled glass.
5. **Known engine limits**: a finite-`t_max` ray that enters
   the remaining side inside a solid and ends before leaving does not see
   the cap (the next surface lies beyond its end), and an emissive
   mesh sampled as a light still illuminates from its removed part.
6. **Fast passes for the AI** (depth, normals,
   identifiers) do not know the plane; the colour does. The post-processing AI
   would receive the whole part with the cut colour.
7. **The open geometry in *Fast* and in the engine** is not painted the same: the base's
   cup, which is an open mesh, is seen from inside in both
   but with 509 yellow pixels against 339 (IoU 0.24 in that class: the
   interior of a thin cup depends on each one's shading); what is
   compared for open meshes is that the cut stops being flat.
8. `FEATURE_SECTION` (bit 4) is published by the module and the launcher, but the
   interface does not use it: both engines that are published cut. An old
   `rt.wasm` in `public/engine/` would show the whole part in
   *Full* without warning (fixed with `npm run engine:build`).

---

## H1 · Accessibility and i18n — **Haiku**

**What.** Focus order of all panels, `aria-label` on every icon,
contrast ≥ 7:1 verified by test over the tokens, `prefers-reduced-motion`,
review of the `es` (accents, tone) and `en` strings, documentation
kept in sync with what was done (README, SPEC) after each milestone.

**Depends on.** U1; repeated at the close of each version.

**Pass v0.1.16** (2026-10-17). **Done:**

- **Contrast** (`tests/ui-contrast.test.ts`): each text (`ink-0` to `ink-3`, and `inv-ink`) measured on its surfaces in the four themes, with the WCAG ratio of the tokens. `ink-0`, `ink-1` and the inverted one pass 7:1 on all of them. **36 pairs** fall below and are listed as pending: `ink-2` (light 3.8–5.3:1; dark 5.1–6.9:1) and `ink-3` (light 2.0–2.8:1; dark 2.7–3.6:1) on all surfaces, and `ink-3` in high contrast (light 5.1–6.6:1; dark 5.5–6.3:1). No token changes; the test fails on a new pair below 7:1 and on a pending pair that now reaches it.
- **Names** (`tests/a11y-browser.test.ts`): in Chromium, 20 interface states (panels, drawers, windows, Settings, guide, tour, Doctor, material editor, menus and palette) in Spanish and in English. Each button without text has its name from `strings.ts`. None was missing; the test removes the name of *Undo* and fails with 16 buttons.
- **Focus.** The palette let focus out with Tab and Escape did not work outside the field: now Tab stays in it, Escape closes it from anywhere and focus returns to the control that opened it. Menus and confirmations cycle with Tab and return focus to the button that opened them; a window opened from the main menu (*Settings*) returns it to the menu button. No positive `tabindex`; the Tab order does not go backwards in any column (`tests/a11y-static.test.ts`).
- **Motion.** *Reduce motion* did not switch off the smooth scrolling of the render window's plugin strip: now it does (`theme.css`). With the preference emulated, no element transitions or animates. The interface has no JavaScript animation: the guide and the tour only follow positions.
- **Strings.** All 2,997 strings reviewed in both languages: no missing accents, no missing opening marks, no detectable typos, and the Spanish uses the informal “tú” throughout. One change: *Center* becomes *Centre*. Two guards in `tests/strings.test.ts`.
- **Documentation.** SPEC §6 (accessibility), README (one line and the two new tests), CHANGELOG (*Unreleased*).

**What did not fit:**

- **Fable decision: auxiliary greys.** For 7:1 on all their surfaces, `ink-2` and `ink-3` would have to be `#434343` or darker in light and `#b5b5b5` or lighter in dark; that equalises the three greys and the hierarchy then depends on weight and size. Alternative: 7:1 only on `bg-0`, `bg-1` and the *hover*, with `ink-2` of `#4e4e4e` or darker in light and `#afafaf` or lighter in dark, and no text on `bg-2`, `bg-3`, *soft* or *overlay*. In high contrast, `ink-3` of `#434343` or darker (light) and `#c1c1c1` or lighter (dark). When a token changes, its pairs are removed from `PENDING` in the test.
- English strings with a space before the % (`10 %`) follow the SI convention that Spanish also uses: they are left as is.
- The README is in English as a whole; the new paragraph too, so as not to mix languages in the file.
- **Not audited in the browser, pending for a later pass.** Button names are checked in the render window (*image* and *animation*), the material editor and Settings (*General* and *Engine*); focus is not checked in any of these. Left out entirely: the import sheet; the results viewer (needs a finished render); the Settings subsections other than *General* and *Engine*; and the *Free up* confirmations in storage (they need installed models). The render window and the material editor are deliberately not modal: they do not trap focus, and their Escape has not been verified.
- **For N1** (animation, not touched): `src/ui/panels/anim-props.ts:327` gives `role="listitem"` to the preset buttons, so they stop being announced as buttons; `src/ui/panels/animation.ts:115` puts `role="tree"` on the focusable row container (the rows are `treeitem`). Small fix: a button with its own role inside the list.

---

## Pending Fable decisions (do not anticipate)

- **I2**: decided: `occt-import-js` (LGPL-2.1) as the only LGPL
  exception, isolated under the conditions of `ARCHITECTURE.md` §1. Pending:
  the **up axis** of STEP and IGES (today Z); SolidWorks and Creo export
  with Y up, so reading `originating_system` from the STEP
  header to choose it is being considered, and the **catalogue look** for
  CAD colours (today SIMPLE, roughness 0.5).
- **Desktop**: decided: an own launcher with `std` only instead of
  Tauri (`ARCHITECTURE.md` §5.5); NSIS installer; the installer chooses
  the models and the application downloads them (`AI-POST.md` §2.2).
- **AI post-processing** (`AI-POST.md`): the default model
  (provisional: Z-Image-Turbo) and the guard tolerances, after the
  X1 comparison.
- **Interiors** (`INTERIORS.md`): ~~exact licence of the Hošek–Wilkie
  tables~~ (resolved in E5c: they are not used; own sky with the
  published shape and coefficients fitted to our simulator); whether cross-origin
  isolation is enabled to share the scene between workers; the number of
  lights from which the tree comes in.
- **Native formats** (`.bip`, `.ksp`, `.sldprt`, `.ma`, `.ztl`, `.f3d`):
  decided that they are **not** read (proprietary, no public specification;
  reading them would require analysing their binaries, which the clean-room rules
  forbid). Input is whatever each program exports (`SPEC.md` §5).
  Revisited only if a public specification or an
  MIT/Apache library that reads them appears.
- **E4**: decided by the owner: two explicit modes, *Fast*
  (three.js) and *Full* (always the tracer, at lower resolution during
  gestures), with a switch in the header; *Render* always with the
  tracer. Only the reduced-resolution threshold remains to be decided.
- **E8**: how `rt` renders an animation (port `evaluate` to Rust or
  one RSB per frame).
- **L3**: the numbers of the recipes on the own engine.
- **E7**: wear thresholds on the contact sheet.
- **UI**: whether, after U1, the contextual inspector needs a separate
  *Library* tab (the decision in `UI.md` is that it does not; to be reviewed with
  real use).

---

## After testing v0.1.0: desktop fixes and everything marked *coming soon*

Request (2026-10-13), after testing the installer on Windows:
Full mode stops after a while of making changes; the queue does not
pause or resume; a material cannot be dragged onto a part; choosing a
folder fails (*this folder cannot be opened because it contains system
files*); and the window behaves like a web page (it offers to translate, the
logo does not appear, right click and text selection bring up browser
menus). **Decision: on desktop nothing appears that is not our
interface**, the interface stays in HTML and everything else (file dialogs,
file writing, engine) is done by the Rust launcher. In addition: **everything
the interface marks *coming soon* is integrated**.

| Phase | Executor | What |
| --- | --- | --- |
| **P3a** (done) | Opus | Full mode that does not stop (reproduce with a long session of changes against the launcher and fix the cause), *Pause* / *Resume* / *Start queue* that work on web and desktop |
| **P3b** | Opus | Desktop with no trace of a browser: native folder and file dialogs from the launcher (PowerShell on Windows, `zenity`/`kdialog` on Linux, no `unsafe`), writing of renders, projects and models by the launcher, context menu, selection, translation, zoom, reload, printing, search and browser navigation disabled, own icon and title; WebView2 study for Windows |
| **P3c** | Opus | **Own window on Windows** (the lead's decision after the capture of Edge's “Do you want to exit the application?” notice: *all notices and windows with our interface, no web notices; a closed, professional product*): frameless Win32 window with **WebView2** (the Edge engine that ships with Windows 10/11) and a title bar drawn by us (title, minimise, maximise, close, drag), context menus, shortcuts, status bar, zoom, autofill, translation, downloads and browser script dialogs **disabled through the API**, and closing (button, `Alt F4`, taskbar) **intercepted** to ask with our own window if there are unsaved changes; Edge `--app` only as an automatic fallback if the runtime is missing. On Linux, Chromium in application mode continues with P3b's hardening until P3d (own window with WebKitGTK, which requires a glibc binary and not the static musl one) |
| **P3e** | Opus | **Desktop: everything over the launcher** (the lead's decision after “the text overlaps” and “it says it cannot see the GPU because it is a browser”: *on desktop the page is only interface*): a platform seam with a web and a launcher implementation; settings, library, history, thumbnails, hardware and space used in the data folder by the launcher; stable port per data folder; not a single row that talks about the browser; Settings rows that do not overlap |
| **U7** (done) | Sonnet | Dragging a material (a catalogue or *Mine* thumbnail) onto a part in the viewport or the tree, with highlighting (`UI.md` §2.3), and **M1** (whole CAD face and *Separate by CAD faces*), plus box selection with `Ctrl/⌘` + drag. See U7 and M1 above |
| **E5** | Opus | Already described: glass and transmission, varnish, real emitters, sky, HDRI, background image |
| **E5b** | Opus | Floor reflection, image effects (halo, sharpening, saturation, contrast, vignette), render region, passes (alpha, depth, normals, part id), caustics and own denoise |
| **E5c** (done) | Opus | Own clean-room physical sky: the Hošek–Wilkie shape with coefficients fitted to our atmosphere simulator (`rt-sky`), *Physical · Classic* in *Environment*. See E5c above |
| **E6**, **E7** | Sonnet, Opus | Already described: wood, fabric, bevel, subsurface (anisotropy arrived with E5); wear visible in engine and viewport |
| **L4**, **L5** | Opus, Sonnet | Already described: own lights (area, point, spot, sun) with all their operations; IES |
| **M2** | Opus | Already described: image textures and labels |
| **N1**, **N2** | Opus, Sonnet | Encoded video (WebCodecs and own MP4 and WebM muxers) and whatever remains of passes and batches |
| **U8** | Sonnet | The small things in the interface: automatic backup and recovery, access letters in menus, changing shortcuts, *Check for updates*, the Doctor checks that are missing and their *Fix* buttons (**D1**) |
| **X1b–X4** | Fable, Opus, Sonnet | Already described: the complete AI post-processing (X3 split into X3a–X3d, `AI-POST.md` §7) |

**P3a done.** Reproduced for real with a long session of changes
against the launcher (`tools/viewport-stress.mjs`, new): in v0.1.0, after
90–300 s no request to `/api/render` was answered any more, and
`gdb` showed the launcher's HTTP threads blocked writing frames
that nobody read. **Main cause (native only)**: when replacing a view,
the page abandoned the polling of the previous one without reading or cancelling
its response; each unread response holds one of the six
HTTP/1.1 connections that Chromium (and WebView2) opens to the launcher, and with all six
held every request waits forever. That explains the three
symptoms the owner saw (the old image with the new outline on top;
*Fast → Full* in grey with “0 samples”; a render that never finishes,
with *Full · paused while rendering*) and the native half of the
queue that does not pause (*Pause* did not reach the launcher). Other causes, each
with its test: *Render* requests did not carry the cancellation
signal; a view that the launcher forgot (404) or rejected (503) was
not requested again, and at reduced resolution its “frame in flight” stayed
marked forever; two views could go out at once and arrive in reverse order;
in the pool, switching to *Fast* during a reduced frame left that same
mark set and *Full* never started again; in the launcher, a failed
write was drained again with the 120 s deadline, jobs
of pages that had gone away kept rendering, reloads filled the 8
window slots (`503 busy`, found by P3e), a render that panicked
never finished and a stuck job blocked the next one;
and `main.ts`'s animation loop stopped forever on any
exception.

Fixes: in `render/native.ts`, every response is read, cancelled or
aborted; one view at a time, numbered (`seq`); rejected or lost ones are
requested again with growing back-off and the meter says why; all
requests carry the signal; the page cancels its jobs on `pagehide`.
In the launcher: `409 stale` for a view that arrives late, writing
an unread frame is cut off after 10 s, jobs that nobody asks about
stop themselves (viewport 10 s, final 20 s), with all 8 slots
taken a window that has been silent for 3 s gives up its own, a panic ends
the job as failed and releases the port, and `GET /api/render/state` gives the
diagnosis (with `log=1`, to the log as well). A *watchdog* in both
engines (`render/watchdog.ts`) restarts the view if the launcher
stops answering, if passes do not arrive, or if they arrive and are not painted, says so
in the console and in the launcher's log, and the meter says the
reason: never “0 samples” in silence.

**The lead's decision** (with the owner's capture: the viewport was *paused
while rendering*): **the viewport stays alive while
rendering**, sharing the machine. Natively it keeps a quarter
of the threads (at least one) and the render gets the rest, or all of them
when the viewport has converged; in the pool, a quarter of the
workers. The meter says so (*Full · shared with the render · 4 of 16
threads*) and *Settings ▸ Render engine ▸ While a render runs* chooses it
(*Keep the viewport live (shared)*, the default, · *Pause the viewport
(fastest render)*). The render gives the same bits with or without the viewport (tests
in Rust, also against the pinned hash with 16 threads, and in the browser
the same file `4e3aa886…` in both engines).

**The queue**: the v0.1.0 button became *Start queue* as soon as
*Pause* was pressed, with the job still finishing, and a *Resume* pressed
then was lost. Now there is a *Paused* state: the button says *Pause*
while running, *Resume* after a pause and *Start queue* otherwise
(disabled with nothing waiting); *Pause* stops the job and releases the
engine (473 ms until the launcher has no final left; 167 ms in the
pool) and *Resume* continues with what was paused (only the *Render* job if that is
what it was; the paused job starts again).

Tests: 23 new on the web, with a simulated launcher that models the six
connections (the earlier simulated ones answered everything at once, and that is why
this escaped), and 13 new or redone in Rust (4, 16 and 32 threads); each
fix, removed one by one, makes its test fail (18 mutations in
TypeScript and 15 in Rust). The timing test for a queued final measures
the job's own clock and not how long the machine takes (10 of 10 with another
build running). 10-minute sessions of
`tools/viewport-stress.mjs` (determinism, queue and long session with bursts
of orbiting, dropping and moving a part, checking that the canvas shows the current
scene):

| Engine, 10 min | Actions | Renders | Stalls | Old image | *Watchdog* | Queue |
| --- | --- | --- | --- | --- | --- | --- |
| Native, 16 threads, 1st | 171 | 1 (cancelled by undo) | 0 | 0 of 15 | 0 | 10 of 10 |
| Native, 16 threads, 2nd | 163 | 6 (5 finished, 1 cancelled by undo) | 0 | 0 of 16 | 0 | — |
| Pool, 3 workers | 143 | 5 (3 finished, 2 cancelled by undo) | 0 | 0 of 6 | 0 | 10 of 10 |

What did not fit the plan: with the machine heavily loaded by other agents
(load of 10 to 47 on 4 cores), about 16 actions per minute and not
*dozens*; the pool's 5-minute session against v0.1.0 does not conclude
(a lost click left it in *Fast*), so the pool's own failure is
proved by its test and not by the session; an *undo* that takes away the queue's job
still cancels its render (as decided in U5); in the pool, when
a render finishes the viewport starts over to recover all the
workers (it loses that view's samples); and since on desktop the
renders are written by the launcher (P3b), the check waits for the file
in its *Downloads* folder (`XDG_DOWNLOAD_DIR`) and not for a browser
download. Not tested on a real Windows.

**P3b done.** System dialogs (folder, open, save) from the
launcher with PowerShell on Windows and `zenity`/`kdialog` on Linux, and a file
API that only touches what the person chose in a dialog during
that launch (output folders only for new files, never
overwriting; allowed extensions; *Downloads* and the last project
as the launcher's only exceptions); renders, projects, imports,
exports and models go through there and the downloads bubble does not
appear. Hardening switches and profile preferences for
Edge/Chromium in a single constant reused by P3c; the page blocks
the browser's context menu, chrome selection, translation, zoom, reload, printing,
search and navigation (`src/ui/guards.ts`), without breaking any shortcut of its own; `Ctrl W`/`Ctrl Q`
go through our question; external links go out through a single
`openExternal` (launcher on desktop) and a test forbids `alert`,
`confirm`, `prompt`, `print` and `window.open`; favicon, icons and
manifest of its own. Not tested on a real Windows: that the dialogs come up
in front of the window and that Edge's mini-menu disappears entirely (guaranteed
by P3c).

**P3c done.** Own Win32 window with WebView2 on Windows
(`engine/crates/rt-app/src/platform/`, the launcher's only place with
`unsafe`, each block with its why): hand-written COM (vtables
transcribed from the SDK's IDL, with their method count and the position of
each method used checked in the tests), Microsoft's
`WebView2Loader.dll` loader next to the executable (NuGet
`Microsoft.Web.WebView2` 1.0.4258.31, BSD-style licence that allows
redistributing it with its notice; SHA-256 of the package and the DLL pinned in
`packaging/lib/webview2.mjs`) and the system's Evergreen runtime; profile
in `webview2/` of the data folder (portable included). Everything that is not
our interface, switched off through the API: context menus, script
dialogs, browser shortcuts, status bar, zoom, pinch, swipe
to go back, autofill, passwords, SmartScreen, error page and,
in release, developer tools; navigation only to our
origin, clicked `https` links to the system browser, no new
windows, downloads cancelled without their panel (and the page never downloads
in that window: a test checks it), permissions denied except the
files the person chose and persistent storage. Closing
(button, `Alt F4`, taskbar, system menu) reaches the page
as `close-requested` and goes through the same question as `Ctrl W`
(`requestCloseWindow`, *Save · Don’t save · Cancel*), without
`beforeunload`. Own icon, title `Repackshot — <project>`, dark title
bar with the dark theme, AppUserModelID `Repackshot.App` (and the
same in the installer's shortcuts, with `repackshot
--shortcut-id`), size, position and theme remembered in `window.json`, and
P3b's file dialogs with the window as owner. If the loader or the runtime is missing, or any step fails, it is noted
in the log and Edge's `--app` window is opened; *Settings ▸ Desktop* says which
window it is and why, and `--window=webview2|browser` forces it. In the
header, the logo with a downward arrow instead of the three
lines (web and desktop). Linux unchanged.

What did not fit the plan: by the lead's decision, after comparing it with
a reference application, the window uses the **system's** title bar and not
one drawn by the page (the frameless version, with the top edge and
*Snap Layouts* over our maximise button, was made, tested under
Wine and removed). WebView2 is passed `browser.rs`'s `DISABLED_FEATURES` and
the slowdown switches (a single source),
but not the `HARDENING_SWITCHES`: they belong to the browser's own interface,
which WebView2 does not have or whose API already switches them off, and they are not documented for
WebView2. Under Wine the AppUserModelID of a shortcut cannot be read back
(its property store is a sketch), so that, and
everything about WebView2, remains to be tested on a real Windows. The random
port per launch, which makes `localStorage` get lost between launches
(in the Edge window and in the own one), is left for P3e.

**P3e done.** On desktop the page is only the interface. A `Platform`
seam (`src/io/platform.ts`), chosen once at startup, with two
implementations behind the same interface: the web (`platform-web.ts`:
localStorage, IndexedDB, OPFS, WebGPU, as until now) and the launcher's
(`platform-desktop.ts`), where every service and every byte of state belongs
to the launcher: settings in `settings.json` of the data folder, small things
remembered in `state/`, library in `library/`, results history
as files in `results/` with their index, thumbnails in `cache/thumbs/`,
models (they already were), hardware always through `/api/hardware` and space used
measured by the launcher (`/api/storage/usage`), with *Free up* going through
it. New routes `/api/store/*` and `/api/storage/usage`
(`rt-app/src/appdata.rs`) with the usual *token*, `Host` and `Origin`,
lowercase names confined to the data folder (no links or
Windows device names), atomic writes, and a document
that could not be read at startup is never overwritten. **Stable port per
data folder** (`launcher.json`, `rt-app/src/port.rs`): the window's origin
no longer changes on every launch, which is why in v0.1.x settings, library and history
were lost on closing. Migration, once per data folder (mark `state/migration.json`), of whatever remains in the
browser storage of the current origin; for those coming from v0.1.x
it is usually empty (each launch had another port) and only leaves the mark.
No row talks about the browser on desktop: the strings that
named it have their desktop version (`DESKTOP_TABLE` of
`strings.ts`) or their hidden row (`webOnly`: *Persistent storage*;
WebGPU, quota and browser memory only on the web), *Window drawn
by* says a name (*Microsoft Edge app window*, and it already reads
P3c's `window` for *Native window (WebView2 x.y)*), the GPU row
lists the launcher's cards and follows the detection even if it arrives later, the
badge *Only in the desktop application* does not appear inside it and
the browser-only model is not listed. Settings rows that do not overlap
at any width or interface size: label column with a minimum,
controls and badges that wrap, stacked rows for long values
(monospaced paths broken where needed, button below, title with
the full text) and container queries that stack everything in narrow windows. Tests: the seam chooses the launcher and then does not touch
`localStorage`, `indexedDB` or `navigator.storage` (spies), the migration
once and with an empty origin, writes in order, results with their
limits, the browser strings covered; in Rust, `tests/appdata.rs`
(security, confinement, links, limits, cut-off request, results,
cache, space, another launch) and `tests/port.rs`. Check
`tools/desktop-platform-check.mjs` against the real launcher (settings that
survive a restart in a new browser profile, the same port,
nothing in browser storage, a render in `results/`, the launcher's
GPUs, no mention of the browser in either language, *Free up*
through the launcher, and no overlap in any section at 1600, 1280 and
960 px, 90–150 %, two languages, dark, light and high contrast); captures
`settings-desktop-paths.png`, `settings-storage-desktop.png`,
`settings-ai-desktop.png`. With P3b and P3c merged, 1044 web tests and 309 for the
engine.

Merged with P3b and P3c: the output folders, the projects (with the last one
the launcher remembers) and the import and export dialogs also come
from the platform (on desktop, P3b's; never the browser's pickers
or handles), the chosen folders are remembered in
`state/desktop.folders.json` and not in `localStorage`, and *Window drawn
by* is a single function (P3c's, with its reasons) that says *Repackshot’s
own window (WebView2 x.y)* and never the name of an executable
(with no launcher window, `--serve-only`, it no longer says *The default browser*). The real-launcher check adds that *Choose folder…* and
*Save project* go through the launcher's dialogs (a test `zenity`)
without touching the browser's pickers, that the folder ends up in
the data and that *Downloads* is written by the launcher. On merging: the chosen output
folder, which P3b shows by its path, overflowed its row; the
button now says its name and the full path goes below. An intermittent failure of the parity test was also fixed
(`tests/parity.rs`: if the last
pass arrived between two queries, the returned frame was not marked
as finished).

What did not fit the plan: the *token* stays in `sessionStorage` (it is the launch's
secret, not state).
The automatic backup does not exist yet (U8): when it arrives, to the data
folder through the platform. `REPACKSHOT_TEST_GPUS` (fake cards, for
tests only) is also read by the release binary. On Windows, if the
remembered port is still in `TIME_WAIT` on reopening, another is taken once and
remembered. Found along the way (from P3a): a native viewport job from a
page that reloads stays alive until the cap of 8 (`503 busy`). Not
tested on a real Windows.

**Correction after testing v0.1.2.** On a real Windows the launcher
found no graphics card on any machine, only the CPU, and *Settings ▸ AI post-processing ▸ Hardware*, the *GPU* row and the AI engine's
Vulkan/CPU choice depend on that. Cause: `reg query <display class> /s` reaches
the `Properties` subkey, which gives “Access denied” (“ERROR: Acceso
denegado.” in Spanish), and `reg` exits with 1; `process::output` threw away the
output of any program that did not exit with 0, with the adapters
inside. The parser's test fed it the text directly, without an exit
code: it was more permissive than reality, and it has been fixed along with it.
Now `process::output_any` returns what was printed together with the code (and
`output` stays strict for the single-key queries of
`browser.rs` and `files.rs`, where exiting with 1 means “not there”), and the cards
come from four sources: **DXGI** (`rt-app/src/platform/dxgi.rs`, hand-written COM
like P3c's: `CreateDXGIFactory1`, `EnumAdapters1`, `GetDesc1`; exact 64-bit
dedicated VRAM, without the software adapter or Microsoft's, `dxgi.dll` only from `System32`), **the registry** (one query to list the subkeys and another per adapter, never `/s` or `Properties`,
read whatever their code), **CIM** (`Win32_VideoController` in the same
PowerShell run as the RAM) and **wmic** if PowerShell does not answer.
They are merged per adapter: the first one that lists only what is there now governs
(DXGI, otherwise CIM, otherwise wmic), because the registry keeps the key of a
card that has already been removed, and exact VRAM wins over the 32-bit one, which
caps at 4 GiB. Each source leaves in `logs/repackshot.log` what it found or
why it failed, `/api/hardware` gives it in `gpuSources` and `gpuDetection`, and the
interface distinguishes “The graphics cards could not be read: see the logs” from
“No graphics card found”. System programs
go by their absolute path in `System32` (`reg.exe`,
`powershell.exe`, `WMIC.exe`, also in `browser.rs`, `files.rs` and
`dialogs.rs`). Tests, each checked failing without its fix: a
program that prints and exits with 1 is read (`sh` on Linux, `cmd` under Wine),
the registry source with a fake `reg` and with real programs that
exit with 1, the parser with “Access is denied” and “Acceso denegado.”
between keys, CIM and `wmic`, the merge (the removed card, two identical
cards, “no card” versus “could not ask”), the vtables and
`DXGI_ADAPTER_DESC1` against the IDL, and the interface. Under Wine with `xvfb-run`
DXGI lists its adapter (*NVIDIA GeForce GTX 470*, 15.7 GiB, what Wine
invents), Wine's registry calls it *Wine Adapter* with no VRAM, Wine's
PowerShell does not answer and `wmic` gives the same name as DXGI: one
card remains, DXGI's. Found while running everything under Wine: a test in
`rt-app/tests/ai.rs` assumed the machine has no GPU (a request
without `"device":"cpu"` asked for the Vulkan build, which is not installed, and was
rejected for that before the image was read); it failed the same on Linux with a
GPU (`REPACKSHOT_TEST_GPUS`) and now asks for the CPU like the others. What did not fit: it is still untested on a real Windows
(if it still fails, `logs/repackshot.log` says what each source answered); that
`reg /s` stops at the first error is not verified, which is why it is queried
key by key; the installer reads the same `--hardware` and now sees the cards,
but its models page does not distinguish “could not be read” from “there is none” (the
INI does not change).

Order: wave 1 **P3a**, **P3b**, **U7**, **E5** in parallel; wave 2
**E5b**, **E6**, **L4**, **N1**, **U8**; wave 3 **E7**, **M2**, **L5**,
**N2**. AI post-processing, **brought forward at the owner's request (2026-10-13)**: **X3a**, **X3b**, **X4**, **X2** and **X3c** now; **X3d** and **X1b** after (`AI-POST.md` §7.6). Each phase removes its
*coming soon* items and leaves no new one without noting it here.

## Studio tools (optics, environment, light, camera, particles)

Full plan in `docs/STUDIO-TOOLS.md`. Phases, in waves starting from
wave 2 (E5b's DoF moves to O1):

*Renumbered:* the ghost flare was **O4** in this table and becomes
**O6**; O4 is now the completed phase *Simple and traced lens: options for each
one*.

| Phase | Executor | What |
| --- | --- | --- |
| **A6** — done | Sonnet | Assets without a new engine: `lenses.json` (16 prescriptions with a paraxial test), `bokeh.json` (20 types), generated aperture masks and gobos, `camera-moves.json` |
| **O1** | Opus | Improved thin lens: polygonal and mask aperture, pupil profiles, obstruction, approximate cat's eye, anamorphic, *tilt-shift*, *split diopter*, per-channel CA; bokeh selector |
| **O2** | Opus | Traced lens: prescriptions, stable intersection, pupil limits, autofocus, breathing; the 16 lenses |
| **O3** | Opus | Three-band CA, coatings (transmission, tint, T-stop), veiling glare |
| **O6** | Opus | Ghost flare, diffraction star, bloom and halation, dust and scratches |
| **O5** — done (in O2 and O2c) | Sonnet | Lens editor: character, SVG cross-section, non-physical adjustments marked, *Save lens as…* (O2); the lens elements (O2c) |
| **W1** | Opus | Pin evaluator in the engine with importance sampling; pin editor; *Place highlight* |
| **W2** | Sonnet | Library of 39 environments (recipes, thumbnails, hash), export HDR/EXR, baked interiors |
| **L6** | Sonnet | *Reflection · Direct · Orbit* placement, smoothed normal, obstacles, automatic power |
| **L7** | Opus | Emitters with procedural profile, gobos, flags, reflectors |
| **L8** | Opus | Diffuse/specular per light, light and shadow linking, solo, flicker |
| **L9** | Sonnet | False colour by zones, light meter, baking the light setup to an environment |
| **N4** | Sonnet | Library of camera moves, handheld camera, ramps, aspect ratios |
| **N5** | Opus | Drawing and recording walk-throughs, target lock, motion blur |
| **S0** | Fable | Particle decisions: where the simulator lives, cache format, RSB sections |
| **S4a** — done | Opus | Ambient: stateless air particles (`rt-sim`, `FXAM`, spheres, discs and capsules, the *Ambient* section of *Scene*); preset values accepted; what follows, in S4b |
| **S4b** — done | Opus | Particles: the cost at the presets' densities, measured (the screen grid for camera rays, because rain went over 1.3×); a forward lobe (Henyey–Greenstein) for dust, pollen and dust cloud; drops without caustics; the lobe's share and the rain's cost, for the verdict |
| **S1**–**S10** | Opus, Sonnet | Scattering and instances; falling and resting; drops and condensation; stateless emitters; volumes; smoke; liquids; hair and grass; cloth; improvements (detail in `docs/research/particles.md` §6) |

### A6 · Assets without a new engine — **Sonnet** — done

**Done.** All the assets of the studio tools that need no
new engine, without brands or manufacturer names and generated by code from the
repository (nothing comes from AI image models):

- `src/data/lenses.json` (+ typed loader in `lenses.ts`, which keeps
  `LENS_PRESETS`): the 16 prescriptions of `docs/research/optics.md` §2.3 in
  the registry of §5 (surfaces with radius, thickness, glass `nd`/`vd`,
  semi-aperture, type, stop and *coating*; reference focal length, f-number, field,
  image circle, focus and moving gaps, iris), with the patent or the
  book in `source`. `tests/lenses.test.ts` traces a paraxial ray of its own and
  reproduces the focal length and back focus of each lens within 0.05 % of what the
  report traced and within 1 % of what the patent says (also the telephoto's
  breathing, the macro's floating element, the soft lens's gap travel, the adapter's 1/2
  magnification and the image behind the mirror of the
  catadioptric); the stop exists only once in each lens, the keys
  are unique and stable, no brand or catalogue glass appears, and every
  glass has `nd` in [1.4; 2.1] and `vd` in [15; 100]. An independent
  re-reading of the report's table found no differences from what was
  transcribed (except the symbolic gap `dB0` and the estimated `vd`s).
- `src/data/bokeh.json` (+ `bokeh.ts`): the 20 types of `optics.md` §1 with
  stable keys, names and descriptions in es/en and the parameters of the
  thin-lens mode (blades, roundness, rotation, mask, pupil profile,
  obstruction, cat's eye, anamorphic squeeze, CA, swirl, rings,
  texture), or the traced lens that provides them (`requires: "traced"`), or `requires:
  "wave"` for the diffraction ring (coming soon). A test checks that
  everything resolves to masks and lenses that exist.
- `tools/assets/` (`common.mjs`, `aperture-masks.mjs`, `gobos.mjs`) and
  `public/assets/aperture/` (45 masks of 512²: straight and curved polygons with 3 to 18
  blades, stars, heart, several holes, rings with
  obstruction 0.3 and 0.5, onion rings, dust, scratches, mesh) and
  `public/assets/gobo/` (12 patterns of 1024²: windows, blinds, leaves,
  dappled light, dots, lines, radial burst, soft breakup), each with
  recipe, seed and hash in its `index.json`. The canonical hash is that of the
  pixels (the bytes of a zlib stream may change between versions);
  `tests/assets.test.ts` regenerates everything with the generator's pure functions and
  compares. The generator uses only `+ − × ÷` and `sqrt` and functions of its own.
- `src/data/camera-moves.json` (+ `camera-moves.ts` and `src/core/camera-moves.ts`):
  14 moves (the 13 of STUDIO-TOOLS §4 with the spiral split in two) as lists
  of the animation types that already exist, in units relative to the product
  (degrees, % of the framing distance, part sizes, focal and
  focus factors), and 3 handheld camera presets. `tests/camera-moves.test.ts` expands
  each into bars, evaluates them with `evaluate` at t = 0 and t = end (finite
  and deterministic, and at t = 0 nothing has moved), and checks that the dolly zoom
  keeps focal length / distance, that the turntable makes one revolution, etc.
- **Desktop server** (`engine/crates/rt-app/src/static_files.rs`): until
  now everything under `/assets/` went out with a one-year `Cache-Control: immutable`
  because Vite names everything there by hash; the new assets carry no hash and a
  file regenerated under the same name would have looked stale forever. Now
  only what is directly in `/assets/` and is called
  `name-XXXXXXXX.ext` (the 8-character base64url pattern that Vite 8 emits) is immutable;
  everything else goes out with `no-cache` and an ETag from the SHA-256 of its bytes (files
  up to 8 MiB; it answers 304 if unchanged, and a file regenerated with the same
  size and the same time is no longer confused with the earlier one). Rust tests that
  fail if anything without a hash is served immutable (with the names this
  same build emitted and those of `aperture/` and `gobo/`). `tests/chunks.test.ts` no longer reads the
  folders of `dist/assets/` as if they were files.

**Provisional values, awaiting O1 (rule 11, Fable's visual judgement).**
The lenses' *coatings* by era (before 1935 uncoated,
up to 1969 single-layer, afterwards multi-layer), the stop's default values
(circle, f/22 at most), the starting values of the bokeh
types (swirl 0.7, strength of the pupil profiles, the catadioptric's 0.49 obstruction…), the
meaning of `profileParam` in each profile and the handheld camera's
amplitudes (subtle, medium, strong) are starting points
with the keys as the contract; O1 will judge them with renders. The bokeh thumbnails
rendered by the engine are also left for O1.

**What did not fit the plan:** the `PAN` animation type does not exist yet (SPEC
§3.7), so the quick sweep is a fast orbit with a strong curve and the turntable
is `SPIN` on the model; the name “retrofocus” was a brand and the
lens is called *inverted-telephoto wide angle*; `CAMERA_MOVES` already existed in
`animation.ts` (the set of camera-only types) and the library is
`CAMERA_MOVE_LIBRARY`; an expander was needed in `src/core/camera-moves.ts` that
the plan did not name (N4 extends it); the stop position is only given by the
source for 6 of the 16 lenses (`stopBasis`) and for 9 it is assumed to be in the middle of the
gap that the report names; the report gives neither f-number nor semi-apertures for the macro,
nor semi-apertures for almost any lens, so those fields are left empty or
derived and marked.

### S0 · Particle decisions — **Fable** — done

Request: ambient particle simulation (rain,
suspended dust and how it reflects the lights, snow, dust cloud…) as
one more option inside *Scene*, fully configurable and simulated
in 3D. It is the **stateless** class of `STUDIO-TOOLS.md` §5 and of
`docs/research/particles.md` (§2.1, §2.6, §3.2, §4, §5): it needs no
cache or baking, and enters now as **S4a**. Decisions that hold for
the whole S family:

1. **Where the simulator lives.** A new crate `engine/crates/rt-sim`,
   `std` only, no `unsafe`, no system APIs, with the engine's
   determinism contract (`f32`, `fmath`, counter hash
   `mix64(seed ^ id)`): the same seed and the same instant give the
   same particles natively and in wasm (test with a position hash).
   It is used by `rt-core` (the render), `rt-wasm` (the Fast viewer, through a
   `particles_eval` export) and native `rt`. **There is no TypeScript
   port**: without wasm, the viewer draws only the emitter's box and the
   meter says so (rule 10).
2. **Time model.** Each particle is a pure function of (seed, id,
   time): birth = its own phase within its life (steady
   state, the scene is “full” from the first instant), closed-form
   motion (terminal velocity `v = v₀ + (v_t − v₀)(1 − e^{−t/τ})`
   integrated, no steps; constant wind; *curl noise* drift as a divergence-free
   **displacement** `d(x₀, t)`, not as an integrated velocity:
   so any `t` costs the same). No collisions except the
   floor (they die below `z = 0` and are reborn by phase). *Freeze at* the
   `time` instant of the effect; the N1 animation will move it later.
3. **What travels to the engine.** The **parameters**, not the particles: RSB
   section `FXAM` (≤ 256 B per effect, several allowed, ignored by an
   old engine), and the engine evaluates the particles on loading the scene and
   builds its BVH. An RSB with 1 M particles would be 24 MB per
   worker in the browser; this way it is 256 B.
4. **Primitives** in `rt-core`: sphere (stable intersection), oriented
   disc (flake) and capsule (swept sphere: the rain streak without
   motion blur), with a flat BVH of its own over the set and a
   single node in the TLAS. Catalogue materials by key (`MATL` already
   existing), with per-particle tint variation from its seed.
   **Minimum screen size**: a particle thinner than 0.35 px is
   widened to that for camera rays and its radiance is scaled by
   (real area / widened area), so the energy does not change (test).
5. **What does not enter S4a.** Haze, light shafts, ground fog and the
   dust cloud as a volume (participating medium with delta tracking): S5,
   after E9b (scattering media), and in S4a's list they appear
   as *coming soon*. Motion blur (N5). Collisions with
   parts, cache and baking (S2). Reading `.vdb`: no.
6. **Cost.** With 200 k particles, ≤ 1.3× the time per sample of the
   same scene without them; default cap 100 k in the browser and 1 M
   natively, in *Settings ▸ Render engine*.

### S4a · Ambient: stateless air particles — **Opus**, verdict **Fable** — done

**What.** In the *Scene* tab, a new **Ambient** section (in the
list of sections, after *Light* and before *Camera*) with a list of
effects (0..n; *Add* opens a gallery of cards) and, per effect:

- **Type / preset** (stable keys in `src/data/effects.ts`, names
  es/en): `DUST_MOTES` Dust motes, `POLLEN` Pollen, `RAIN` Rain,
  `SNOW` Snow, `DUST_CLOUD` Dust cloud, `ASH` Ash, `BUBBLES` Rising
  bubbles, `CONFETTI` Falling confetti; and, dimmed with *coming soon*
  (S5): `HAZE` Haze, `LIGHT_SHAFTS` Light shafts, `GROUND_FOG` Ground
  fog. Starting values for each preset: set by the lead with the contact sheet (rule
  11); the agent proposes some in the JSON and notes them as a proposal.
- **Eight photographer controls** (always visible): Amount, Size,
  Energy (speed), Chaos (spread + turbulence), Wind (strength and
  direction in degrees), Gravity, Variation, Seed (with shuffle).
- **Advanced** (collapsed): region (box around the scene with a margin
  in mm; or own box with centre and size; height band), density
  (particles/m³) or count, shape (point/sphere, flake/disc, streak/
  capsule), size mm ± variation, fall (terminal) speed ±
  variation, spin, wind (vector), turbulence (strength, scale, speed),
  cloud envelope (centre, radius, softness, for the dust cloud),
  material (catalogue key; by default the preset's: dust = light
  diffuse with a little specular; rain = glass; snow = white diffuse
  with a short `absorption`; pollen = yellowish diffuse; confetti = list of
  tints), tint variation, instant (*Freeze at*, s), visible to
  camera / in reflections / casts shadow (like lights), and the particle
  cap.
- Everything in `ProjectState` (new field `effects: AmbientEffect[]`), through the
  store and undoable, saved with the project (U2), the Doctor warns if
  there are more particles than the cap.
- **Fast viewer**: `THREE.Points` (dust, snow) or `InstancedMesh`
  (rain capsules) with the positions returned by `particles_eval`
  from the wasm, up to 50 k; selecting the effect shows its region's
  box. **Full and render**: the engine, through `FXAM`.
- **Light on the particles.** Nothing special: they are geometry with their
  material, so backlit dust glows through its specular and
  NEE lights them like everything else; a light behind the product makes the
  “dust in the beam”. The sheet has to show it.

**Engine.** `rt-sim` (S0 §1–2), `FXAM` in `rt-core::scene::rsb` (fields:
`kind u32`, `seed u32`, `time f32`, `count u32`, region (centre, half
size, band), size and variation, shape, terminal velocity and
variation, wind xyz, turbulence (strength, scale, speed), cloud
(centre, radius, softness), `material_id`, `tint_var`, `flags` (camera,
reflections, shadow), streak (length as a multiplier of the speed);
any left over, zero), the three primitives with stable intersection in
`geometry/` and a flat BVH (S0 §4), `Film` and passes unchanged
(a particle's `partId` = the effect's id; `materialId` its own).
`rt-wasm` exports `particles_eval(params, max) → f32[]` (xyz, radius,
orientation) for the viewer. No `sin`/`exp` per particle in the hot
loop: the terminal-velocity exponential is tabulated by `fmath`
once per effect.

**Depends on.** E3, E5 (glass for rain), E12 (light selection per
point: with 100 k particles, NEE from them must not choose blindly).

**Acceptance.** (1) Determinism: `hash(positions)` equal natively and in wasm
and with 1 and N threads, and the same pixel by pixel (test); with the effect at
count 0 the hashes of all reference scenes do not change.
(2) Steady state: the density measured in the region at `t = 0`,
`t = 3 s` and `t = 60 s` differs by < 3 % (test). (3) Rain dies on the
floor and is reborn above (test: no particle below `z = 0`). (4)
Energy of the widening to 0.35 px: a fine-dust image at 4 spp and at
256 spp has the same mean ± 2 % (test). (5) Cost: ≤ 1.3× with 200 k
particles in the sample scene (measured, in the ROADMAP paragraph).
(6) *Sheet* `out/ambient-sheet.html`: the sample bottle with the eight
presets at 512 px / 128 spp, each under two lights (side key and a backlight
behind the product, to see the dust glow in the beam),
plus rain with three streak lengths and the dust cloud with two
softnesses; by eye. (7) Captures `docs/ui/ambient-section.png` and
`docs/ui/ambient-gallery.png`; browser check
`tools/ambient-check.mjs` (add, change preset, undo, save and
open, cap). `SPEC.md` §3.1 (the effect as data), `UI.md`,
`ARCHITECTURE.md` (crate `rt-sim`, `FXAM`), `STUDIO-TOOLS.md` §5
(note: S0 decided, S4a done), CHANGELOG. Strings es/en, achromatic
chrome.

**Done.** **Engine.** `engine/crates/rt-sim` (`std` only,
`#![forbid(unsafe_code)]`): `AmbientParams` reads and writes the `FXAM`
payload (192 B; the first 128 are the fields of this section, in their
order), `evaluate(&params, max)` and `Evaluator::particle(id)`. Each
particle comes from `mix64((seed << 32) ^ id)` and a per-life hash: own
phase, velocity in closed form `v(a) = v_d + (v₀ − v_d)·e^{−a/τ}`
integrated (`τ` from the fall and gravity, `v₀` the drift plus *Energy* in
a random direction), *curl noise* drift as a displacement (three
gradient noises with quintic *fade* and analytic gradient; Bridson et
al. 2007), exponential and sine tabulated with `fmath` once per effect.
Those that fall (or rise) are born on the top (or bottom) face and live
as long as it takes to cross the box: so they die on the floor and are reborn above
without a density jump; those that float live forever and the box wraps. The
cloud, by rejection with a *smoothstep* edge. Tests: pinned position hash
(`PINNED_PARTICLES_HASH`), density at 0, 3 and 60 s within 3 %
(dust and rain, 200,000 particles, and the box equally full at the top as at the bottom), nothing below `z = 0`, rain is reborn above, any prefix
and any number of threads give the same particles, the cloud remains a
cloud. `rt-core`: `geometry/particles.rs` (sphere with the
stable intersection of *Ray Tracing Gems* ch. 7, oriented disc, capsule; flat BVH
per effect with one-particle leaves and the id as tie-breaker; `RayClass`
camera / secondary / shadow / parts for the three flags), `FXAM` in
`scene/rsb.rs` (reader and writer, several, validated; an earlier engine
skips them), each particle's material with its seed's tint,
passes with `partId` = the effect's index after the instances and `materialId`
its own, an update with the same parameters keeps the
particles and their BVH. Minimum size of 0.35 px for camera rays
with energy conserved (below). `rt --write-ambient-example` writes
the parity scene (`example::ambient_scene`: widened dust, glass
rain, snow with palette and no shadow); pinned image
`PINNED_AMBIENT_4SPP = 415d7d74` (it was `c4406309` before E12's per-point
light selection, which moves it; the particles did not) and particles
`e38b8480`, equal in scalar, SSE2, AVX2 and in scalar and
`simd128` wasm, with 1 and N threads; without effects all reference scenes
give the same hashes.
`rt-wasm`: `rt_particles_eval(params, len, max, out) → u32` (8 `f32` per
particle: centre, radius, axis, tint seed; `u32::MAX` if the payload
is not valid) and `engine/tools/wasm-parity.mjs --particles --expect-particles`.
**Interface.** `src/data/effects.ts` (the eight presets and the three from S5
*coming soon*, stable keys, es/en), `src/core/effects.ts`
(`ProjectState.effects`, undoable `effect/add|remove|set|preset`, the region,
the count and the cap, the fields and bytes of `FXAM`, the effects
of a file), the *Ambient* section (`insp-ambient.ts`), the Doctor's
`particles` check with its fix, *Settings ▸ Render engine ▸
Particles per effect*, the RSB writer (one `FXAM` per lit effect,
with its material after those of the parts) and the *Fast* viewer
(`THREE.Points` for spheres and discs, `InstancedMesh` of cylinders for
the streaks, up to 50,000 per effect, from `rt_particles_eval`; without
`rt.wasm`, the region's box and the meter says so). Tests:
`tests/effects.test.ts`, `tests/effects-rsb.test.ts` (the payload byte for
byte against that of `rt --write-ambient-example`, `tests/fixtures/ambient.rsb`;
with the real `rt.wasm`, the particles and the native engine's image),
`tools/ambient-check.mjs` (add from the gallery, change preset, a
control, undo and redo, save and open, the cap and the Doctor, the box
without `rt.wasm`, achromatic chrome in both themes; captures
`docs/ui/ambient-section.png` and `docs/ui/ambient-gallery.png`) and the sheet
`tools/ambient-sheet.mjs` → `out/ambient-sheet.html` (the eight presets
with a side key and a backlight, rain with 4, 12 and
30 ms streaks and the dust cloud with softness 0.2 and 0.9; 512 × 288, the 16:9 of the
camera, 128 spp, `--threads 2`; the sample camera with focal length × 1.5
so that the particles read, a dark flat studio and *Key only* as the only
light; scenes from `tests/ambient-rsb-dump.test.ts`).

**Criteria.** (1), (2), (3) by test, above. (4) The widening's energy: the
fine-dust image gives a mean of 1.0820557 at 4 spp
widened, 1.0820074 at 256 spp widened and 1.0809593 at 256 spp with the
exact particles (+0.10 %, within ± 2 %). (6) and (7), done; the presets'
values, accepted in the verdict. (5) **Not met**: see
*cost*.

**Cost** (criterion 5; native `rt`, AVX2, 2 threads, with the machine
shared with other agents: load 30–38 on 4 cores, so what counts are the ratios of
alternating rounds). The sample bottle
(9,248 triangles) with the side key, 512 × 288, 16 spp, three rounds:
without effect 5.46 / 5.68 / 7.31 s; with 200,000 dust motes (camera and
reflections, no shadow: the preset) 18.27 / 17.78 / 22.30 s, **3.2×** (3.35,
3.13, 3.05 per round); the same camera-only 15.04 / 15.91 / 16.52 s,
2.6×; with count 0, 5.16 / 7.36 / 6.96 s (the same as without effect). By
quantity, in two more rounds: 20,000 → 1.8×, 50,000 → 2.0×, 200,000 →
3.0×. Evaluating the 200,000 and building their BVH: 1.6–2.0 s, once per
scene load (not per sample). In the scene of `rt --example` (322
triangles, 512 × 384, 4 spp) it was 2.0–2.6 s versus 10.0–10.5 s. Two
variants tried that lower nothing: accepting with probability equal to the
coverage (more rays that pass through and are cast again: 3.4–3.5×) and
accepting or not within the traversal itself, without recasting the ray (3.1–3.4×;
camera-only 2.5–2.6×). The cost is **traversing the particles' BVH**:
20,000 particles already cost as much as the bottle's 9,248 triangles, and
the sample scene is too light for 200,000 exact primitives
to fit within 30 %. What could meet it, to decide: for camera
rays (all leave from the same point with a pinhole camera),
a screen grid with the particles projected, so that each
ray only tests those of its pixel instead of traversing the BVH; or lower
default caps.

**What did not fit the plan.**
- **The widening does not scale the radiance.** Multiplying the shading by
  `real area / widened area`, as S0 §4 says, darkens what is
  behind the widened disc (it covers it entirely): measured, −5.6 % in the
  test image. With coverage `c` the ray is shaded with probability
  `q = max(c, ½)` and weight `c/q`, or continues on with weight `(1 − c)/(1 − q)`:
  the expectation is that of the exact particle (test of criterion 4).
- **The particles are not a TLAS node** (S0 §4): each set is
  traversed after the instance BVH, with the ray already bounded by the
  nearest part (and a shadow ray looks at the parts first). It was the
  fastest of what was measured (one-particle leaves and sets afterwards: from 8.8× to
  4.4×), and a set's BVH does not depend on the camera: it is filled with
  the widening margin.
- **`FXAM` has 64 B more** than the fields of this section: `gravity`,
  `energy`, `spin` and a palette of 4 tints (the *Gravity* and
  *Energy* controls, the flakes' spin and the confetti colours had no
  field). The first 128 B are the plan's, in their order; within the
  256 B. The flags are positive (1 camera, 2 reflections, 4 shadow), not
  like bit 2 of `LGHT` (*no* shadow). The band is applied by the TypeScript
  writer to the box (it writes 0, 0); the engine respects it all the same.
- `rt-sim` cannot depend on `rt-core` (it is the other way round): it shares
  `fmath.rs` and `rng.rs` by compiling them through `#[path]`, and an `rt-core` test
  checks that they give the same bits.
- **E12 is not done** (a plan dependency): NEE from the particles
  uses the light selection that exists. With many lights and 100 k particles
  there will be more noise than there will be with E12.
- A disc is always thin-walled; snow with a “short `absorption`” is a
  thin white diffuse with 30 % transmission, because a flat flake has no
  interior. *Energy* is the birth velocity (m/s), which relaxes
  towards the fall.
- The section goes after *Environment* (which already went after *Light*) and before
  *Camera*. The cap row is in the *Engine* block of *Settings* (after
  SIMD), so as not to split the blocks.
- The viewer's picker does not pick particles (a click still picks parts).
  The AI post-processing guard sees the effects' materials as
  *Default* and their `partId`s name no node.
- `tests/project.test.ts` compared the state of `parseProject` with that of
  `loadProject` including the Doctor's results, which `loadProject`
  runs again with this version's checks: with the new `particles` they
  no longer match on an earlier file. The comparison leaves those
  results out and checks that they are this version's.
- **What CI does not have yet** (`.github/` is not touched in this phase): in the
  engine job, `rt --write-ambient-example` and `wasm-parity.mjs
  --expect 415d7d74 --expect-particles e38b8480` on that scene, and
  `tests/effects-rsb.test.ts` in the real `rt.wasm` step.

**Preset values** (rule 11; `src/data/effects.ts`; proposed
with the sheet and **accepted** in the verdict). Photographic densities, not
physical ones: the region is the product's box
with its margin (or the cloud's sphere) and the camera sees no more than
that. On the sample bottle (12.7 l of region; 1.6 l of cloud):

| Preset | Density (/m³) → particles | Size | Shape | Fall (m/s) | Others | Material | Shadow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dust motes | 150,000 → 1,912 | 0.2 mm ± 60 % | sphere | 0.3 × 0.05 g | energy 0.02, chaos 30 %, scale 80 mm, wind 0.02 | light diffuse, roughness 0.35 | no |
| Pollen | 40,000 → 510 | 0.3 mm ± 40 % | sphere | 0.2 × 0.1 g | energy 0.03, chaos 40 %, wind 0.05 at 20° | yellowish diffuse 0.6 | no |
| Rain | 20,000 → 255 | 1.2 mm ± 40 % | streak 12 ms | 6.5 ± 20 % | chaos 5 %, wind 1 | glass, ior 1.33 | no |
| Snow | 12,000 → 153 | 4 mm ± 50 % | flake | 1 ± 30 % | spin 0.5, wind 0.4 at 30° | thin white, 30 % transmission | yes |
| Dust cloud | 3,000,000 → 4,889 | 0.3 mm ± 60 % | sphere | 0.1 × 0.2 g | cloud 0.6 part sizes, softness 0.6, energy 0.3, chaos 80 % | brown diffuse 0.8 | no |
| Ash | 15,000 → 191 | 1.5 mm ± 60 % | flake | 0.4 | spin 0.8, wind 0.3 at 200° | almost black 0.85 | no |
| Bubbles | 10,000 → 127 | 2.5 mm ± 60 % | sphere | 0.25 × −1 g | energy 0.05 | thin glass | no |
| Confetti | 5,000 → 64 | 8 mm ± 30 % | flake | 0.8 ± 40 % | spin 1.5, 4 tints | paper 0.5 | yes |

**For the verdict, from the sheet**: backlit dust **barely glows**
in the beam. An opaque diffuse sphere lit from behind shows its dark side, the
specular of roughness 0.35 gives a very thin edge, and one of
0.2 mm at 512 px stays at the minimum size (its coverage spreads the
energy); a thin diffuse with 60 % transmission was tried and changes nothing
by eye (thin transmission is specular and NEE does not see it). The “dust in the
beam” of photographs is forward scattering: either a lobe of its own for
the particles, or wait for the E9b / S5 media. Backlit rain
does light up in the beam.

**Lead's verdict** (2026-10-14).

1. **Cost** (criterion 5): the ≤ 1.3× holds at the presets'
   densities, not at the 200,000 cap. By the measured curve (20,000 → 1.8×,
   200,000 → 3.2×), the presets on the bottle (≈ 1,900 motes, 4,900
   dust-cloud grains) should come out near 1.1×, but it is an
   estimate: S4b measures it first. The particles' BVH stays; the
   screen grid for pinhole camera rays is the first thing
   in S4b only if a measured preset scene exceeds 1.3×. The default cap
   stays as it is.
2. **Preset densities**: accepted as proposed
   (photographic, not physical). The table above stops being a
   proposal.
3. **Backlit dust**: accepted for now. S4b gives dust motes,
   pollen and the dust cloud a forward-scattering lobe so that
   a beam lights them: in the sheet, `DUST_MOTES-back` is barely visible at
   512 px, and “how they reflect the lights” is what was asked for. Rain that
   lights up in the beam is already fine.
4. **The little dots of the rain with the side key**: S4b. Drops
   make no caustics (a shadow ray that crosses a drop passes with its
   coverage and without refraction), the usual rule for small refractive
   particles; refraction stays for camera rays.
5. The widening by probability instead of scaling by area, the 192 B
   `FXAM`, the particle sets after the instance BVH,
   the placement (*Ambient* after *Environment*, the cap in the engine block),
   the maths shared through `#[path]` and the change to the project test:
   accepted as noted.
6. The missing CI lines are added by the lead to
   `.github/workflows/engine.yml` on merging.

## S4b · Particles: forward lobe, rain without caustics and measured cost — Opus — done

**What** (from the S4a verdict):

1. **The cost at the presets' densities, measured first.**
   `tools/ambient-sheet.mjs` gains a cost scene per preset, at the
   preset's count on the sample bottle (besides the 200,000 one), with its ratio against the
   scene without the effect in alternating rounds. Criterion: ≤ 1.3× per sample in each preset. Only if any
   exceeds 1.3× is the first job of the phase a screen grid for the
   camera rays of a pinhole camera (the particles projected;
   each ray tests those of its pixel instead of traversing the BVH). The BVH of
   the particles stays for the other rays; the default cap does not
   change.
2. **A forward lobe** for `DUST_MOTES`, `POLLEN` and `DUST_CLOUD`:
   Henyey–Greenstein scattering with g ≈ 0.7 (Henyey and Greenstein,
   *Diffuse radiation in the galaxy*, ApJ 1941; public literature), one more
   lobe of the particle's material, sampled and evaluated with E12's NEE
   MIS, so that a light behind the product lights them
   in its beam. Criterion: the sheet's `DUST_MOTES-back` is visible; energy is
   conserved (test).
3. **Drops without caustics**: a shadow ray that crosses a small
   refractive particle (rain, bubbles) passes with its coverage and without
   refraction; refraction stays for camera rays. Criterion:
   the sheet's little dots in `RAIN-side` disappear and backlit rain
   does not change by eye.

**Depends on.** S4a, E12.

**Done.**

**1. The cost, measured first.** `tools/ambient-sheet.mjs` gains a cost scene
per preset (`cost-<KEY>`: the preset at its density on the
sample bottle, with the side key, like those of the sheet), besides
the 200,000-mote one, and measures them in **alternating rounds**: each round
renders the scene without the effect and straight after that of the effect (so the load of
the shared machine weighs the same on both), its ratio is the cost per
sample of that round (the same samples; the evaluation of the particles,
once per load, aside) and the sheet gives the median (`--rounds`,
`--cost-samples`, `--only cost`). With S4a's engine (512 × 288, 32 spp,
2 threads, 3 rounds; `out/s4b-cost-before`, the binary of `09d8196`):

| Preset (particles) | Rounds | Median |
| --- | --- | --- |
| Dust motes (1,912) | 1.15 / 1.28 / 1.18 | 1.18× |
| Pollen (510) | 1.27 / 1.27 / 1.05 | 1.27× |
| **Rain (255)** | 2.08 / 1.76 / 2.02 | **2.02×** |
| Snow (153) | 1.07 / 1.18 / 1.21 | 1.18× |
| Dust cloud (4,889) | 1.37 / 1.14 / 1.08 | 1.14× |
| Ash (191) | 1.11 / 1.06 / 1.04 | 1.06× |
| Bubbles (127) | 1.24 / 1.19 / 1.14 | 1.19× |
| Confetti (64) | 1.07 / 1.11 / 1.14 | 1.11× |
| 200,000 motes (the cap, not a preset) | 2.93 / 2.70 / 2.99 | 2.93× |

Rain exceeds 1.3×, so the first thing was the **screen grid**
(`geometry::particles`, `ScreenGrid`): with a perspective camera each
set keeps a grid of 4 px cells over the image (larger cells if it would exceed 2²⁰) with, per cell, the particles whose box
(widened as camera rays see it, with the rounding margin of the
BVH boxes, and a long capsule in up to 32 pieces along
its axis) projects into it; a camera ray tests those of its cell (and
those that touch the camera plane, which every ray tests) instead of
traversing the BVH, with the same test and the same order: the same hit,
bit for bit. A box in front of the camera projects within the envelope of
its corners and every point of a ray leaving the centre projects where
its direction does, so the cell has everything the ray can touch. The
BVH stays for the other rays; the default cap does not change.
**But the camera of the sample and of the sheet (that of every new project) is
a thin lens at f/5.6**, whose rays do not leave from a point: a
pinhole grid would never have used it (measured: 0 candidates). It is
generalised without losing exactness: a ray leaving the aperture disc (radius `R`)
and crossing the focus plane (depth `z_f`) at `F`
passes, at depth `z`, within `R |1/z − 1/z_f|` (in tangent) of
the projection of `F`; each rectangle grows by that circle of confusion at
the worst depth of its box and the ray looks up `F`'s cell. A ray that
does not leave from the disc (a traced lens, the continuation from a cut-out)
traverses the BVH. The grid tests all the cell's candidates and the BVH
stops at the nearest hit: a cell with more than 128 particles
(`GRID_MAX_CANDIDATES`) sends its ray to the BVH (without a cap, 200,000 motes at
128 × 72 cost 721 M instructions per sample against 147 M without a
grid; measured on the camera ray of those motes with caps of 16, 64, 128,
256 and none, at 128 × 72, 512 × 288 and 1920 × 1080, 128 is the best or
ties with the BVH in all three: 1,355, 457 and 153 ns against 1,313, 1,137 and
550 with 16). In the rain cost scene, the grid leaves 1.8
candidate particles per camera ray.

With the grid, the lobe and the drops below, and the capsule that discards
earlier the ray that does not touch its infinite cylinder, the cost at the
presets' densities (the same method, 5 rounds, the final binary;
`out/ambient-sheet`, load ≈ 2.8 on 4 cores) and, to remove the noise of
the shared machine, the **instructions per sample** (*valgrind*,
deterministic: 3 spp minus 1 spp at 512 × 288, one thread; before, the binary of
`09d8196`):

| Preset (particles) | Time, rounds | Time | Instructions, S4a | Instructions, S4b |
| --- | --- | --- | --- | --- |
| Dust motes (1,912) | 1.07 / 1.07 / 1.06 / 0.93 / 1.09 | 1.07× | 1.22× | 1.08× |
| Pollen (510) | 1.02 / 1.10 / 1.14 / 1.07 / 1.05 | 1.07× | 1.15× | 1.07× |
| **Rain (255)** | 1.76 / 1.63 / 1.62 / 1.63 / 1.77 | **1.63×** | 1.75× | **1.50×** |
| Snow (153) | 1.18 / 1.19 / 1.16 / 1.22 / 1.21 | 1.19× | 1.17× | 1.15× |
| Dust cloud (4,889) | 1.15 / 1.14 / 1.09 / 1.13 / 1.09 | 1.13× | 1.21× | 1.10× |
| Ash (191) | 1.09 / 1.06 / 1.09 / 1.12 / 1.12 | 1.09× | 1.11× | 1.07× |
| Bubbles (127) | 1.13 / 1.03 / 1.18 / 1.09 / 1.21 | 1.13× | 1.11× | 1.10× |
| Confetti (64) | 1.11 / 1.16 / 1.14 / 1.07 / 1.10 | 1.11× | 1.11× | 1.11× |
| 200,000 motes (the cap, not a preset) | 2.00 / 1.94 / 2.08 / 1.91 / 1.91 | 1.94× | 2.17× | 1.94× |

All the presets stay below 1.3× except rain. The scene without an
effect goes from 874.2 M to 879.5 M instructions per sample (+0.61 %: the new
integrator checks; they are skipped without particles and the
BSDF entries are inlined), with the same pixels. Snow, ash
and confetti are opaque discs: neither the grid nor anything in S4b changes them much.

**Why rain is still above** (counted with counters in a copy
of the engine, 512 × 288, 8 spp): without an effect, most camera rays
go out to the background (1,179,648 camera rays and 124,644 shaded vertices);
with rain, the streaks cover 26 % of the frame and each camera ray
that touches a drop gives two glass vertices (entering and leaving) and the rays
that follow: the vertices of the drops alone are 699,326, 5.6 times all those
of the scene without an effect. It is the light transport
of a quarter of the frame being glass, not the BVH traversal (the
grid left it at 1.8 candidates per camera ray and 1.7 leaves per
traversal of the rays that follow, at 10 spp). What useless work remained was
removed: on a clear, smooth particle (`is_mirror`: roughness at the minimum, no
metal or diffuse) the next-event estimation only looks for delta lights
and the others are found by its BSDF ray, which counts what it finds in full
(an infinite density in the MIS: the power heuristic gives 1); the NEE
of an α = 10⁻³ lobe found almost nothing and traced a shadow ray
per vertex. Bounding the ray that enters a drop by its
own exit was tried (exact, falling back to the full search): 0.7 % of the
instructions, removed.

**2. Forward lobe** (`bsdf::forward`, with the citation of Henyey and
Greenstein, *Diffuse radiation in the galaxy*, ApJ 93, 1941). One more lobe
of the particle's BSDF: `(1 − s)·surface + s·albedo·p(μ)/|cos θi|`
with `p(μ) = (1 − g²)/(4π (1 + g² − 2gμ)^{3/2})`, `μ = −wi·wo` (the cosine
between the light's direction before and after), per unit of radiance and
solid angle, whatever the normal of the point hit (the particle
scatters like a small cloud, not like a surface; hence the
`1/|cos θi|`, which the integrator multiplies back). It is chosen with
probability `s` and within it `μ` by the inverse of its cumulative distribution
(isotropic if `|g| < 10⁻³`, the azimuth uniform, `fmath`'s `sin`/`cos`);
`Bsdf::pdf` is the density of the mixture, which is what E12's NEE MIS
weights; the NEE evaluates it with all lights (also those that are not
`glossy`, like the diffuse). Its rays that pass through the particle, and its
shadow rays, leave from its back face (from the widened particle if
a camera ray hit it). `FXAM` grows to 200 B: `forward` (the share `s`,
0..1) and `forward_g` (−1 < g < 1); a 192 B payload (S4a) has no
lobe. In the interface it is part of the effect's own material
(`EffectMaterial.forward`, `forwardG`): g 0.7 in dust, pollen
and the dust cloud, **share 0.5 (proposal, rule 11)**, 0 in the others; with
a catalogue material, or a transparent one, none (the engine could not distinguish
its rays from refraction); an effect saved before S4b takes its
preset's on opening. The parity scene (`example::ambient_scene`) gives it to
its dust. `DUST_MOTES-back` is visible (sheet, above): the motes in the beam
glow where before they barely did; with the side key, the image mean
goes from 24.64 to 24.57 (out of 255).

**3. Drops without caustics.** A particle with clear material
(`is_clear_material`: `(1 − metallic)·transmission ≥ ½`, no emission:
rain, bubbles) is crossed **straight, whole and without refraction** by shadow
rays (if the effect casts shadows, it now passes through it: `passable`) and
by the rays of a path that has already bounced off a broad lobe
(`RayClass::Rough`, `Tracer::trace_rough`: BSDF sample density <
`SHARP_PDF` = 100 sr⁻¹, wider than a GGX of roughness ≈ 0.15), with the
straight transmittance of a thin wall of its material (the Fresnel of the
two faces and its tint, once) and from beyond its back face
(`Prepared::straight_through`); a ray of that class only sees the effect if it
casts shadows, and its crossing is a straight event (it keeps the density and
the light selection of the last vertex for the MIS). The camera
and the narrow-lobe paths from it (a mirror, the bottle's smooth glass)
still see the drops refract. The caustic photons
already stopped at the particles (they are not among the parts that focus them,
S4a). In
`RAIN-side` the little dots on the body and the label of the
bottle and the floor disappear (sheet, crop); `RAIN-back` does not change by eye.

**Tests** (each with its mutation, in a copy of the engine: all fifteen
make it fail, and they pass without it):
- `geometry::particles::grid_tests::camera_rays_find_through_the_screen_grid_what_brute_force_finds`
  (pinhole, f/2 at 900 mm and f/1.4 at 300 mm; spheres, discs and capsules
  of 600 particles, widened motes, some on the camera plane or
  behind it; 6,000 rays, also outside the frame, through the grid, the same
  hit as brute force; a ray that does not leave from the lens, through the BVH;
  and a crowd of 40,000 whose full cells send their rays to the BVH,
  with the same hit). Mutations: without the circle of confusion; without the
  particles on the camera plane.
- `bsdf::forward::tests`: the phase integrates to 1 with `g` of mean cosine (g 0;
  0.3; 0.7; −0.5; 0.95); sampling gives its density (histogram of `μ` to
  5σ); the BSDF's white furnace (white Lambert and white lobe with share
  0.25, 0.5 and 1: 1 ± 1 % from 0°, 45° and 80°) and the dust mixture
  (`(1 − s)·surface + s·colour`, ± 1.5 %); weights `f |cos| / pdf` and the
  mixture's density integrates to 1 over the sphere; without the lobe, the surface's numbers
  bit for bit. Mutations: the density without the lobe; the
  evaluation without `1/|cos θi|`.
- `integrator::particle_tests` (new): `the_forward_lobe_is_unbiased_with_either_technique_and_with_both`
  (a 120 mm white mote with a light sphere behind it and to one side: MIS
  2.38148, NEE only 2.38179, BSDF only 2.38721; 4096 spp, 8 × 8; the mote
  casts shadows, so it also proves that its rays leave from its back face);
  `a_white_mote_with_a_forward_lobe_vanishes_in_the_white_furnace`
  (share 0.5: 0.99997; 1: 1.00014); `a_light_behind_a_mote_lights_it_through_its_forward_lobe`
  (0.050 without the lobe, 2.38 with it); `rough_paths_do_not_see_a_drop_that_casts_no_shadow`
  (the floor under a drop with no shadow is the floor without it, bit for bit);
  `shadow_rays_cross_a_drop_straight_with_its_transmittance` (under the drop,
  0.9585 of the light without it; the calculation, `(1 − R)/(1 + R)` = 0.9607);
  `rough_paths_cross_a_drop_that_casts_shadows_as_shadow_rays_do` (a large drop
  under a panel: MIS 2.18132, NEE only 2.18133, BSDF only 2.18051, and
  less light than without it); `camera_rays_still_see_a_drop_refract` (a water ball
  in front of a wall with the left half lit: the camera
  sees it upside down, 0 on the left and 0.956 on the right);
  `smooth_drops_leave_their_lights_to_their_bsdf_rays_without_bias`
  (10.85212 with the rule, 10.85208 with NEE on the drop). Mutations: the
  rough ray sees the shadowless drop; the rough ray refracts; the shadow
  ray takes it as solid; crosses each face; is not `passable`; shadow rays
  and lobe rays from inside the mote; no lobe; every path
  stays sharp; the camera crosses it straight; the smooth-drop rule with density 0.
- `rt-sim::params`: the 200 B payload with its offsets, the 192 B one
  without a lobe, share outside 0..1 and `g` outside (−1, 1) rejected.
- TypeScript: `tests/effects.test.ts` (which presets send the lobe, none
  with a catalogue or transparent material, the limits, an effect from before S4b takes its preset's) and `tests/effects-rsb.test.ts` (the payload
  byte for byte against that of `rt --write-ambient-example`, with the dust's
  lobe).

**Hashes**: `PINNED_AMBIENT_4SPP` `0xeb60bea2` → `0x8f9efac8` (the lobe of
its dust and its glass rain, which casts shadows, crossed straight by the
shadow rays and the rough ones), the same in scalar, SSE2, AVX2, in scalar
and `simd128` WASI and in the real `rt.wasm` (`wasm-parity.mjs`); the
particles, `PINNED_AMBIENT_PARTICLES` `0xe38b8480`, do not move; no
other hash moves (without particles, the scenes do not change a bit). In
`engine.yml` the *Ambient* parity block reads the two pins from the
source; only its comment changes.

**Sheet** `out/ambient-sheet.html` (512 × 288, 128 spp, 2 threads): at the top,
before and after (the binary of `09d8196` against this one, `--rt-before`) of
`DUST_MOTES-back`, `POLLEN-back`, `DUST_CLOUD-back`, `DUST_MOTES-side`,
`RAIN-side` and `RAIN-back`, each pair with a ×2 crop; the eight presets with
both lights; the motes with shares 0.25, 0.75 and 1 (those above have
0.5); `RAIN-side` at 1,024 spp; the streaks and softnesses of S4a; the
cost table.

**What did not fit the plan.**
- **A pinhole camera's grid would not have served**: the camera of
  every new project (and the sheet's) is f/5.6. It was made for the thin lens
  too, exact (above); without it the criterion would not have moved.
- **Rain is still above 1.3×** (1.63× in time, 1.50× in
  instructions, above): its cost is
  shading the glass that covers a quarter of the frame, not traversing the BVH. What
  would lower it is no longer exact or cheap (shorter or less dense
  streaks, or simpler camera drops): for the verdict.
- **The dots in `RAIN-side` had two sources.** The one the verdict asked for
  (the caustics: rays from the bottle's body and label and from the floor that refracted
  through the drops to the key) disappears. The other
  stays, because it is the refraction the verdict keeps: the key seen
  **through each drop** by the camera is a tiny bright detail inside
  each streak, and at 128 spp it comes out grainy; it converges
  (`RAIN-side` at 1,024 spp, in the sheet: the streaks come out
  smooth). For the verdict.
- **“Passes with its coverage”**: read as the straight transmittance of a thin
  wall of its material (Fresnel of the two faces, once). And not only the shadow
  rays: the preset's rain casts no shadow, so changing only those did not touch the dots; the floor's and the bottle's BSDF rays that cross it have to do
  the same so that the NEE and the BSDF estimate the same thing (test of the three
  techniques).
- **“Refraction stays for camera rays”**: extended to the
  narrow-lobe paths from the camera (`SHARP_PDF`), so that
  rain is still seen through the bottle's glass and in mirrors; with the strict rule it would disappear there. For the verdict.
- **The smooth-drop rule** (NEE of delta lights only) was not in
  the brief: it comes from the rain count; it does not change the mean (test).
- **The lobe travels in `FXAM`, not in `MATL`**: it belongs to the effect (its own
  material), `MATL` is the parts' (and M2b is changing it); only with
  opaque material. *Fast* does not show it (the preview's points).
- The capsule discards the ray that does not touch its infinite cylinder before
  computing roots (−2 % of the rain's instructions); the bound on the
  ray entering a drop was tried and removed (0.7 %).
- **TRIAGE 1.2** (drop shape and varied geometries, pending decision,
  rule 11; not done): what S4b leaves done: the grid and the BVH are
  per set and already split a capsule into pieces (`camera_boxes`), so
  a new shape only needs its hit test, its normal, its exit
  (`exit`) and its boxes; mixing shapes per particle would be a
  per-particle shape code in `rt-sim` and in `ParticleSet` (all routes
  already dispatch by shape in `hit`, `exit` and `normal`); and a
  teardrop of water would be clear (`is_clear_material`) and smooth (`is_mirror`),
  so it would inherit the caustics and NEE rules without touching them.

**For the verdict** (rule 11):
1. The **lobe share**: 0.5 proposed; the sheet has 0.25, 0.75 and 1
   with both lights. With a higher share, the motes in the beam glow more and those
   under the side key lose some of their diffuse.
2. The **rain's cost** (1.63× in time, 1.50× in instructions):
   accept it, or shorter or less dense streaks in the preset, or a simpler
   camera drop.
3. The **grain inside the streaks** with the side key (the refraction
   that stays): accept it as noise that converges or regularise it.
4. The **sharp-path rule** (`SHARP_PDF`) versus strictly “camera rays
   only”.

## Physics: rigid bodies, cloth and liquids — **Fable** decision

Request (2026-10-14): realistic physics with its own *Start / Stop*
(stopped by default); “**Drop**” in the context menu of a
model or solid, with the simulation stopping on its own when the solids
come to rest; **cloth** over a face or a solid of a model, with
behaviour according to the **weight per area** and the type of fabric (a fine cotton
does not fold like a thick leather) and the **stiffness** to choose;
**liquids** by viscosity, with the option to turn a solid into liquid; and
for everything to be usable for animations too. These are S2, S9 and S7 of
`STUDIO-TOOLS.md` §5 and `docs/research/particles.md` §6. Decisions:

1. **Where it lives.** A new crate `engine/crates/rt-phys` (`std` only,
   no `unsafe`, deterministic: `f32`, `fmath`, fixed step of 1/240 s with
   4 substeps, contacts ordered by (id, id, feature), transform hash
   equal with 1 and N threads and native = wasm; v1 on a single
   thread). A single **extended position-based dynamics (XPBD)** framework:
   rigid bodies (Müller, Macklin, Chentanez, Jeschke, Kim, "Detailed Rigid
   Body Simulation with Extended Position Based Dynamics", SCA 2020),
   cloth (Macklin, Müller, Chentanez, "XPBD", MIG 2016), liquids (PBF,
   Macklin and Müller 2013). Separate from `rt-sim` (S4a, stateless).
2. **Where it runs.** In the interface, in a worker through `rt-wasm`
   (`phys_*`): the Fast viewer shows the simulation live without touching the
   store; **Stop** confirms the current pose as **one** undoable
   action; **Reset** goes back to the previous pose. Native is not
   needed in v1 (the desktop uses the same interface).
3. **The physics bar** (at the bottom, next to the animation one): ▶ Start ·
   ⏸ Pause / ▶ Resume · ■ Stop · ↺ Reset, simulated time,
   bodies awake, state (*stopped* by default). Pause freezes the
   simulation where it is (cloth, liquids and rain are expensive: the person decides when to continue); Stop confirms it; Reset
   undoes it. The meter says what the simulator says
   (rule 10). A **Physics** section in the part inspector: role
   (static / dynamic / cloth / liquid), mass by density (table per
   material family; it can be fixed), friction, bounce, *as
   parts* (a group falls as one body or each part on its own).
4. **Sleeping.** A body with velocity below a threshold for 0.5 s sleeps;
   with all asleep the simulation stops on its own and confirms the pose.
5. **Animation.** **Every simulation enters the animation on its own** (request,
   2026-10-14): on starting, a `PHYSICS` motion clip is born
   on the timeline (baked track: positions and quaternions per
   frame at the project's fps, `f32`, saved with the project) that
   grows while the simulation runs, stays where it stops and the
   N1 timeline plays like any other clip; *Reset* removes it
   (undoable). There is no separate “record” step: the still image
   uses the frame at the playhead, and the animation already has the simulation. Cloth and liquids store their mesh per
   frame in a cache next to the project (key = hash of
   parameters + geometry + seed + version).
6. **Order.** S2 now (the basis of everything); S9 and S7 after S2, when the
   machine allows it (eight agents in parallel already saturate it).

### S2 · Rigid bodies: “Drop”, the physics bar and recording — **Opus** — done

**What.** `rt-phys` v1: XPBD rigid bodies with automatic **convex hull**
per part (own *quickhull*) for the dynamic ones, and static
parts and the floor as triangle meshes (`rt-core`'s BVH);
hull–hull contacts (own separating axes / GJK–EPA) and hull–triangle contacts;
Coulomb friction, restitution, sleeping (§4). Gravity −Z (the model is Z-up), 9.81 m/s², mm in the
scene. `rt-wasm` exports `phys_new(scene)`, `phys_step(n)`,
`phys_poses()`, `phys_awake()`. Interface: **Drop** in the context
menu and in the *Part* menu (the selected parts become
dynamic, the rest and the floor static, it starts and stops on its own on
sleeping; with a group, *as parts* decides), the physics bar (§3), the
*Physics* section of the inspector (§3), *Record as animation* (§5) with the
`PHYSICS` clip in `src/core/animation.ts` and the bar on the timeline.
Doctor: warns if a dynamic part goes through the floor at the
start. Strings es/en; achromatic chrome; everything through the store.

**Depends on.** U3 (move), U9 (primitives), N1 (animation).

**Acceptance.** `rt-phys` tests: a sphere falls onto the floor and
rests at `z = r ± 0.1 mm`; a stack of three boxes stays stacked for 5 s;
a box tilted 30° falls over on its side and rests flat; the cube on a
static sphere slides off and falls; a thousand spheres settle in < 20 s
natively, one thread (the time goes in the ROADMAP paragraph); sleeping stops the
simulation; pose hash equal with 1 and N threads and native = wasm;
interface tests (mutation checked): *Drop* is a single undoable
action, *Reset* restores, the `PHYSICS` clip is saved and opened.
Browser check `tools/physics-check.mjs` with captures
`docs/ui/physics-bar.png`, `docs/ui/physics-drop.png` (before/after
dropping three primitives onto the floor) and a GIF or 6-frame strip
`docs/ui/physics-drop-strip.png`. `SPEC.md` §3.1 and §3.7,
`UI.md`, `ARCHITECTURE.md` (crate `rt-phys`, the worker), CHANGELOG.

**Done.** In three steps:

- **`engine/crates/rt-phys`** (`std` and `rt-core` only, `#![forbid(unsafe_code)]`):
  XPBD of Müller et al. (SCA 2020) at 1/240 s with 4 substeps; convex
  hull by own *quickhull* (Barber et al. 1996, coplanar faces
  merged by normal and by distance to the plane) with a cap of 128 vertices and
  an oriented box by principal components as a fallback; spheres
  recognised as such (≥ 26 points within 0.2 % of the radius) and treated as
  exact spheres; contacts by separating axes with pruning by the Gauss
  map (Gregorius), Sutherland–Hodgman clipping, ≤ 4 points, speculative
  margins; Coulomb friction, restitution with the 2|g|h threshold,
  sleeping and waking; the PHY1 format; `World` (`add_floor`,
  `add_static_mesh`, `add_dynamic`, `step`, `poses`, `awake_count`,
  `settled`, `hash`). Eleven tests in `tests/rigid.rs`, those of the criterion plus
  a ramp (holds at μ 0.6, slides at 0.1), the drop pinned by hash
  at 60, 90, 120 and 480 steps (`tests/fixtures/phys-drop.json`) and the hash
  equal with 1, 2, 3, 5, 8 and 13 pieces of narrow phase and with 3 threads.
  **A thousand spheres** (radius 10 mm, ten layers of ten by ten in a tray)
  settle in **1.70 s simulated**; in release, one thread, **7.05 s**
  of wall clock on the 4-core virtual machine with seven other agents
  compiling (load ~30; an earlier measurement with less load gave 2.4 s of
  CPU).
- **`rt-wasm`**: `phys_new`, `phys_free`, `phys_step`, `phys_bodies`,
  `phys_ids`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_steps`,
  `phys_hash`, over a registry of worlds by *handle*. Native = wasm:
  the `rt-phys` tests pass compiled to `wasm32-wasip1` with the same
  hash, and `tests/physics-engine.test.ts` repeats the pinned drop with the
  real `rt.wasm`.
- **Interface**: `core/physics.ts` (roles, density per material
  family, `physicsSpec`, the poses back to the nodes inside rotated
  and scaled groups, the `PHYSICS` track and its anchor, the
  `physics/*` actions), `io/phys.ts` (PHY1), `render/physics-worker.ts` and
  `physics.ts`, `ui/physics.ts` (the running simulation), the physics
  bar, the *Physics* section, *Drop* in the context menu, in the
  inspector and in the palette, the `PHYSICS` clip on the timeline and the Doctor's
  `physics` check (16 checks with U13's `aspect`; 16 animation
  types).
  `tests/physics.test.ts` (24 tests, each checked by reintroducing its
  error) and `tools/physics-check.mjs`, with the three captures.

**What did not fit the plan** (rule 12):

- **There is no *Part* menu in the header.** *Drop* is in the context
  menu (the same in the tree and the viewport), in the *Part*
  and *Physics* sections of the inspector and in the palette.
- **“`rt-core`'s BVH”**: `rt-core`'s answers rays (width 4/8,
  SAH), not “which triangles touch this box”; `rt-phys` has its own,
  small (median split, leaves of 4), and `rt-core` is not touched. **GJK–EPA** was
  not needed: separating axes for hull–hull and
  hull–triangle, and an analytic sphere. The floor is a single enormous
  triangle: with two, the diagonal skewed the friction.
- **Deviations from the paper** needed so that a resting box
  neither drifts nor turns and a stack of three does not fall: friction per patch
  (at its centroid, with torsion by the patch radius, and at minimum a
  rolling arm: a ball that spun on its support point
  never stopped) and not per point;
  static friction **anchors** that are kept from step to step; dynamic friction
  as an impulse of at most μλ/h; the coplanar patches of a body against static ones
  merged into one; rolling resistance of
  0.02 r (a rolling ball ends up stopping); sleeping by travel in a
  0.5 s window and not by instantaneous velocity (contact jitter
  let nothing sleep); waking only by something approaching fast
  (chains of wake-ups did not let the thousand spheres settle).
- **The cube on the sphere**: on a coarsely tessellated sphere a cube
  can really rest on a facet. The test uses a 32 × 64 sphere,
  μ 0.2 and the cube slightly displaced from the summit; it slides off and falls.
- **The time of the thousand spheres** is required (< 20 s) only in release; in
  *debug* the test checks that they settle.
- **The exports** are more than the plan's four (`phys_new(scene)`,
  `phys_step(n)`, `phys_poses()`, `phys_awake()`): a *handle* per world and
  `phys_ids` (where each body ended up; one without mass is not simulated).
- **Recording** (decisions 3 and 5, changed midway through the phase): there is no
  *Record as animation* button; every simulation records itself into one
  `PHYSICS` clip per body that grows while it runs. Hence decision 2
  (“the Fast viewer shows the simulation live without touching the store”) is
  met only in part: the **nodes** do not change until confirmed, but the
  clips grow and the playhead follows them through the store (`physics/grow`,
  `anim/playhead`, within the simulation's gesture: one undo entry
  with the start and the confirmation), and the viewer shows it through the
  animation. While it runs, the viewer stays in *Fast*.
- **Pausing on a loaded page.** The browser check found
  that, with the main thread busy, the worker finished the simulation
  before the page saw the pause. Now the page acknowledges each
  send and the worker gets no more than 1/8 s ahead (it goes more slowly
  instead of finishing unseen), what arrives while paused waits for *Resume*,
  *Stop* confirms the pose that is seen (not the one the simulator reached
  afterwards), and a pause requested before the worker has the
  simulation reaches it just afterwards. With their tests.
- **The clip's anchor** (not in the plan): without it, a `PHYSICS` clip
  pinned the node to its frames and the part could no longer be moved afterwards
  after a drop. The clip stores the pose it refers to (`anchor`) and
  plays moved by whatever the node has moved since.
- **The playhead at 0** (for **Fable**'s judgement): N1 shows at 0 the
  scene as it is edited, and after a drop from 0 the edited pose is already the
  final one, so at 0 the part was seen at rest and one frame later
  in the air. What was built: at 0 the nodes held by a recorded simulation
  show their frame (also the still image: “uses the frame at the
  playhead”), the rest as edited, and the gizmo does not appear on those nodes
  at 0 (as it does not appear with the playhead past 0). The other option, following N1
  to the letter, is to remove `playheadPose` and its gizmo rule.
- **Density per material family**: the table goes by the seven
  `MATERIAL_CATEGORIES` (metal, plastic, wood, fabric, glass, emissive,
  other), which is the stable key each material has; the values are
  typical ones, for **Fable** to review.
- `migrateProject` (`io/project.ts`) runs the Doctor again on opening,
  as `loadProject` already did: with a new check, a project opened
  through it carried the earlier results. The session branch did the same
  (U13); on merging it ends up only once, its own, with S2's test that fails
  without it.
- CI is not touched (`.github/` is outside the phase): native = wasm
  parity is checked by the `rt-phys` tests on `wasm32-wasip1` and
  `tests/physics-engine.test.ts` when there is an `rt.wasm`.
- **On merging the session branch** (N6, E12, U13, P6/P6b, O1, U12, L6,
  M2a, P5): the `PHYSICS` clip lives in N6's three-zone timeline
  (its properties: start, duration, end, repeat, reverse and the note;
  no amount or curve), goes through the same time as any clip
  (`clipPhase`: repeated, reversed) and `playheadPose` respects N6's
  `poseActive` (a reversed clip holds its end before
  starting). The Doctor: the 14 of origin, `aspect` (U13) and `physics` (S2).

**Lead's verdict.**

1. **The playhead at 0**: confirmed as built. At 0, the
   nodes held by a recorded simulation show their clip's frame
   (in the viewport and in the still image) and the gizmo does not appear on them.
   Reason: frame 0 of a rendered animation has to be the
   start of the fall, and the still image follows the playhead, which a
   simulation leaves at the end, so *Drop* and render gives the pose
   at rest; following N1 to the letter would introduce a jump between frames
   0 and 1 of every animation. `playheadPose` and the gizmo
   rule stay.
2. **Densities per material family**: accepted as typical
   values; they are reviewed with the materials phases (M4), not now.
3. **Decision 2 met in part** (the clips grow through the store, inside
   the simulation's single undo entry): accepted. It is exactly what
   “every simulation records itself” asks for, and one undo entry is
   right.
4. The rest of what was noted (from the *Part* menu to parity without touching CI):
   accepted as is. The Doctor that is run again in `migrateProject`
   stays, with its test.

### S9 · Cloth with real physics — **Opus** (after S2)

**What.** XPBD cloth (distance, dihedral bending, optional area) over
**a face** (the mesh of the chosen part or of the face selected by
levels) or **a solid** (its shell, with pressure for closed ones: cushion,
soft container). Presets by **fabric type and weight per area** (`src/data/
fabrics.ts`, stable keys: silk 60 g/m², fine cotton 120, poplin
150, linen 200, wool 300, denim 400, canvas 600, felt 800, thin leather
900, thick leather 1,200, neoprene 1,500…) with mass per area, stretch
stiffness, bending stiffness and damping; **Stiffness** and **Weight**
editable on top of the preset, and *Thickness* for collision. Collision
with the static parts and the rigid bodies of S2, self-collision by a spatial hash
grid, anchors (by vertex selection in a box or by the
top edge), wind from S4a. A *Drape over the part* preset (a plane
of cloth over the product). The physics bar and recording from S2; the
cloth's mesh per frame in the cache (§5). **The shading of the
fabric is M5**, not this phase.

**Acceptance.** A 1 m cloth hangs from two corners and its lowest point
ends up within 2 % of the analytic catenary for the weight; silk
and thick leather, with the same cloth over the sphere, give wrinkles of
different scale (metric: mean curvature; silk ≥ 3× the leather's);
nothing goes through the sphere (minimum distance test); determinism;
sheet `out/cloth-sheet.html` with the presets over the sample bottle.

### S7 · Liquids — **Opus** (after S2 and the nested dielectric)

**What.** Position-based fluid (PBF) with viscosity (XSPH), cohesion and
surface tension; presets (`src/data/liquids.ts`: water, oil,
honey, milk, gel, syrup…) with density, viscosity and colour/absorption;
**Convert to liquid** in the context menu: the part is filled with
particles by ray parity, hidden, and a *Liquid* part is born
whose surface is rebuilt by marching cubes every frame (in
the worker); the containers are the static parts. Engine:
**nested dielectrics** by priority (Schmidt and Budge, "Simple Nested
Dielectrics in Ray Traced Images", JGT 2002) for liquid inside
glass; glass material with absorption. Bar, recording and cache from S2.

**Acceptance.** A litre poured into a closed glass keeps its volume
± 3 %; honey takes ≥ 5× longer than water to level (test); nothing
goes through the glass; determinism; sheet `out/liquid-sheet.html`.

### S3 · Rain and dust on the set and on the lens — **Opus** (after S4a and S2) — first part done (the drop, the shape mix and the front glass); the second, S3b (the glass fed by the scene); the rest, S3c

Request (2026-10-14): S4a's rain falling onto the set and the
part and **running down** realistically; dust **settling**; and for
drops and dust to be able to affect **the lens** or not, like a glass in front. It is an expensive computation: it goes in the physics worker with Pause /
Resume, with a cache, and enters only in the animation (§3 and §5 above).

**What.**
1. **Drops on surfaces.** A rain particle of S4a that touches
   a surface (its path is deterministic by seed: the
   landings are reproducible events) is born as a **drop**: a spherical
   cap stuck to the surface (a sphere with its centre below it, the
   engine already traces spheres: S4a), with water material (glass IOR 1.33). The
   drops **grow when they merge**, stay **anchored** by the
   contact-angle hysteresis of the material (wettability per family:
   glass, plastic, metal, paper, paint; table in `src/data/`) and
   **run down** when their weight along the tangent overcomes it,
   leaving a **wet trail** (thin film: lowers the roughness and
   darkens porous material: wetness mask in the material) and picking up
   the drops they meet; at an edge they **drip** (become
   falling particles again) and on impact they splash (secondary drops). Snow:
   accumulates as a layer (S4a profile) and does not run.
2. **Settled dust.** A coverage field per surface (texel grid
   per part or per vertex) that accumulates what S4a's dust flow
   deposits (upward exposure × time × density), with
   an **angle of repose** (it sheds from steep faces) and that rain
   **cleans** where its trail passes. It is rendered as a layer
   (greyish diffuse that raises roughness, blended by coverage) with
   visible motes (tiny discs from S4a where coverage is high).
3. **The lens glass.** In Camera ▸ Lens ▸ Filters, **Front
   glass** (yes/no): a sheet attached to the camera at the distance of the
   front element (20–40 mm from the pupil, depending on the lens) onto which
   the rain and dust of the scene's effects fall with the same
   models (drops run according to the camera's *up*; dust
   settles if it looks upwards). It is **real geometry** in front of the
   lens: camera rays pass through it and each drop refracts
   like the lens it is (inverted and heavily defocused blotches, as in
   a real photo), the dust is dark soft motes. Manual controls
   for a still image without simulating: number of drops, size,
   dust, seed. Without the glass, nothing touches the lens.
4. **Simulation.** In `rt-phys` (fixed step, deterministic), with the physics
   bar (Pause / Resume), a cache next to the project (drops per
   frame, coverage per frame, key = hash of parameters +
   geometry + seed + version) and the automatic `PHYSICS` clip (§5).
   The Fast viewer shows the drops as spheres and the coverage as a
   tint; the engine renders the real thing.

**Depends on.** S4a (particles and primitives), S2 (`rt-phys`, bar,
cache, clip), O1 (`LENS`: the front element's distance).

**Acceptance.** Tests: a drop on glass tilted 30° stays until
the table's critical radius and slides above it (numerical test against
the tangential force / contact angle equilibrium); two drops that touch
add their volume (± 1 %); the trail cleans the dust; dust coverage
on a face at 60° is < 10 % of the horizontal; the front glass with 0
drops and 0 dust leaves the render bit for bit the same as without glass;
determinism and reproducible cache; the clip exists after starting and
disappears with Reset (undoable). Sheet `out/rain-dust-sheet.html`:
the bottle under rain at 0, 2, 5 and 15 s (drops, trails, dripping), dust at
0, 30 and 120 s, and the same photo with the front glass wet and
dusty; by eye (**Fable**'s verdict). Captures `docs/ui/physics-rain.png`,
`docs/ui/lens-glass.png`. `SPEC.md`, `UI.md`, `ARCHITECTURE.md`,
CHANGELOG.

**Done (first part; the rest, S3b, below).** The phase is large and did not
fit entirely in one PR without lowering quality: what enters is decision **1.2**
(the drop shape and the geometry mix in *Ambient*, requested by the
owner) and point 3 as a still image without simulation (the front glass with
its manual controls: number of drops, size, dust, seed). The drops
that fall and run down the parts, the dust that settles, the glass
fed by the scene's effects and the simulation with cache and clip
are the **S3b** proposal.

**1. The drop and the shape mix (1.2).**
- **`rt-sim`.** `Shape::Drop` (code 3 of `FXAM.shape`; an earlier engine
  reads it as a sphere): the particle's round body and a tip of
  `drop_tip` times its radius whose centre lies `drop_tail` radii behind,
  **against the velocity** (the falling drop points up, the rising bubble
  down; at rest, along the normal of its life), with at least
  0.05 radii of tip outside the body. The **mix** (`mix`, one weight per
  shape: sphere, disc, capsule, drop) draws each particle's shape once with its own hash, so that each keeps it at any
  instant; `shape_var` lengthens or shortens each one's drop or streak
  (`± shape_var`) with another. The salts are new: the shape changes no
  position, size or tint, and an effect without S3 fields gives its usual bits. `Particle` gains its `shape`; `positions_hash` does not include it (it is
  S4a's) and `shapes_hash` pins it separately. `FXAM` grows to **228 B** only when
  there are S3 fields (`has_s3_fields`): an effect without drops, mix or variation
  keeps S4b's 200 B (and `tests/fixtures/ambient.rsb` does not change).
- **`rt-core`.** The drop is the convex hull of two spheres: the
  tangent cone `ρ cos β + s sin β = r` solved as a quadratic from the point of the
  ray nearest the body (without cancellation for a tiny distant drop),
  the body where `s < r sin β`, the tip beyond the contact circle;
  every root that remains is on the convex boundary, so the nearest one in the
  interval is valid, as in the capsule. Piecewise normal; `drop_distance`
  (the exact distance) for the tests. Widened for the camera, the drop is
  scaled whole around its body (coverage = square of the scale) and
  the boxes' margin grows with its length (`drop_reach`). A set that
  mixes stores each slot's shape and all the tests dispatch on it
  (hit, exit, normal, coverage, screen-grid boxes); the
  integrator asks per particle whether it is a disc (thin wall) and per
  set whether all are (no medium inside). `rt_particles_shapes` (wasm)
  gives *Fast* each particle's shape.
- **The page.** `EffectShape` gains `DROP`; `AmbientEffect` gains `shapeMix`
  (`on` and the four weights), `dropTail`, `dropTip` and `shapeVar`
  (`core/effects.ts`: `mixWeights`, `effectHasShape`, `heaviestShape`,
  `hasS3Fields`); the new preset **`WATER_DROPS`** *Water drops* (code
  12). In *Ambient ▸ Advanced* the **Shape** becomes a list (*Point ·
  Flake · Streak · Drop · Mix*), with the mix weights and the share of
  each, the drop's length and tip and the shape variation, each
  one undo entry; the spin and streak length also appear when
  the mix has flakes or streaks. *Fast* draws the drops with the engine's outline
  (`dropOutline`, in an instanced `LatheGeometry`, stretched to the
  length of each one) and each particle of a mix with its shape. An engine without
  bit 6 receives a drop as a sphere and a mix as its heaviest
  shape, without S3 fields.

**2. The front glass (point 3, still image).** `CameraOptics.frontGlass`
(`on`, `drops`, `dropSizeMm`, `dust`, `seed`, `distanceMm`) in *Camera ▸
Lens ▸ Filters ▸ Front glass*, and in the engine the new section **`GLAS`**
(48 B, right after `LENS`) and `rt_core::optics::glass`. An ideal sheet
(it neither bends nor darkens anything: with no drops or dust the image is that of no
glass, **bit for bit**, test with the passes) at `distance` from the camera (0,
automatic: 25 mm with the simple lens, 5 mm in front of the front vertex of
a traced one); on top, **drops** as spherical caps of water (contact angle and
index in `src/data/front-glass.ts`) through which camera rays
enter by the base or the dome and leave by the dome with Snell and exact Fresnel
transmittance, or bounce by total internal reflection (up to 8
times; those that leave again by the base go towards the camera and bring
nothing), and **dust**, discs that let `1 − opacity` through. The drops come from
cells of the glass itself (four mean diameters) with hashes of (seed,
cell, index): the requested coverage, the position, the size; only the cells
that the rays can cross (at least 45° of half-field, so that the image of
a viewport, which is wider, has those of the frame). Those that touch **merge** into
one of their summed volume at their centre of mass (`∛(a₁³ + a₂³)` at a fixed
angle), in passes of fixed order. The image's camera rays see it
(after the lens and its filters), the albedo and the alpha of their samples;
the screen position of a ray that a drop bent is recomputed for the
background image. The exact passes, click-to-focus and a panoramic camera do not see it. In the interface: the switch and its five controls, each
an undo entry, a note that only *Full* and the render trace it,
and another if the camera is panoramic; it is saved with the camera (project
and studios) and written only for an engine with bit 6.

**3. Engine, capabilities and pins.** Bit 6 of `FEATURES`, `FEATURE_DROPS`
(64): the drop, the mix and the variation of `FXAM` and the `GLAS`; the page
(`render/engine.ts` `readsDrops`, `SceneView.drops`) writes them only for an
engine that says so, and *Export scene* for `rt` always. Two parity
scenes: `example::s3_drops_scene` (2,500 water drops, clear and smooth, and
3,000 opaque particles in a 1 : 1 : 1 : 2 mix with palette, shadow and
variation) and `example::s3_glass_scene` (the sample at 28 mm f/8 through a
glass with 35 % drops of 2 mm and 3 % dust), with `rt
--write-s3-drops-example` and `--write-s3-glass-example`. **New pins**:
`PINNED_S3_DROPS_4SPP = 0x73ebde26`, `PINNED_S3_DROPS_PARTICLES =
0x401e61d5`, `PINNED_S3_DROPS_SHAPES = 0xec380974`, `PINNED_S3_GLASS_4SPP =
0xf410d5f0`: the same in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, through
an RSB, and in the real `rt.wasm` (`tools/wasm-parity.mjs`, which gains
`--expect-shapes`; the glass scene also with the passes interleaved);
`.github/workflows/engine.yml` reads them from the source and runs
`tests/s3-drops.test.ts` with the real `rt.wasm`. **No earlier pin
moves.**

**Cost** (instructions per sample with *valgrind*, deterministic: 3 spp
minus 1 spp at 160 × 120, one thread). The drops scene with its two effects as
spheres, 337.5 M; as 10 ms streaks, 407.9 M; as drops, 398.5 M (a
drop costs like a short streak: its cone is another quadratic); the
pinned scene (drops, mix and variation), 385.4 M. The sample, 199.4 M; with a
glass with nothing on it, 200.0 M (+0.3 %: the check on every camera ray); with
the wet glass of 35 % and dust, 219.7 M (+10 %). Against the engine from before S3 (that of `ec6deee`), with the same files: the
sample, 198.9 M → 199.4 M (+0.24 %), and S4a's *Ambient* scene, 539.9 M →
548.3 M (+1.6 %: the shape of each slot looked at in every hit test;
the same pixels).

**Tests** (each checked with its mutation: all 21, 14 in the engine and 7 in the
page, make it fail, and they pass without it; three in the engine survived the
first pass and were closed: the mix drawn with the set's shape
fooled the comparison with brute force, which uses the same test, and
the one below against single-shape sets had to be added; the other two were
mutations badly chosen for the test that was run and are caught by the ones
next to them):
- `rt-sim::params`: the 228 B payload and its offsets, the 200 B one without
  S3 fields (and S4b's, shorter, with the defaults), the ranges;
  `shape_for` and `can_be`. Mutations: the S3 fields never written; the
  mix without its weights.
- `rt-sim::eval::tests`: the drop follows its velocity with its length, the
  minimum tip and the resting one according to its normal; the shape changes no positions,
  sizes or tints; the 1 : 2 : 0 : 5 mix gives its parts (± 1.5 % over 40,000)
  and each particle keeps its shape; the variation stretches drops and streaks
  by the same factor. Mutations: the drop pointing forwards; without
  variation.
- `geometry::particles::tests`: 400 drops of varied shapes against a
  march of their exact distance (hit, exit and normal against the
  gradient); a 0.02 mm drop at 2 m, and widened as a scaled copy with
  its coverage, its box and the camera margin. Mutations: without the cone; the
  widened drop unscaled; the margin without the drop's length.
- `geometry::particles::grid_tests` and `geometry::tests`: the screen grid
  and the BVH against brute force with drops and with a mix of the four
  shapes (also rays of every class), and `a_mix_hits_each_particle_as_its_own_shape`:
  each ray hits in the mix the same particle, at the same distance, as in
  four single-shape sets. Mutation: the mix drawn with the
  set's shape.
- `integrator::particle_tests`: the flakes of a mix are thin-walled and their
  drops solid. Mutation: the set's disc, not the particle's.
- `optics::glass::tests`: the payload and its ranges; two drops that touch add
  their volume (± 1e-5), a chain merges entirely and a separate one does not; no
  drop on the glass touches another, the coverage after merging, the same drops
  with another focal length and in a viewport's image; the ray through a drop's centre
  continues straight with its Fresnel and leaves through the top of the cap; a drop carries
  parallel rays to its focus `R / (n − 1)` (± 8 %); the edge of a 90° drop
  brings nothing (15 of 20 rays of the last fifth) and the centre does; opaque
  dust stops and half-opacity dust lets half through. Mutations: the exit without
  Fresnel; total internal reflection taken as an exit; drops that add radii;
  without merging them.
- `render::s3_tests`: the four pins; the rendered particles are the
  evaluated ones; drops and mix equal to brute force; **a glass with nothing on it
  does not change a bit** of the sample's image or of its passes, also through
  an RSB, and a wet one does; a 6 mm drop on a pinhole camera puts
  the scene upside down (the left half of the drop sees the right of the
  wall), and outside it nothing changes. Mutation: the sheet that moves the ray.
- `rt-cli/tests/example.rs`: the two scenes, the same pixels with 1, 4 and 16
  threads and after an RSB; the two `--write-s3-*-example`. `rt-wasm`: the shapes
  through the C API are the simulator's, and bit 6. `rt-app`: `/api/info`
  says 127.
- `tests/s3-drops.test.ts`: the `FXAM` and `GLAS` byte for byte against those of
  `rt` (`tests/fixtures/s3-drops.rsb`, `s3-glass.rsb`); the new effect with its
  default drop and its 200 B; *Water drops*; the mix, its heaviest
  shape and its streak, and what goes to an engine without the bit; the ranges through the
  store and undo; an earlier file and one with a mix; the outline of
  the drop; the glass off, with nothing, at the limits of a file, written
  after the camera with its fixed values, not for an engine without the bit or with
  a panoramic camera, saved and opened; with the real `rt.wasm`, the mix's shapes
  and the pinned particles, the two pinned images and a project
  with glass and drops. Mutations (seven): the bit ignored, the S3 fields
  always, the `GLAS` without the bit and through a panorama, the glass without
  clamping, the weights without clamping, the mix without its streak.
- `tools/s3-check.mjs` (Chromium and SwiftShader): the gallery with *Water
  drops*, the drop and its rows, the drops in *Fast* (the meter and the
  pixels), the mix with its parts and its weights (one entry per change) and
  undo; the glass in *Full* (off with no controls; on, one
  entry; 8 mm drops at 150 mm and f/16, and the image changes; undo); the
  achromatic chrome in both themes. Captures `docs/ui/ambient-drops.png`,
  `docs/ui/ambient-mix.png` and `docs/ui/lens-glass.png`.

**What did not fit the plan.**
- **The phase split.** This part is 1.2 and the front glass as a still image;
  everything that is simulation (drops on the parts, running down, dripping, settled
  dust, the glass fed by the scene's rain, the physics
  bar, the cache and the clip) is S3b. That is why the sheet
  `out/rain-dust-sheet.html` and `docs/ui/physics-rain.png` are missing, and
  so are the criteria for glass at 30°, dust at 60° and the trail that cleans.
- **The glass does not go in `LENS`.** It goes in its own section (`GLAS`): it also works with
  an orthographic camera, does not touch the `LENS` bytes of O1–O4, and an earlier engine
  skips it. A single capability bit (6) for the drop, the mix and
  the glass.
- **The sheet is ideal** (no Fresnel of its own), so that with nothing on it the
  image is the same bit for bit (the criterion); the glass under a drop
  does not count either (0.4 % between glass and water). The light a drop reflects
  is not followed: a little is lost at the faces (a few percent), which is
  what would go towards the lens.
- **Visibility is physics.** A drop on the glass is a strong, heavily
  defocused lens: with a long, open lens (the 85 mm f/5.6 of every new
  project crosses 15 mm of glass per pixel) 2 mm drops only
  veil the image; they show as discs when they are wider than that footprint
  (a stopped-down wide angle, like the parity scene at 28 mm f/8, or the glass
  far away, a window). The capture uses 8 mm drops at 150 mm and f/16. For the
  verdict (◆ 7).
- **The distance** is measured from the camera position (the centre of the
  simple lens, the entrance pupil of the traced one); the automatic one is a
  proposal (◆ 6). The glass covers at least 45° of half-field so that the
  viewport and the render see the same drops.
- **What sees it**: neither the exact passes (their rays go through the centre of the pixel and
  of the lens to the scene, and the AI guard compares them with the image), nor
  click-to-focus, nor the connections of O3a's filters with the lights
  that the glass would change (left out).
- **The shape becomes a list**: five buttons did not fit in the width of the
  inspector (the first capture came out cut off). It stays in *Advanced* (◆ 5).
- **A 228 B `FXAM` only with S3 fields**, like the “only if set”
  fields of `CAMR` and `RNDR`: S4b's payload does not change size and
  `tests/fixtures/ambient.rsb` is the same.
- **`positions_hash` does not see the shapes**: it is S4a's, and including them moved
  `PINNED_AMBIENT_PARTICLES`; `shapes_hash` (and `--expect-shapes`) pins them
  separately.
- **The glass's contact angle** is a fixed value in
  `src/data/front-glass.ts` (60°), not from the per-family wettability table,
  which belongs to S3b.
- **Fast does not draw the glass** (the plan asked for the drops as spheres and the
  coverage as a tint for the simulation, which is S3b); the section says so.
- `rt-app/tests/server.rs` checked `features == 63`; now 127.
- `tools/ambient-check.mjs` expected eight available cards; now nine.
  `docs/ui/ambient-gallery.png` has not been re-recorded (it still has S4a's eleven).

**For the verdict** (rule 11, ◆; decided in *Judgement calls*):
1. ◆ The default drop: length 1.6 body radii and a tip of 0.15
   (`rt_sim::DROP_TAIL`, `DROP_TIP`), and the minimum tip of 0.05 radii outside
   the body.
2. ◆ The orientation: the tip **behind**, against the velocity (the teardrop that
   falls with its tip up). A real raindrop falls nearly spherical or
   flattened; the teardrop is the shape that was asked for.
3. ◆ The mix *Mix* starts with: 1 : 1 : 1 : 2 (points, flakes,
   streaks, drops).
4. ◆ The *Water drops* preset: 8,000 /m³, 3 mm ± 50 %, fall 2.5 m/s ± 30 %,
   shape variation 30 %, wind 0.3 m/s, chaos 5 %, water ior 1.33, no
   shadow.
5. ◆ Whether *Shape* moves out of *Advanced* to the visible controls (the owner asked
   for the drop and the mix explicitly).
6. ◆ The glass: contact angle 60°, size spread ± 60 %, motes
   of 0.3 mm ± 60 % that stop 90 %; on switching on, 30 % of 2 mm drops and
   2 % of dust; the ranges (drops up to 90 %, 0.2 to 10 mm, dust up to 50 %,
   distance up to 200 mm); the automatic distance, 25 mm with the simple lens
   and 5 mm in front of the traced one's front vertex.
7. ◆ How strongly the effect shows: with today's physics, drops the
   size of the aperture veil the image and do not read as drops (above).
   Accept it, or larger drops by default, or a non-physical control that
   focuses them more (marked as such, like those of O2).
8. ◆ The dust as absorbing motes: a backlit mote does not glow (on a real
   lens, the dust on the front element lights up a little when backlit).
9. ◆ The glass in *Fast*: nothing now; with S3b, an approximation (soft
   blotches) or continue without drawing it.

### S3b · Rain and dust that settle, run down and fall on the lens (simulation) — **Opus** (after S3) — done in part (the front glass fed by the scene, ◆5 and ◆9); the rest, S3c

What remains of S3, as its section above asks for it and on top of what the
first part leaves done:

1. **Drops on surfaces** (S3 point 1): the landings of an effect's
   rain (its path is closed-form in `rt-sim`: the
   instant at which it crosses a part is searched along it) in a fixed-step
   `rt-phys::wet`; the **wettability** table per material family
   (`src/data/wettability.ts`: advancing and receding angles of glass,
   plastic, metal, paper and paint) and Furmidge's condition for anchoring or
   sliding (`m g sin α = γ w (cos θ_R − cos θ_A)`; the glass-at-30° test
   with the table's critical radius); merging by volume (the rule of
   `optics::glass::merge_drops`); the **wet trail** as the material's
   wetness mask (less roughness, darker for porous ones: a new section
   or a channel of M3b's program); dripping at edges (they become
   falling particles again) and splashing; snow as a layer that does not run.
   The drops, as sphere caps on the part (the front glass's
   intersection, in the tangent plane).
2. **Settled dust** (point 2): the coverage per part (texels or
   vertices) that accumulates what a dust effect deposits, with the angle of
   repose (the test of the face at 60° against the horizontal) and the rain that
   cleans it where the trail passes; the layer in the shading and the motes where
   coverage is high.
3. **The glass fed by the scene** (point 3, what is missing): the rain
   and dust of the effects fall onto the front glass of this part with
   the same models, the drops run according to the camera's *up*; S3's
   manual controls remain for the still image.
4. **Simulation** (point 4): in S2's physics worker with *Pause /
   Resume*, the cache next to the project (key = hash of parameters +
   geometry + seed + version) and the automatic `PHYSICS` clip; *Fast*
   shows the drops as spheres and the coverage as a tint (and the glass, if
   verdict ◆ 9 asks for it).
5. **Remaining criteria** of S3: glass at 30°, coverage at 60° < 10 %
   of the horizontal, the trail that cleans dust, determinism and a reproducible
   cache, the clip that is born and goes away with *Reset*; the sheet
   `out/rain-dust-sheet.html` (the bottle under rain at 0, 2, 5 and 15 s, dust
   at 0, 30 and 120 s, and the photo with the glass wet and dusty) and
   `docs/ui/physics-rain.png`.

**Done (S3b: the front glass fed by the scene; the parts' side,
S3c, below).** The whole proposal did not fit in one PR without lowering quality.
What enters is the two decisions (S3 ◆5 and ◆9) and, of the simulation, everything that happens
**on the front glass**: it is a plane, so the whole model (landings
by flux, wettability, Furmidge anchoring, running with a trail, merging,
dust with an angle of repose, the trail that cleans) is built and tested
on it, with the worker, the bar, the cache and the clip; S3's numerical criteria
(glass at 30°, face at 60°, the trail that cleans, merging
± 1 %) are met on that model. Taking it to the parts' meshes
(drops on curved surfaces, the material's wetness mask, per-texel
coverage, dripping at edges, splashing, snow) is S3c.

**1. *Shape* out of *Advanced* (S3 ◆5).** In *Ambient*, *Shape* is a
visible control right after *Size*, with the *Mix* weights below it
when there is one; the drop's length and tip and the shape variation remain in
*Advanced*. `tools/s3b-check.mjs --only shape` (the list among the controls,
outside *Advanced*, which stays collapsed; *Mix*, one undo entry, and its
weights there) and the capture `docs/ui/ambient-shape.png`; `ambient-drops.png` and
`ambient-mix.png` are re-recorded (the shape is no longer in *Advanced*).

**2. The glass in *Fast* (S3 ◆9).** `render/glass-overlay.ts` and the
`GLASS` step of `render/lens-filter-pass.ts`: with the **engine's** drops and motes
(`rt_scene_glass_len` / `_copy` over a scene of only the camera and its glass,
`io/rsb.ts` `glassPaneRsb`; for the scene, the recorded frame), three maps over
the glass in its millimetres (the part under drops; under their edge, where a ray along
the axis comes back by total internal reflection, from `1 / (n sin θ)` of the radius:
0.87 at 60°, no ◆, from physics; under dust, by its opacity) blurred
by the footprint of a pixel on the glass, `R = (f / N / 2) |1 − d / s|`; each pixel
takes the blurred image (through the two faces of the water) for the drops and is
darkened by the edge and the dust. The drops are soft discs with a dark edge; the
dust, a tint (or motes, if they are sharper than the footprint). It does not draw the
scene upside down inside each drop. The meter: *Front glass: approximation
of the engine’s N drops and M motes* (without `rt.wasm`, which draws it with the engine).
Capture `docs/ui/lens-glass-fast.png` (8 mm drops at 150 mm, f/16).

**3. The simulation (`rt_phys::wet`, §5.2 novendecies of ARCHITECTURE).**
- **Arrivals.** Per 1/240 s step and effect, a Poisson draw with mean
  `density × max(0, −v·n) × area × dt`: what crosses the outer face of the
  glass. Density = what the effect asks for divided by its volume (the presets'
  photographic densities); `v`, its wind plus its fall, in the glass's axes
  (the camera's). Uniform over the square of the glass that the render's
  rays cross (the engine's). What each effect deposits: `GLASS_FEED`
  (`src/data/front-glass.ts`: *Rain* and *Water drops*, drops; *Dust
  motes*, *Pollen*, *Dust cloud*, *Ash*, dust; snow, bubbles and confetti,
  nothing).
- **Drops.** Caps of their volume `π D³ / 6` at the mean of the advancing and
  receding angles; they merge with `optics::glass::merge_drops` (S3's rule, by
  volume); they stay anchored by **Furmidge**
  (`ρ g V sin α ≤ γ 2a (cos θ_R − cos θ_A)`), slide above that according to the
  camera's *up* at `v = excess / (C μ a)` and leave a **trail** (a
  film that takes water from them, so a running drop ends up stopping) that
  carries the dust away; one that leaves the glass is gone (drips).
- **Dust.** A mote stays with probability 1 below the angle of
  repose minus 5°, 0 above it plus 5°, a soft ramp in between; never on
  a face that looks downwards.
- **Wettability.** `src/data/wettability.ts` (new keys: `GLASS`,
  `PLASTIC`, `METAL`, `PAPER`, `PAINT`): advancing and receding angles; glass,
  70° and 50°, averaging S3's 60° glass. In S3b only the glass uses it.
- **WET1**, the page-to-engine format (`core/wet.ts` `wetBytes`); each
  frame comes back as its record (`WetPane::frame`: the drops, the motes
  that arrived and those that left).
- **Cost**: the 5 s of the parity scene (189 drops at the end), 1,200 steps
  with a frame every 10, in the real `rt.wasm`, 12–16 ms.

**4. In the worker, with cache and clip.** `render/physics-worker.ts` runs
PHY1 and WET1 together (the same steps) or only one; each frame carries the
poses and the glass record. *Start* (not *Drop*) carries the glass of the
active camera when it is on *Drops and dust ▸ From the scene* and some effect feeds it,
also without any *Dynamic* body; with a glass the simulation does not
stop when the bodies fall asleep (it keeps raining): it is stopped by *Stop* or 120 s
(`MAX_GLASS_SECONDS`). *Pause* and *Resume*, S2's. **The cache** is the glass
track of the camera's `PHYSICS` clip (`MotionClip.glass`: each frame's drops
and each mote with the frame it arrived and the one it left, in
base64, and the **key**, the FNV-1a of the WET1 and the format version): it is saved
with the project, the render and *Fast* read the frame the playhead says
(`Pose.glass`), and a simulation with the same key gives the same track, bit for bit
(test with the real `rt.wasm`). The inspector says which effects feed it, what is
at the playhead (*Recorded: 97 frames, 215 drops and 0 motes at the playhead*) and whether the scene no
longer gives the recorded key. The clip is born on starting, is the same undo entry
as the simulation, and *Reset* removes it (undoable). The bar says *Glass:
215 drops · 0 motes*.

**5. Engine, capabilities and pins.** The end of `GLAS` (from byte 48: `u32
1`, drops, motes, `(x y a)`, `(x y r)`; `optics::glass::GlassLayout`,
`FrontGlass::laid_out`: as is, without spreading or merging), **bit 7**,
`FEATURE_GLASS_LAYOUT` (128); the page writes it only for an engine with it
(`SceneView.glassLayout`) and with coverage at 0, so an S3 engine draws
the glass clean. `rt_phys::example::wet_spec` (the S3 scene's glass at
28 mm f/8 under the preset's rain pushed by 3 m/s of wind towards the lens,
and pollen) and `s3b_wet_scene`; `rt --write-s3b-wet-example` and
`--write-s3b-wet-spec` (`tests/fixtures/s3b-wet.rsb`, `s3b-wet.wet1`); `rt-cli`
now depends on `rt-phys`. **New pins**: `PINNED_WET_PANE = 0x5e511523` and
`PINNED_S3B_WET_4SPP = 0x6e6e370c`, the same in scalar, SSE2 and AVX2 (the
second), with 1, 4 and 16 threads (`rt-cli/tests/example.rs`), in scalar and simd128
`wasm32-wasip1` (`cargo test -p rt-phys --test wet`, new in CI) and in the
real `rt.wasm` (`tools/wasm-parity.mjs`, with the passes interleaved;
`tests/s3b-wet.test.ts` in the CI step that runs the tests with the real
`rt.wasm`). **No earlier pin moves.** `rt-app`: `/api/info` says 255.

**Tests** (each checked with its mutation: all 23, 10 in the engine and 13 in the
page, make it fail and pass without it; two survived the first pass
and were closed: the mote log not emptied between frames passed because the
frames test used the parity glass, which cleans no mote
—it now uses a glass at 30° with rain and dust and requires that each mote leave only
once—, and *Reset* while running without the glass clip, which was only
tested after *Stop*):
- `rt-phys/tests/wet.rs`: glass at 30° (the critical radius ± 0.5 % of the
  Furmidge calculation in `f64`; at 0.97 and 0.995 it stays, at 1.005 and 1.05 it slides; flat,
  never), slides faster the steeper it is and loses in the trail the water that
  it should, one that leaves is gone; merging adds the volume (± 1 %) at the centre of mass;
  the trail cleans dust (a clean band, the rest with its dust; and rain
  on a glass at 30° leaves less than 0.9 of the dust compared with no rain); dust at 60°
  < 10 % of the horizontal, at 30° the cosine (± 10 %), looking down nothing; rain
  arrives at its flux (± 4σ) and never at a face that looks the other way; the same
  glass by separate and joined steps and rebuilt from its frames; the two
  pins. Mutations: half hysteresis; without merging; the trail that does not clean;
  without angle of repose; the flux without looking at the face; the trail without losing water;
  the log not emptied.
- `rt-core`: `optics::glass::tests` (the end of `GLAS` goes and comes back, its ranges
  and its counts; a laid-out glass takes its drops and motes as they are and its mote
  stops the ray); `render::s3_tests` (a laid-out glass with nothing on it, also through
  an RSB, changes no bit of the sample). Mutations: the list ignored (it is
  spread); merging it again; the writer without the list. `rt-wasm`: the
  glass registry is the native one; `scene_glass` is what the engine lays out.
  `rt-cli`: the scene with 1, 4 and 16 threads and after an RSB, the two `--write-*`.
- `tests/s3b-wet.test.ts` (18): the table and that glass and repose are the
  engine's; which effects feed it; the glass's axes and a camera looking down
  stays dry; the sources (density, wind and fall in the axes); the WET1 byte for byte
  with the engine's and its key; the track rebuilds each frame and rejects a
  record that does not follow; with the real `rt.wasm`, the pinned glass and two
  runs with the same track; the camera's clip (the pose's frame,
  the camera still, also at 0), saved and opened, a broken one is removed; the
  `GLAS` drop by drop only for bit 7 and with a recording; the bar runs the
  glass alone (one entry; *Reset*, another, undoable; also while
  running); *Drop* and *By hand* do not run it; the footprint, the maps (sharp,
  blurred, the edge, the dust) and the projection; with the real `rt.wasm`, the
  hand-set glass that the engine lays out and the parity image. Mutations (13): the
  WET1 with an extra word; motes that do not leave; the clip that moves the
  camera; without glass at 0; the list for any engine; the by-hand glass
  runs; *Reset* (running and after stopping) without the clip; a project that drops
  the clip; the velocity in world axes; without blur; the footprint without the
  focus; the track that does not grow.
- `tools/s3b-check.mjs` (Chromium and SwiftShader): *Shape* (above); the
  glass in *Fast* (the pixels change, 74,980; the meter; *From the scene*
  unrecorded, dry); rain with 6 m/s wind towards a 35 mm camera at
  f/11: *Start*, paused at 4 s with *Glass: 148 drops*, the recording in the
  inspector, the viewport draws it, *Stop* (one entry), *Reset* removes it and
  *Undo* returns it; the achromatic chrome in both themes. Captures
  `docs/ui/ambient-shape.png`, `lens-glass-fast.png` and `physics-rain.png`.
- The sheet `out/rain-dust-sheet.html` (`tools/rain-dust-sheet.mjs`, with
  `tests/rain-dust-dump.test.ts`): the sample at 28 mm f/8 with rain pushed
  by 6 m/s towards the lens at 0, 2, 5 and 15 s (about 175 drops: it fills in a couple
  of seconds and then as many run as arrive), and the lens looking 60° upwards
  under *Dust motes* (143 motes at 30 s, 522 at 120 s: not visible) and under
  the density of a windless *Dust cloud* (5,866 and 23,113: a mottled veil),
  each photo with the drawing of the glass beside it, and the photos without glass.

**What did not fit the plan.**
- **The phase split again.** S3b is the glass; the parts' side is S3c
  (below). That is why the sheet does not have the bottle under the rain (drops, trails and
  dripping on it) or the dust on the set, and `physics-rain.png` shows
  the rain on the glass.
- **Landings do not follow each particle of the effect**: the plan said to
  search for the instant at which each particle's closed-form path
  crosses the glass. An effect's region is a box around the product
  that the camera is almost never inside, and the particles wrap around in it;
  what reaches the glass is the effect's **flux** (its density times its
  velocity through the face), by Poisson. The glass receives the scene's rain
  wherever the camera is (◆ whether the region should count).
- **Physics leaves a camera looking down dry**: with vertical rain nothing
  crosses the outer face of its glass; wind towards the lens is needed (or
  looking upwards). Dust, likewise, only stays on a glass that looks
  upwards by less than 35°. For the verdict (◆).
- **The cache is the clip's track**, as in S2 (not a separate file “next to the
  project”): it goes inside the project, and the key (`wetKey`) says when the
  scene is no longer the recorded one. It is not simulated again on its own: the inspector says so
  and *Start* redoes it.
- **The clip belongs to the camera** (`target` *Camera*, all shots), with the camera's id
  in its track, and does not move it; `evaluate` leaves it out of the clips
  that move the camera.
- **The trail is not seen in the render**: on the glass it is a thin film (like
  the sheet, ideal) and what it does is take water from the drop and carry the dust away.
  The material's wetness mask (less roughness, darker for porous ones) belongs to the
  parts, S3c.
- **Dripping and splashing**: on the glass, a drop that leaves the square is gone; it
  does not fall again as a particle or splash (S3c). A drop hanging from a
  glass that looks down does not detach (S3c).
- **Snow does not feed the glass** (it would melt into drops or pile up; S3c),
  nor do bubbles (they rise) or confetti (it does not stick) (◆).
- **The dark edge in *Fast*** comes from physics (the total internal reflection of a
  ray along the axis), with no ◆; the scene upside down inside the drop is not
  drawn (*Full* and the render do it).
- **An engine without bit 7** (an earlier desktop launcher) does not receive the
  scene's glass: the render shows it clean. The inspector does not warn of it (the
  page does not know here the capabilities of the render's engine); neither does the
  *Full* meter.
- **`rt-cli` depends on `rt-phys`** to write the parity scene from the
  simulation (`rt-core`'s example cannot: `rt-phys` depends on it).
- **The image pin lives in `rt-phys/tests/wet.rs`**, not in
  `rt-core/src/render`, for the same reason; it goes through `Isa::available()` with `rt-core`'s
  public API.
- `rt-app/tests/server.rs` checked `features == 127`; now 255.

**For the verdict** (rule 11, ◆; decided in *Judgement calls*):
1. ◆ Wettability per family (`src/data/wettability.ts`): glass 70°/50°
   (mean 60°, S3's glass), plastic 90°/65°, metal 80°/50°, paper
   100°/20°, paint 85°/60°; with them the critical radius on vertical glass is
   2.1 mm of footprint (a drop of about 4 mm slides) and 3.0 mm at 30°.
2. ◆ Sliding: the drag `C = 300` (a drop 50 % above its critical
   size on vertical glass goes at about 40 mm/s), the cap of 250 mm/s and the
   trail film of 2 µm (how far a drop runs before stopping).
3. ◆ Dust: the angle of repose of 35° with its ±5° ramp, and that a vertical
   face keeps nothing (on a real glass something sticks).
4. ◆ Which effect feeds the glass and as what (`GLASS_FEED`): snow, bubbles
   and confetti, nothing.
5. ◆ Whether the effect's region should count (now rain reaches the glass
   wherever the camera is) and whether a camera looking down should get anything wet
   without wind (splashes, the photographer's hand).
6. ◆ How strongly it shows: with the presets' photographic densities, the
   *Rain* fills the glass in a couple of seconds and the *Dust motes* are not
   visible in 120 s (the *Dust cloud* is). Accept it, or an intensity knob (non-physical,
   marked as such) for the glass's dust.
7. ◆ How strong *Fast*'s approximation is: soft discs blurred
   by the real footprint; with a new project's 85 mm f/5.6, a veil (like the
   render, S3 ◆7).
8. ◆ `MAX_GLASS_SECONDS = 120`.

### S3c · Drops and dust on the parts (simulation) — **Opus** (after S3b) — done in part (the bit 7 warning; rain, dust and snow on the parts, in the engine and in *Fast*); the rest, S3d

What remains of S3 after S3b, on top of the `rt_phys::wet` model (which already does the
glass):

1. **Drops on surfaces**: the landings of rain on the
   meshes (the effect's flux over each triangle facing the rain, or the
   crossing of each particle with `rt-phys`'s BVH), the drop in the
   tangent plane of its point (the same cap, with the mesh's normal), the
   anchoring and sliding with tangential gravity (the same Furmidge, with the
   **wettability** of the material's family: `src/data/wettability.ts` and a
   table from the material's category to the family, ◆), following the surface
   from triangle to triangle; **dripping** at edges (when the curvature
   turns the normal beyond what the contact angle can hold, the drop
   becomes a falling particle again, with S4a's `rt-sim`) and **splashing**
   (secondary drops); **snow** as a layer that does not run.
2. **The wet trail as the material's mask**: a wetness channel per
   part (texels or vertices) that lowers roughness and darkens porous ones, in the
   engine (a section or a channel of M3b's program) and in *Fast*.
3. **Settled dust**: the coverage per part (texels or vertices) with S3b's
   angle of repose and the rain that cleans it where the trail passes; the
   layer in the shading and the motes where coverage is high.
4. **Cache and clip**: the drops and the coverage per frame in the `PHYSICS`
   clip (or one clip per wet part), with S3b's key.
5. **Remaining criteria** of S3: the sheet with the bottle under rain at 0, 2,
   5 and 15 s (drops, trails, dripping) and the dust on the set at 0, 30 and 120 s;
   `docs/ui/physics-rain-set.png`.

**Done (S3c: the warning and the parts' side; what remains, S3d, below).** What enters is
everything that happens **on parts** that stay still: drops one by one
on the meshes, the trail as the material's mask, dust and snow per
sample, the cache and the clip, in the engine (*Full* and the render) and in
*Fast*, and the sheet and the capture. What does not enter (the drops that fall through the
air when dripping and splashing, the dust motes, moving parts, the
studio floor) is the **S3d** proposal.

**0. The warning (first, with its test).** `core/wet.ts` `glassRendersClean`: with
the front glass on, on *From the scene*, some effect feeding it,
a camera that is not panoramic and an engine that says it lacks bit 7
(`EngineInfo.glassLayout`, which `main.ts` takes from the capabilities of the render's engine:
the native one or the pool), *Camera ▸ Lens ▸ Filters ▸ Front glass*
says *the render will show this glass clean* (`camera.glassOldEngine`, es and
en). An engine not yet known or one with the bit, nothing; *By hand*, nothing (that one is
drawn by an S3 engine). The same for what is new in this phase with bit 8
(`core/wet-parts.ts` `partsRenderDry`, the note under *On the parts*:
*the render will show them dry and clean*). `tools/s3c-check.mjs --only
warning,parts` checks it in the built application with an `rt.wasm` whose
capabilities are patched without the bit (`tools/wasm-features.mjs`, the `rt_features`
constant in place), in English and in Spanish.

**1. The simulation (`rt_phys::wet_parts`, §5.2 vicies of ARCHITECTURE).**
- **The parts** are the meshes of the visible parts that the simulation does not move, in world mm
  where they are at the start, each with the wettability of its
  material's family (◆1) and the set's as a
  **film** (without drops one by one: each sample gets wet at the instant
  drawn from the exponential of its flux; ◆6). Each triangle carries a barycentric
  **grid of samples** (cell of 1 mm at least, growing
  until it fits in 150,000 samples, ◆7; films at a third at most;
  a sliver, by its area; `R` ≤ 255).
- **Arrivals.** Each effect's flux (`density × |v| × max(0, −v̂·n)`) through
  each triangle, **if nothing is in the way** upstream (a ray
  against `v̂` through a BVH of the world's triangles): drops, by Poisson
  over the whole flux and the triangle by its share; dust and snow, as
  per-sample fields. What each effect deposits: `src/data/wet-parts.ts`
  `PARTS_FEED` (◆2).
- **Drops.** S3b's cap in the tangent plane; they **splash** above
  `K = We^½ Re^¼ = 57.7` (Mundo, Sommerfeld and Tropea 1995) throwing up to
  30 % of their water as 2 drops along the surface (◆3); they **merge** (by
  volume, incrementally: only the new or moved ones, 30 times faster than
  all against all); **anchored** by Furmidge with tangential gravity and otherwise
  **slide** from triangle to triangle across shared edges (the welded
  positions; across a fold, along it), with S3b's trail
  that wets the samples, carries away their dust and takes water from them; they **hang** from
  a face that looks down until `ρ g V (ĝ·n) > 2π a γ sin θ̄` and **drip**
  (also across an open edge): the drip falls straight to the first part below
  and settles there (at `√(2 g h)`, and may splash) or leaves (◆4); porous
  material **drinks** them.
- **Dust** `1 − e^(−k t)` since the last cleaning and **snow** as a layer
  that grows with its flux (◆5), where the face is below the angle of
  repose (dust 35°, snow 50°, ±5°) and in the open.
- **WPT1** (`core/wet-parts.ts` `wptBytes`) and, per frame, the record
  (`WetParts::frame`: the new or changed drops **by number**, those that
  left, the samples wetted and cleaned, the drips). The page joins it into the
  **parts track** of a `PHYSICS` clip of the **scene** (the cache,
  with the key `wetPartsKey`), which `partsFrame` rebuilds at any frame.
  `rt.wasm` exports `wpt_*`. In the worker it runs with the bodies and the glass
  (the same steps) or alone, and does not stop by itself (*Stop* or 120 s,
  `MAX_PARTS_SECONDS`).

**2. In the engine (`WETP`, bit 8).** `rt_core::weather`: one `WETP` section per
wet instance with each sample's three bytes (wet, dust, snow) and
its drops (§5.2 vicies). A hit reads them linearly over its small triangle of the
grid; on top of the material (with patterns, program and textures) go the
**dust** (a matte brownish grey, darker when wet), the **water film** (a
transparent layer of roughness 0.03 over everything, and porous material darker: the
albedo to the power `1 + wet × porosity`, Lekner and Dorf 1988) and the
**snow** (white and matte, `1 − e^(−h / 0.5 mm)`) (◆8); the **drops** are
water caps (index 1.333; 16 × 4) in one more mesh, instance and material,
after those in the file, which shadows cross like a thin wall of water
(a drop does not cast a black disc). Where there is nothing, the material is not touched:
the image does not change a bit (test). Bit 8, `FEATURE_WET_PARTS` (256;
`/api/info` says 511); the page sends `WETP` only to an engine with it
(`SceneView.wetParts`), from the *pose* frame (`Pose.parts`).

**3. In *Fast*** (`render/weather-preview.ts`). The wet parts are
drawn with a copy of their unindexed geometry and of their materials with a
patch that reads the frame's samples (two data textures,
`texelFetch`) like the engine and puts the same layers with the same numbers; the
drops, one instanced cap per drop. The meter: *Rain on the parts:
1,443 drops on 7 parts*.

**4. The interface.** *Ambient*: the **On the parts** switch (one
undo entry, saved with the effect, `AmbientEffect.wetParts`) on the
effects that leave something, with its help per class; the physics bar: *Parts:
N drops · M drips*; the scene's clip on the timeline (*The parts
receive the rain, dust and snow of the scene's effects, according to the
simulation*), which *Reset* removes. Strings in es and en.

**5. Pins** (§5.2 vicies). New: `PINNED_WET_PARTS = 0x62450071` (the
parity parts of `rt_phys::example::parts_spec` after 5 s: a glass bottle, a
plastic plate at 45°, a metal shelf at 20° and a paper card as a film, under rain with wind, dust and snow) and
`PINNED_S3C_WET_4SPP = 0x66fa33ab` (`s3c_wet_scene`, with its `WETP`): the same
in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, in scalar and
simd128 `wasm32-wasip1` (`cargo test -p rt-phys --test wet_parts`, new in CI) and in the
real `rt.wasm` (`tools/wasm-parity.mjs`, also with the passes;
`tests/s3c-parts.test.ts` in the CI step of the real `rt.wasm`). `rt
--write-s3c-wet-example` and `--write-s3c-parts-spec`
(`tests/fixtures/s3c-wet.rsb`, `s3c-parts.wpt1`). **No earlier pin
moves.** `rt-app`: `/api/info` says 511.

**Tests** (each checked with its mutation: change it, the test fails, and
it passes without it; those that survived the first pass were closed with a
stricter test):
- `rt-phys/tests/wet_parts.rs` (17): WPT1 goes and comes back and a broken one is rejected;
  the samples cover each triangle, fit in the budget, a sliver
  spends by its area and a film fits in its third; glass at 30° stays
  until Furmidge's critical radius (± 0.5 % of the `f64` calculation) and slides
  above it losing in the trail the 2 µm film it should; a drop
  crosses from face to face and drips across an open edge; merging adds the volume
  (± 1 %); the trail cleans dust and rain leaves less; dust at 60° <
  10 % of the horizontal, at 30° the cosine, looking down nothing, under a roof
  nothing; rain arrives at its flux (± 4σ), never at a face that looks the other
  way nor under a roof; a hanging drop drips on weighing what it should and falls
  on what is below (it splashes from 44 mm, not from 12 mm); a fast drop
  splashes without losing water; a film gets wet at its rate; snow piles up
  where it rests; the same parts by steps and rebuilt from their frames by
  number; the two pins; a `WETP` with nothing does not change a pixel, only
  the values or only the drops change the image, and an update without `MESH`
  three times in a row leaves 5 meshes. Mutations: half hysteresis; without merging;
  the trail that does not clean; without angle of repose; without looking at what is in
  the way; hanging with twice the grip; the drip that does not settle; the water
  lost uncounted; the film's area without π; the snow without its angle; not
  crossing edges; the wet log not emptied; without dripping across the edge; the
  trail without film (survived: the lost film was added); the drip at
  velocity 0 or 10 times (survived: the 12 mm case without
  splashing was added); the ids of departed drops not noted; no limit by area; the
  film with the whole budget. The flux with `|cos|` instead of the face
  is only killed by the pin: almost equivalent, because the back face is covered
  by the part itself.
- `rt-core` (`weather::tests`, 5): the `WETP` goes and comes back and a broken one is
  rejected; a hit blends the samples of its small triangle; nothing on top does not
  touch the material and each layer changes it; a cap is the part of its sphere
  above the surface; a drop is meshed on its part and lets
  light through. Mutations: the
  writer without `WETP`; the layers ignored; the caps that do not let the
  shadow through; the update that does not remove the old caps (survived:
  the update without `MESH` was added); the top small triangle unused.
  `rt-wasm`: the parts registry is the native one. `rt-cli`: the scene with 1, 4
  and 16 threads, the two `--write-*` and the comparison with the fixtures.
- `tests/s3c-warning.test.ts` (4): bit 7 (when it warns and when not: dust
  yes, snow no, off, *By hand*, the effect off, panoramic, unknown
  camera) and bit 8; the strings, the inspector and `main.ts`. Mutations
  (8): for bit 7, an unknown engine warned; without looking at the effects that feed
  it; without looking at *From the scene*; without looking at the panoramic; `main.ts` without
  the bit; the inspector not looking at it when the engine changes; for bit 8, an unknown
  engine warned; without looking at the effects.
- `tests/s3c-parts.test.ts` (17): the table (wood and cloth added; plastic,
  metal, paper and snow, the engine's); a material's family by its
  category or its recipe; what each effect deposits; only an effect with the
  switch falls, and is saved; the visible still parts, where they are, with
  their family, and the sources; the set, film; the WPT1 byte for byte with the engine's; the track rebuilds each frame (drops by number, wet, dust
  since the last cleaning); a group of faces takes its samples in its order;
  the *pose* gives the frame also at 0 and the clip moves nothing; `WETP` per
  instance only for bit 8; saved and opened, a broken track is removed;
  the bar runs the parts alone (one entry; *Reset*, another,
  undoable), *Drop* and the effect without the switch do not; a
  *Dynamic* part does not get wet where it was; with the real `rt.wasm`, the pin of the
  parts, two runs with the same track, its last frame is the time
  of the native engine (± 1 of the dust byte) and the pinned image. Mutations (8):
  the cleanings ignored; the wet frame shifted by one; `WETP` without the
  bit 8; an empty `WETP` written; the parts that move wet
  (survived: the *Dynamic* test was added); the metal recipe as
  paint; a broken track saved; the *pose* without parts.
- `tools/s3c-check.mjs` (Chromium and SwiftShader): the two warnings (above); the
  sample's rain with 3 m/s wind and *On the parts* (one undo
  entry): *Start*, paused at 3 s with *Parts: 1,443 drops · 0
  drips*, *Fast*'s meter with the drops, 334,891 pixels change,
  *Stop* (one entry), *Reset* removes it and *Undo* returns it; the achromatic
  chrome (the switch too) in both themes. Capture
  `docs/ui/physics-rain-set.png`.
- The sheet `out/rain-dust-sheet.html` (`tools/rain-dust-sheet.mjs`, with
  `tests/rain-dust-dump.test.ts`) adds three rows: the sample bottle on
  the *Fragrance* set, at 28 mm f/8, with the particles hidden to the
  camera, under windless *Rain* at 0, 2, 5 and 15 s (691, 618 and 690 drops; 9
  drips at 15 s; 18, 28 and 52 % of samples wet), under
  the density of a windless *Dust cloud* at 0, 30 and 120 s, and under *Snow* at 0,
  10 and 30 s, each photo the `rt` render of the scene with the recorded frame's
  `WETP`s.

**What did not fit the plan.**
- **The phase split again.** The drops that drip and splash do not become
  falling `rt-sim` particles again: the drip falls straight and settles
  in the same step, and the splash throws its drops along the surface. The dust
  motes where coverage is high are not there (only the layer). S3d.
- **Moving parts do not get wet**: a *Dynamic* one would get wet where
  it was at the start, so it is left out. S3d.
- **The studio floor** (the `z = 0` plane, which is not a mesh) does not get wet;
  the set's floor does (it is a part). S3d.
- **Samples per triangle, not texels or vertices**: a barycentric grid
  per triangle, independent of the UVs (many parts have none) and of how fine the mesh is.
  A large triangle of a set (2 triangles of 700 mm in a
  card) stays in a cell of about 10 mm with the page's budget,
  and the edge of a snow or dust shadow on the set is seen in steps
  in the sheet; the bottle, at 1 mm. A grid that follows the shadow, or splitting the
  large triangles, in S3d (◆7).
- **Landings are the flux, not each particle of the effect**, as on the
  glass (S3b): the effect's region does not limit where it rains (◆, like S3b ◆5).
  The *Ambient* particles still go through the parts in the image.
- **The clip belongs to the scene** (`target` *Scene*), one per simulation, not one
  per part; it moves nothing.
- **The drops are a separate instance** in the part and material passes
  (the one after those in the file), not their part's.
- **Snow does not feed the glass** (S3b ◆4, decided: it deposits nothing); on the
  parts it does, as a layer.
- **The meter says *Rain on the parts*** even when there is only dust or
  snow (with 0 drops).
- `rt-app/tests/server.rs` checked `features == 255`; now 511.

**For the verdict** (rule 11, ◆; decided in *Judgement calls*):
1. ◆ Each material's family (`wettabilityFamilyOf`): the categories
   *Metal*, *Plastic*, *Glass* (and an emitter, as glass), *Wood* and *Cloth*
   their own; the others by their recipe (metallic ≥ 0.5 as metal, the rest as
   paint). The new families: wood 85°/40°, drinks 0.01 mm/s, porosity
   0.6; cloth 110°/40°, 0.5 mm/s, 1; paper drinks 0.05 mm/s with porosity 1;
   the others neither drink nor darken.
2. ◆ What each effect deposits on the parts (`PARTS_FEED`): rain and water
   drops, drops; motes, pollen, dust cloud and ash, dust; snow, snow;
   bubbles and confetti, nothing.
3. ◆ The splash: up to 30 % of the water (from nothing at the threshold to all of that
   at double), 2 drops, thrown up to 4 diameters; the impact wets 2 diameters.
4. ◆ The drip: the grip of a hanging drop (`PENDANT_HOLD = 1`), and that the
   drip falls straight and settles at once.
5. ◆ Snow: its angle of repose (50°), the packing (half the layer
   is flakes) and its look (albedo 0.9, roughness 0.85, covers 63 % at 0.5 mm;
   the byte reaches 5.1 mm).
6. ◆ The set's parts as a film (`SET_PIECES_AS_FILM`).
7. ◆ The budget: the 1 mm cell, 150,000 samples (films a
   third), `MAX_PARTS_SECONDS = 120` and 4,096 drops at most.
8. ◆ How dark and how bright the wet look is: the film with roughness 0.03, the
   porous albedo exponent `1 + wet × porosity`; the dust (albedo 0.42,
   0.39, 0.35; roughness 0.9) and its darkening when wet.
9. ◆ That what is sheltered (under a roof, behind the bottle with respect to the
   wind) stays completely dry: it is the physics, with no splashes from the floor or
   bounces.

### S3d · What remains of drops and dust on the parts (simulation) — **Opus** (after S3c) — proposal

What remains of S3c, on top of `rt_phys::wet_parts`:

1. **Drops through the air**: a drip and the drops of a splash become
   falling particles again (with S4a's `rt-sim`, or a closed-form path of
   their own), drawn in *Full*, in the render and in *Fast* while
   they fall, and settling where they land (or leaving); the drip stops settling in the
   same step.
2. **The dust motes** where coverage is high (grains over the layer,
   in the engine and in *Fast*).
3. **Moving parts**: the *Dynamic* ones get wet where they are in each
   frame (the samples in the part's space, its pose of the step) and their
   drops move with them.
4. **The studio floor**: the `z = 0` plane gets wet and dusty (puddles,
   a drip trail), as a part or as a section of its own.
5. **Fine samples where needed**: splitting the set's large triangles
   or a grid that adapts to shadow edges, so that the edge of
   snow and dust on a set is not seen in steps (S3c ◆7).
6. **The passes**: the drops with their part's id in the part and
   material passes.
7. **The meter**: what is really there (drops, dust or snow) instead of
   *Rain on the parts* always.
8. **Criteria**: the sheet with dripping in the air and dust with its motes;
   a capture of a *Dynamic* part that gets wet as it falls.

## M5 · Thread-by-thread weave and real fuzz — **Opus**, verdict **Fable** (after E6 and E9; the fuzz after S8)

Request: fabric type (*plain weave*, twill…) simulated
thread by thread and an editable, real fuzz. Two parts:

**M5a · Weave.** A `WOVEN` material with weave types (`src/data/
weaves.ts`, stable keys): plain, twill 2/1 and 3/1, 5-harness satin,
basket (panama), herringbone, knit (jersey), gabardine; parameters: threads per cm
(warp and weft), thread width, twist, warp and weft colour, fibre
roughness, highlight width, sheen, wear. Per-thread shading
model of Irawan and Marschner, "Specular Reflection from
Woven Cloth", ACM TOG 2012 (public), implemented from the paper: the
weave pattern gives the visible thread segment at each point and the
thread's BRDF (fibres with twist) the reflection; the fabric's bump comes from
the same pattern (no textures). The Fast viewer approximates with a
sheen and the pattern as a procedural normal. It replaces E6's procedural
cloth as the “realistic cloth”; E6's remains as the “simple
cloth” (stable keys, nothing is renamed).

**M5b · Fuzz.** After **S8** (curve primitive, curve BVH and
fibre shading in the engine): **geometric** fuzz generated in the
engine from parameters (like `FXAM`: density per cm², length ±
variation, radius, curl, gravity, seed, only on visible faces) in the
*Fuzz* material of the inspector, with a point preview in the viewport.
Fibre shading: diffuse + two lobes (R and TT) first; Marschner
afterwards.

**Acceptance.** M5a: plain, twill and satin can be told apart at 1 cm distance
in the sheet (spheres with `rt`); the satin's highlight is anisotropic and turns
with the weft (numerical test); energy ≤ 1 (white furnace). M5b: 100 k
fibres ≤ 1.5× the time per sample; determinism; sheet with four
densities.

## U12 · TIFF and RAW (DNG) output — **Sonnet** — done

Request: for images to be output as TIFF and as RAW.
**Fable decision.** RAW = **linear floating-point DNG** (DNG 1.4, TIFF
with `PhotometricInterpretation = LinearRaw`, 32-bit `f32`,
`ColorMatrix1` = XYZ → linear sRGB primaries (the inverse of the sRGB → XYZ D65
matrix), `AsShotNeutral = 1 1 1`, `BaselineExposure 0`,
`UniqueCameraModel = "Repackshot"`): a photo developer opens it
as a *raw* with the full latitude of the render, unclipped. TIFF: uncompressed
(baseline, *little-endian*), 8 and 16-bit RGB/RGBA and 32-bit
floating-point RGB/RGBA (`SampleFormat 3`, linear), with resolution and no
ICC profile (the 8/16-bit one carries implicit sRGB; the floating-point one is
linear, like EXR). The TIFF 6.0 and DNG specifications are public;
nothing copied from any reader.

**What.** Encoders on both sides, like EXR: `rt-core::tiff` and
`rt-core::dng` (`std` only) for the desktop and the CLI (`rt --format
tiff|dng`), and `src/io/image.ts` (`encodeTiff`, `encodeDng`) for the
browser, with a **byte-parity** test between the two. Render
window: format *TIFF* (bits: 8, 16, 32 float; alpha) and *RAW (DNG)*
(no alpha); the results viewer saves and opens them (preview
from the linear data); `formatExtension`, `supportsAlpha`,
`WRITABLE_FORMATS`; es/en strings with a short help text for each format.

**Acceptance.** Tests: a 4×4 image with known values written in
each variant is read back bit for bit with a minimal reader in the test (the
tags, the offsets and the values); TS = Rust in bytes; the DNG
contains the mandatory DNG 1.4 tags and the matrix is the
inverse of sRGB→XYZ (product = identity ± 1e-6); the results
viewer shows the preview of a 32-bit TIFF; captures
`docs/ui/render-format-tiff.png`. `UI.md`, `ARCHITECTURE.md` §5,
CHANGELOG.

**Done.** `rt_core::tiff` and `rt_core::dng` (`std` only, from TIFF 6.0 and
DNG 1.4; the directory builder is shared: a DNG is a TIFF with
more tags) and, in `src/io/image.ts`, `encodeTiff` and `encodeDng`, which
write **the same bytes**: `tests/fixtures/tiff/` holds eight files
(RGB and RGBA at 8, 16 and 32 bits, one with two strips and the DNG) that
`rt-cli/tests/tiff_golden.rs` and `tests/tiff-dng.test.ts` compare with each
encoder, and each side is read back with a minimal reader of its own test
(ordered tags, even offsets, packed values,
strips without gaps, each sample); the files are also opened by
ImageMagick/libtiff and PIL, third-party readers used only to check.
`ColorMatrix1` is the inverse of sRGB → XYZ of the primaries and the D65
white, computed in exact arithmetic and stored with denominator 10⁷
(product with sRGB → XYZ = identity with error < 3·10⁻⁷, the test asks for
1·10⁻⁶). The interface: `OutputFormat` with `TIFF` and `DNG`, `BitDepth` with 32
(TIFF only), `bitDepthsOf`, `needsDisplayCopy` and `needsLinearSums` in
`core/render.ts`; the normaliser removes alpha from DNG and 32 bits from everything
that is not TIFF; the window offers *TIFF* (8, 16, 32 bits float,
alpha) and *RAW (DNG)* (no alpha, fixed “32 bits float”) with a help line
each; the render saves next to the file an 8-bit PNG copy
for the viewer and thumbnails (like EXR) and the desktop history
asks for it for TIFF and DNG too; the launcher stores `image/tiff` and
`image/x-adobe-dng` and writes `.tif`, `.tiff` and `.dng`; `rt` writes
`--format tiff|dng` and `--bits 8|16|32` (or by the extension of `-o`). The AI
(`encodeLinear`) also writes both formats. Tests: 39 in
TypeScript (`tests/tiff-dng.test.ts`, and one more in `ai-results` and in
`render-queue`) and 22 in Rust (`rt-core`, `rt-cli`, `rt-app`), each one
checked by reintroducing the failure it guards against; and in the browser,
`tools/render-format-check.mjs` and `docs/ui/render-format-tiff.png`.

**What did not fit the plan** (rule 12; what is marked ◆ is a
**Fable** judgement call, who decides whether it changes):
- ◆ `WhiteLevel`: the brief said “the floating-point maximum”. A `WhiteLevel`
  equal to the largest `f32` would make a developer, on normalising by it, leave
  the image black; **1** is written (`LONG`, the render's white; black
  stays at 0 and the data are not clipped to it, so the latitude remains
  whole). If Fable wanted something else, it is a constant in each encoder.
- DPI: the brief fixed 72; `encodeTiff` writes the window's (72
  if none are given, and a fixed 72 in `rt`, which has no `--dpi`).
- The PNG copy for the viewer is made also for 8 and 16-bit TIFF
  (Chromium decodes TIFF at no depth), not only for the 32-bit one.
- In the DNG, `bitDepth` stays at 8 as in EXR and JPEG (“the depth that
  is not chosen”); what is shown is a fixed label “32 bits float”.
- “A DOM test like the viewer's”: there is none (vitest runs without DOM
  and the viewer has only been tested in the browser). There is `previewOf` (what the viewer
  decodes, with a test), the memory history and the desktop one
  with TIFF and DNG, and `tools/render-format-check.mjs`, which renders in
  Chromium a 32-bit TIFF and a DNG and checks that the pixels of the viewer's
  canvas are those of the same render's PNG.
- The AI image of a TIFF or DNG job is saved in its format but
  the viewer does not compare it with the render (it cannot decode it), as
  with EXR (`UI.md`, X3c); the copy for the view of the AI image
  is still pending.
- `rt` writes colour only (no alpha), as with PNG.

## U13 · Image aspect ratio in the camera — **Sonnet** — done

Request (2026-10-14): to edit the **aspect ratio** (16:9, 4:3… or a
custom one) **in the camera itself**, besides in the render window.

**Fable decision.** The aspect ratio **belongs to the camera**: each camera carries
its own (`CameraState.aspect: { preset, w, h }`; presets with stable
keys in `src/data/aspects.ts`: `3:2`, `4:3`, `16:9`, `1:1`, `5:4`,
`4:5`, `9:16`, `21:9`, `2:1`, `65:24` panoramic and `CUSTOM` with free
`w:h`), the **viewport frame** follows the active camera, and the render
window **reads and writes the same** aspect ratio (a single source): the
pixel size keeps the width and derives the height from the active camera's
aspect ratio; typing both sides with the lock open leaves a custom
aspect ratio **in the camera**; choosing a size preset with another
aspect ratio changes the camera's (and says so in a line). *New from view*
copies the active one's aspect ratio; the viewport's camera chip
shows the aspect ratio next to the size (`16:9 · 1920 × 1080`). Animation:
the output size remains the render window's (a video has a single
size); the Doctor warns if a shot uses a camera with another aspect ratio.
Old projects: cameras without `aspect` take that of the saved render size.

**What.** Inspector camera section: an **Aspect ratio** row (list +
`w : h` fields with *Custom*), with the same row in the inspector of the
active camera in the *Cameras* tab; undoable `camera/set`; the
viewport frame (`src/render/preview.ts` / `viewport-overlays.ts`) and the
chip; the render window (`core/render.ts` `aspect`/`aspectLock`
become derived from the camera: `aspect` stops being state of its own
except for animation); save/open; es/en strings; `UI.md`,
`SPEC.md` §3.5, CHANGELOG.

**Depends on.** U5, the camera section (list with pencil).

**Acceptance.** Tests (mutation checked): changing the aspect ratio in the
camera changes the render's height and the viewport frame; typing both
sides in the render window leaves `CUSTOM` in the camera with that `w:h`;
a size preset with another aspect ratio changes the camera's; each
camera keeps its own when the active one changes; old project without
`aspect` → that of the saved size; animation: own size and a Doctor
warning when a shot disagrees. Browser check
`tools/aspect-check.mjs` with captures `docs/ui/camera-aspect.png` (the
section with 4:3 and the viewport frame changed) and
`docs/ui/render-size-from-camera.png`.


**Done.** `src/data/aspects.ts` (the ten presets with stable key and
`CUSTOM`, with their es/en label) and `src/core/aspect.ts` (`CameraAspect`,
`normaliseAspect`, `aspectNearPixels`, `aspectText`); `CameraState.aspect`
with `aspectRatio(cam)` in `core/camera.ts`, 16:9 by default (1920 × 1080
as before), `camera/set` reads it and undoes it, and `camera/add` (*New from
view*, duplicate) copies it. **A single source**: the camera. An image's size
is derived from it in `syncOutputSize`, which runs on every store action
(changing the aspect ratio, changing the active camera, deleting the
active one, undo, opening a project, returning from *Animation*): it keeps the
width and computes the height; `render/set` in image mode is `setSettings`, which
with the lock closed lets one side follow the aspect ratio and, with it
open or with both sides at once (a size preset), **writes the
aspect ratio into the camera in the same action** (one undo entry):
the list preset if the size is exactly one (`aspectForSize`),
otherwise `CUSTOM` with those pixels as `w : h`, and a size almost that of a preset
is respected as it is (no 1081 that quietly becomes 1080). Queue jobs
for another camera with another aspect ratio go out with the window's width
and that camera's height (`sizedFor`). Viewport: the frame (the mask,
the image background and the gradient, Full's *rsb*) and Fast's
`placeCamera` use the aspect ratio of the camera being seen (active, or
the one being looked through: `viewedCamera`), each viewport pyramid its own,
and the chip says `16:9 · 1920 × 1080`. Inspector: the **Aspect ratio** row
(`insp-aspect.ts`: list and `w : h` fields, off with a preset) lives in
`cameraFields`, so it appears in the camera section and in each camera's
card with a single added line; the render window says in a discreet line
who governs and what happened (*Camera 1's aspect ratio becomes
4:3*); the camera list puts the aspect ratio after the lens. Projects:
a camera without `aspect` takes that of the saved size (preset within ≤ 0.5 %, otherwise
*Custom* with those pixels) and the saved size **is not touched**. The Doctor
gains the `aspect` check (**Animation aspect ratio**, the 15th,
added after the original 14, with a fix). Tests: `tests/aspect.test.ts`
(33) plus those that already existed and were adjusted, each one checked by
reintroducing the failure it guards against; and in the browser
`tools/aspect-check.mjs`, with `docs/ui/camera-aspect.png` and
`docs/ui/render-size-from-camera.png`.

**What did not fit the plan** (rule 12; what is marked ◆ is a judgement call and is
left noted for whoever decides, rule 11):
- ◆ **The animation's size is the same `width`/`height` pair as the
  image's**: “own size” was read as “does not follow the camera while the
  window is in *Animation*”, and on returning to *Image* the width is kept and the
  height comes from the camera (the height that might have been typed for the video
  is lost). Storing a separate animation size (`animation.width/height`) is
  one more field if wanted.
- ◆ **In *Animation* the viewport frame is still the active camera's**,
  not the video size's (the decision says it follows the active camera);
  if the video has another aspect ratio, the frame does not show it and it is the
  Doctor that warns.
- ◆ **The Doctor's fix** sets the aspect ratio of the output on the shots'
  cameras, not the other way round (the output would change the size of the whole video).
- ◆ **The terms of a custom aspect ratio are the typed pixels** (1000
  × 700 is *Custom* 1000 : 700, not 10 : 7) and, in the viewport and the list, are
  written `1.43:1` when they are not small numbers; a camera's ratio is
  limited to 1 : 512 – 512 : 1 (that of 16 × 8192 and 8192 × 16, the most extreme the
  window admits), which is a cap of our own choosing.
- ◆ **Changing the aspect ratio does not reposition the camera**: the product may end up
  outside the frame of a 9:16 until *Frame* is pressed.
- Restoring a saved **studio** brings the lens and the view but **not** the
  aspect ratio of the camera it lands on (the aspect ratio belongs to the project, not to the
  studio); library studios and those saved before open with
  16:9 if they did not bring one.
- Editing a **queue job** (*Save changes*) leaves its size as it is
  and writes into no camera: the draft belongs to the job.
- `migrateProject` (`parseProject`, the state without geometry) now computes
  the Doctor's results again as `loadProject` already did: with the enlarged
  catalogue, those in the file would have left the two different.
- The tests in `tests/primitive-ops.test.ts`, `tests/rsb.test.ts` and
  `tests/render.test.ts` gave a render size without the camera's aspect ratio
  (a mock more permissive than the program: there size and camera were a
  single thing): they now use `render/set`, and the U1 project goes without `aspect` in
  the cameras, as it really was.
- At the extremes (3 : 700 at 1000 wide) the height stays at the window's limit
  and the pair stops having the aspect ratio, **without losing the width**: the
  aspect ratio that comes next gives the height back (typing the terms of a custom
  aspect ratio one at a time goes through extremes).

## U14 · Live view in the queue — **Opus** — done

Request (item 3.1 of the 2026-10-14/15 report, `TODO.md`: when switching
to the queue, a real-time preview of a selected render); triage in
`TRIAGE.md` 3.1.

**What.** Choosing in the queue the job that **is rendering** shows its image
live, refreshed as it accumulates; a **finished** one still opens the
results viewer; one **waiting** says in a line that it has not started yet
(es/en). The image is the job's own, fitted to the view, with the
samples the engine reports (rule 10): on desktop, the frames of the job
from the launcher's `/api/render`; on the web, the pool's accumulation. An
`onFrame` (or equivalent) in `FrameRequest` with a bounded cadence; without slowing
the render (cost measured with and without the view, under 2 %); with the view
closed or another job chosen, no images are made or copied.

**Acceptance.** Tests that fail without the feature: the queue with a fake render that
delivers images (the running job chosen shows them, the finished one opens the
viewer, the waiting one says it has not started, clearing the selection stops the
images), the cadence with a fake clock and the launcher's side. `npm run qa`,
`npm run engine:test`, `cargo fmt` and `clippy`; captures of the queue with a
running job in the view, in both themes.

**Done.**

- **Where: the results viewer in “in progress” mode**, not a panel of the drawer.
  The drawer is 240 px: the image would stay at about 360 × 200, a thumbnail;
  the results viewer layer has the viewport's size (950 × 530 in the
  1600 × 1000 window). The same click opens the same place for a finished job
  and for one in progress, and when it finishes the in-progress view **becomes
  the result** without anyone doing anything. The drawer does not change shape: the
  chosen row is marked (hover background and an ink bar), and its
  tooltip says *Watch it render*. `ui/panels/live-viewer.ts`, in the
  same layer (`rv-host`) as `results-viewer.ts`: the **Live** chip, the
  name, the engine's data (*1280 × 720 · 15 of 96 samples · 0:14 · Camera
  1*, with *Finish by time* “0:14 of 1:00”), the row's status with its
  progress and its bar, a note and *Close* (`Esc`); the image at the render's
  aspect ratio, as large as fits, over the neutral checkerboard. One waiting
  says *This job has not started yet: its image will appear here as soon as it
  renders* and shows the image as soon as the queue reaches it (also after a
  pause, which returns it to waiting); a stopped or failed one says so; removing it
  from the queue takes the view with it.
- **Interface state**, like `resultView`: `ui.liveView` (`{jobId, box}`,
  the box the viewer measured in screen pixels) and `ui.liveFrame` (the latest
  image); never at the same time as `resultView`. Commands `selectJob` (the click and `⏎`
  of the row), `watchJob` and `closeLive` (`ui/commands.ts`); `openResult` and the
  guided tour close it.
- **The port**: `FrameRequest.frameBox(image?)` and `onFrame(frame)`
  (`ui/ports.ts`; the same in `RenderOptions`, `render/engine.ts`). Types and
  cadence in `core/live-frame.ts`: `LiveFrame`, `FrameCadence` (injected
  clock), `LIVE_FRAME_MS` = 500, `LIVE_MAX_BOX` = 960 × 600, `fitFactor`
  (the smallest integer factor that fits, the same rule as the launcher) and
  `liveBox`. The queue (`liveTap`, `ui/render-queue.ts`) says yes only
  while the view shows **that** job and the tab is visible, at most every
  500 ms (the first at once, also on opening it again or on a size change)
  and never twice the same image (the launcher's pass); an image
  that arrives when the view has already gone is discarded.
- **The image** (`render/live-frame.ts`): the sums reduced by an integer
  factor with a box (each pixel, the mean of its box; in boxes larger than
  2 × 2, from a 2 × 2 grid, so it costs about four reads per pixel
  whatever the render), each pixel divided by the samples of its tile (halfway through a pass
  the pool has tiles with different counts) and converted with the viewer's
  fast curve (`DisplayCurve`) with the render's exposure and curve. **Web**:
  `pathtracer.ts` makes it after the tile that has just arrived when the queue
  asks for it, and keeps it between two (`LivePicture`): it only redoes
  the boxes over the tiles that have changed since the previous one. **Desktop**:
  `native.ts`, after each pass the launcher publishes, requests
  `GET /api/render/<id>?fit=<w>x<h>`; the launcher (`rt-app`: `Frame::fitted`,
  `fit_factor`, `parse_fit`, `FLAG_SCALED` = 512) averages the sums on the
  request's thread and only the image travels (640 × 360 × 16 bytes = 3.7 MB instead of
  14.7 MB for a 1280 × 720); with `data=0` nothing changes and a malformed
  box is 400 `bad-query`. A launcher without `fit=` would send the whole sums and the
  page reduces them. Without a live view only headers travel, as before.
- **Tests** (all fail without the feature: 19 mutations checked one by one,
  at the end of this list): `tests/live-view.test.ts` (17: the cadence and the box with a fake clock,
  the image —mean of boxes, grid, tiles without samples, coverage, the
  stored image equal to a new one and redoing only what changed—, the queue's tap,
  the queue with a fake render that delivers images, the desktop engine against the
  simulated launcher, a launcher without `fit=` and one that
  fails), `tests/pathtracer.test.ts` (1: the pool makes images only when
  asked, with the samples of each tile, and the render is the same bits), and
  in `rt-app` `render.rs` (2: `fit_factor` and `parse_fit`, `Frame::fitted` with
  boxes cut by the edge) and `tests/server.rs` (1: a final requested with
  `fit=16x16` arrives at 16 × 12 with the flag and the means of its boxes).
  `tests/launcher-mock.ts` answers `fit=` like the launcher. The mutations, each
  with some test red: a click on a running or waiting row only opens
  results; the request without the tap; no cadence; the tap for any
  job in the view; the desktop without requesting an image; the pool without making it;
  *Close* that does not close; the watched job that does not become its result; the one
  waiting without its line; the stored image redone entirely; a single weight for
  all tiles; the hidden tab that keeps requesting; the same pass
  requested twice; removing the job without closing its view; the simulated launcher
  without `fit=`; the grid that reads the whole boxes; and in `rt-app`, `fit=`
  ignored, the mean of edge boxes without counting only their pixels and
  `fit_factor` rounding down.
- **Browser check** `tools/queue-live-check.mjs` (web and
  `--desktop`, with the release launcher in `--serve-only`), both
  green: (a) the running row opens the view and images with more samples arrive;
  (b) the waiting row says it has not started, with no image; (c) `Esc` closes
  it and, on desktop, there are no more `fit=` requests (5 with the view
  open, 0 afterwards); (d) the finished row opens the results viewer; (e)
  the job watched to the end becomes its result. Captures
  `docs/ui/queue-live.png` and `docs/ui/queue-live-dark.png`.
- **Cost measured** (`node tools/queue-live-check.mjs [--desktop] --measure`):
  the same job (the sample bottle, viewport in *Fast*, the same
  samples) in pairs, one with the view closed and another with the view open
  on it (which goes first alternates), after a warm-up render; the
  time is the engine's (`data-seconds` of the history) and the CPU that of this
  browser and this launcher. **Web** (3-worker wasm pool, 1280 × 720,
  16 samples, 10 pairs): closed median 11.33 s, open 11.53 s (+1.8 %);
  median of each pair's ratios 0.983 (−1.7 %), between 0.946 and 1.092;
  CPU, 0.990; 13 or 14 images per render (about 1.2 per second, at
  640 × 360). **Desktop** (native launcher on 4 threads, 1280 × 720, 64
  samples, 8 pairs): closed median 14.97 s, open 15.01 s (+0.3 %);
  median of the ratios 1.007 (+0.7 %), between 0.948 and 1.061; CPU, 1.000; 7 or
  8 images per render (one per pass) and as many `fit=` requests. In
  both, the cost is **within the noise** of the machine (±5 % from one pair to
  another: it has 4 cores and other agents share it) and under 2 % in
  both readings. What an image costs, outside the browser
  (`liveImage`, Node, the machine loaded): 18 ms for a whole 1280 × 720 to
  640 × 360, 41 ms for a 1920 × 1080 to 960 × 540; the pool's stored image
  only redoes the boxes of the tiles that have arrived since the previous one.
  The first version (each image whole, with all the reads of each box
  and a 1280 × 800 cap) measured +11 % median in four pairs of 1280 × 720
  at 32 samples (between −2 and +31 %, with the machine heavily loaded): hence the
  960 × 600 cap, the 2 × 2 grid and the stored image.

**What did not fit the plan** (rule 12):

- **The results viewer in “in progress” mode** was chosen and not a panel in the
  queue (the brief left both): the reasons, above.
- **On desktop the image changes once per pass**, not every half
  second: the launcher publishes its sums at the end of each pass (1, 2, 4, 8 and
  then 16 samples), so in a large render the new image arrives every
  few seconds; on the web it arrives tile by tile. An image halfway through a pass
  would ask the launcher for a frame format with per-tile counts: noted.
- **The samples the web reports** are those that all pixels already have
  (`minSamples`): halfway through a pass there are tiles with more; in the first pass they are
  0 while tiles are missing (they look transparent).
- The in-progress view **has no zoom or 100 %**: the image is reduced (at
  most 960 × 600) and zoom would show no more; they arrive with the result.
- The in-progress row's **thumbnail** is still the icon: it was not asked for.
- History items carry `data-samples` and `data-seconds` (the engine's)
  so that the measurement reads them without rounding.
- `tests/launcher-mock.ts` sent sums before the first pass; the
  launcher does not (`Frame::is_empty`): now neither does the simulated one (it was more
  permissive than reality; no test depended on it).
- In `engine/crates/rt-app/README.md` the frame flags table
  lacked those of E5b-1 (64, 128, 256): they are there, with 512.

## U15 · Arrows and sliders on values — **Opus** — done

Request (2026-10-17): up and down arrows on all values, or sliders where
that suits better; the focus controls could use both: a slider with the
value beside it with up and down.

**What.** ▲ ▼ arrows visible on **every** numeric field, put in
`numberField` itself so that all its uses carry them: a click raises or lowers
one step (`Shift` finer, `Ctrl` coarser, like dragging), held down they
repeat after a pause, a whole press is one gesture and one undo entry,
the value stays within its limits and the limit's arrow switches off,
it respects *disabled*, it does not drag the field, it calls `onHold`/`onRelease`
and they are not tab stops (the *spinbutton* continues with the keyboard). That
they fit in the inspector's narrow columns, in the X, Y, Z triplets, in
the timeline and in the Settings rows **without clipping anything or making the rows
grow**, measured in a browser. And a **written rule** for
when a value is better as a slider with its field and arrows beside it
(`UI.md` §4.4), applied in the inspector, the timeline, the render
window and Settings. The camera's *Focus distance* is not touched: phase F1
redoes it as a slider with its field, and it receives the arrows of this
change.

**Acceptance.** Field tests (click with `Shift` and `Ctrl`, hold, one
undo entry per press in the store, limits, disabled,
typing and dragging, `onHold`/`onRelease`) and a browser test of the
layout in the main states, in es and en, at 1600 × 1000 and
1280 × 800, which is checked to fail by breaking the CSS; `npm run qa` green;
captures.

**Done.**

- **The arrows** (`ui/components/controls.ts`, `numberField`): two stacked
  `button`s at the end of the field (`.num-steps`, `.num-up`,
  `.num-down`), with the icon set's `chevronUp`/`chevronDown` at
  12 px (1.5 px stroke), in `ink-2`, `ink-0` with a `soft` background on hover
  and `line` on press; inside the frame and its height, 26 px, without
  growing. The field's right padding (7 px) becomes its column (14 px
  and 4 px of margin). The press goes on `pointerdown` (and `click` without a pointer,
  `detail` 0, for a screen reader or a script: one step): it stops
  propagation (there is no drag), prevents the button from taking focus and gives it
  to the *spinbutton*, captures the pointer on the pair (the press ends where it
  is released, also if the arrow switches off under the finger on reaching the limit)
  and repeats: one step on pressing, another after `STEP_REPEAT_DELAY_MS` = 400 ms and one
  every `STEP_REPEAT_MS` = 50 ms; `Shift` and `Ctrl` pressed in the meantime
  change the following steps. All with the same `newGesture('step')`, so
  the store joins it into one entry; `onHold` on pressing and `onRelease` on
  releasing (the AI preview and the plugins' wait). A field that
  disappears under the press (its panel is redrawn) or becomes disabled ends it.
  Double-clicking an arrow is two steps, not editing; if one was
  typing, the press takes what was typed and steps up from there. They are
  named *Increase* (es *Aumentar*) and *Decrease* (es *Disminuir*)
  (`common.increase`, `common.decrease`), `tabindex` −1.
- **Disabled**: the field also looks at the `is-disabled` class (the one the
  *coming soon* Settings rows set) for dragging, keys,
  editing and the arrows, and gains `setDisabled` (`NumberControl`; also
  in `lengthField` and `slider`), used by the aspect ratio terms
  (`insp-aspect.ts`, which used to touch the props by hand) and the thin-lens
  controls with a traced lens (`insp-lens.ts`: before, their `input`s were switched off
  but the field could still be dragged).
- **Compact variant** (◆ Fable): a field with an inline label (X, Y, Z;
  U, V; H, V) and a slider's field (`slider()` asks for it) carry a pair
  of 10 px with 10 px icons, 5 px of left padding and margins of 3 and
  2 px next to the label and the unit: the value keeps its previous room
  (in a 102 px triplet, 47 px of value, as before; in a
  78 px slider's field, 59 px against 62). It is the default proposal; the
  alternative (arrows only on hover or with focus) moves the
  value or covers the unit when they appear.
- **The time field** of the render window (`timeField`) stops being a
  text `input` and is a `numberField` of seconds that is shown and typed
  as `hh:mm:ss` (new `parse` of the field: with it, editing starts from the
  text that is seen): draggable, with its arrows (one minute; `Shift` 6 s,
  `Ctrl` 10 min), one undo entry per gesture; what is not a time or
  does not exceed 0 is rejected, as before. No maximum in the field (the store
  limits it to a week): a bounded field covers its whole range in 240 px.
  `tools/doctor-engine-check.mjs` types into it with a double click.
- **The rule and what was converted** (`UI.md` §4.4; ◆ Fable confirms the list):
  a value with a bounded natural range (factor 0–1, percentage, angle in a fixed
  range, opacity) is a slider with its field and arrows; a physical or unbounded
  magnitude (mm, sizes, powers, kelvin, counts, times, seeds)
  stays a field with arrows. Converted: **inspector**
  —physics *Friction* (0–2) and *Bounciness* (0–1); bokeh *Rotation*
  (±180°), *Tilt* (±12°) and *Tilt axis* (±180°) of the advanced
  optics; a filter's *Angle* (±180°); the *Smoothing angle* (0–180°); the *Angle* of a circular
  pattern (±360°); the *Rotation* of a texture and a label (±360°); on an own light *Azimuth*
  (±180°), *Elevation* (±89°), *Roll* (±180°), *Spread* (1–180°),
  *Cone angle* (1–179°), *Soft edge* (0–100 %) and *Sun disc*
  (0–5°)—; **render window** —JPEG *Quality* (1–100), *Noise* of
  *Finish by noise* (0.5–5 %) and *Intensity* of noise reduction
  (0–100 %)—; **Settings** —*Orbit speed*, *Zoom speed*
  (25–300 %), *Gizmo size* (50–200 %) and *Default intervention*
  (0–100), in `SLIDER_SETTINGS` of `settings-rows.ts`—. Material parameters
  were already sliders up to 2.5 (`insp-parts.ts`) and those of the node editor
  with a range of 10 or less; the *Ambient* feelings,
  the AI's and the plugins' already were. CSS: `.rw .slider .num`,
  `.rw-stack > .slider` (up to 300 px), `.rw-inline > .slider` (220 px, the
  quality next to the format) and `.sw-slider` (up to 240 px).
- **Tests**: `tests/number-field-browser.test.ts` (10, with the page
  `tests/browser/number-field.html`: the real field, slider and time field
  writing into a real store, with Playwright's fake clock for
  repetition): the pair in each field, on the right, inside, not covering the
  value and not a tab stop; click, `Shift` and `Ctrl`, one entry
  per click; holding (nothing before 400 ms, then one every 50 ms, `Shift`
  during repetition, nothing after release, **one** entry that an undo
  removes whole, releasing outside the button); limits and switched-off arrow (also
  with a press held to the maximum and with the keyboard); disabled
  and `setDisabled`, also halfway through a press; `onHold`/`onRelease`;
  no drag, no editing with double click and with focus in the field; typing,
  dragging and the keys; the slider and the time field; a click without a pointer.
  `tests/number-layout-browser.test.ts` (2, one per language): the states
  below, each at both sizes.
- **Measurements**: in a real Chromium (no GPU), before the arrows no field in the
  sample states clipped anything; with them, the layout test measures
  per language 1,592 fields and 620 sliders in 34 views (seven states at
  both sizes and the ten Settings sections at both sizes), **0
  problems** in es and en (524 s for both). The tightest margin between the value
  and its room is 13 px (*Automatic* in *Threads*, 110 px field), 14 px
  (*-183* in a 102 px coordinate triplet) and 17 px (*fps*, 84 px).
  **That the test catches clipping**: with `.num { height: 16px }` on purpose
  (less than its content), the English one fails with 3,184 problems (*its
  content is taller than it (17 > 14)*, *the step buttons are not a stacked
  pair*…); undone, it goes green again. And eight mutations of the field, each
  with some `number-field-browser` test red: one gesture per repetition
  (one undo entry per step), no repetition, the arrows not switching
  off at the limit, no `onRelease`, dragging from the arrows, focus
  on the arrow, the arrows on a disabled field and no `Shift`.
- **Browser check** `tools/number-fields-check.mjs`: (a) the
  arrows on all fields of the initial screen; (b) a click on *Focal length*'s ▲
  is one step and one entry, and holding ▼ for a second is many steps
  and another entry that an undo removes whole; (c) the angles of an own light
  are sliders and *Distance* and *Power* fields; (d) the *Preferences* speeds
  are sliders and *Interface size* a field. Captures `docs/ui/u15-light-fields.png`,
  `u15-part-triplets.png` and `u15-settings-sliders.png`.

**What did not fit the plan** (rule 12):

- The tests “in the DOM environment of the component tests”: vitest runs in
  Node without a DOM and no test used `numberField`; components with DOM are
  tested in Chromium through Vite (`tests/browser/*.html`), so
  the field's are a page of those, with a fake clock.
- `SPEC.md` does not describe the numeric field: it does not change.
- Not converted, by the rule of not squeezing rows: the azimuth,
  elevation, part and size of a studio's lights (a two-column grid
  with inline label, `insp-scene.ts`) and the curve handles; nor
  *Interface size* or *Text size* (percentages, but they
  rescale the window under the thumb while dragging) nor the *Ambient* wind
  direction (it wraps around, no range). The import sheet
  (the tessellation angle) was not among the brief's areas.
- A long value in a narrow field was already cut off before (`overflow:
  hidden` on the value; in a triplet, beyond about 6 characters); the compact
  variant leaves the same room, no more. The layout test measures
  the values of the states it opens.
- The ◆ items (the compact variant, the list of what was converted and the
  repetition rhythm) are in *Judgement calls*.

## N6 · Configurable exploded view and clear timeline — **Opus**, decision **Fable** — done

Request (2026-10-14): animation lacked **explosions
(exploded views)** of a model, configurable in speed and smoothness, with
**exception** parts that do not move, and of several types (vertical,
horizontal, radial, spherical…; “research types”); and **improve the
animation interface**: more comfortable, intuitive, similar to existing
systems, and making it clear **what** is animated and **how**.

**Exploded-view types (research).** CAD tools with an exploded view
agree on three basic geometries and two ordering modes
(public documentation of Onshape —*Linear / Radial / Spherical*—,
Fusion 360 —*auto explode: one level / all levels*—, SolidWorks
Composer and Inventor —levels and directions—; black-box observation,
no code):
1. **Linear** (`LINEAR`): along an axis (vertical = Z;
   horizontal = X or Y; or own direction). Two flavours: *separate* (each
   part moves away from the central plane on its side) and *stack* (all in the
   same direction, spread in their order along the axis: the
   classic exploded view of a container with cap, thread and body).
2. **Radial** (`RADIAL`, cylindrical): moving away from an **axis** (the parts
   move perpendicular to it). What is today called RADIAL becomes
   spherical; the key `RADIAL` is kept with its new meaning
   only if no saved project uses it (check); otherwise, a new key
   `CYLINDRICAL` and `RADIAL` stays as a synonym for the spherical one.
3. **Spherical** (`SPHERICAL`): moving away from a **point** (the centre).
4. **By hierarchy** (`LEVELS`): first the groups as blocks and then
   the parts inside each group (*one level* / *all levels*),
   combinable with any of the three geometries.
Parameters: distance (× model size or mm; *proportional to the
part's size* yes/no), **centre** (model centre, chosen part,
pivot, own point), axis or direction, **order** (all at once / staggered
by distance from the centre / by hierarchy depth, with overlap %),
**speed** (duration) and **smoothness** (curve: linear → soft → very
soft, a single control that chooses and weights the curve of `EASING_KINDS`),
**exceptions** (fixed parts: a list filled from the selection or
with *Pin in the exploded view* in the context menu), keep the
orientation, reverse (assembly), and the target can be the model or a
group. The existing `AXIS_X/Y/Z` keys remain valid (= linear
separate on that axis).

**The animation interface** (decision): the drawer becomes a three-zone
timeline, like KeyShot's animation space and the strips of Blender/After Effects,
copying nothing:
- **Left, the tree of what is animated** (*what*): one row per target
  (camera track, model, groups, parts, lights, environment, set,
  physics) with their animations nested (icon + plain phrase: “orbits
  90° · 4 s · soft”); selecting a row selects the animation and
  **highlights its target in the viewport**; selecting a part in the
  scene highlights its rows; a contextual **+ Animate…** button (“Animate
  Cap…”) that opens the wizard with the target set; context menu:
  duplicate, delete, reverse, split at the playhead, pin in the exploded view.
- **Centre, the timeline** (*when*): ruler in seconds and
  frames, draggable playhead, bars with their phrase, dragging to
  move and stretching at the ends, **magnet** to the edges of other bars,
  to the playhead and to the seconds, multiple selection, tracks grouped by
  target and collapsible, the camera track with its spans.
- **Right, the properties** of the chosen animation (*how*):
  header “Cap · Spherical exploded view · 1.5 × size · 0–3 s”, the controls
  of the type, the curve with preview, start/duration/end, repeat,
  reverse.
- **Viewport**: with an animation chosen, its path is drawn (arc of the
  orbit, arrow of the displacement, exploded-view vectors, rotation) and the target
  highlighted; the playhead moves the preview.
- Keyboard: space plays/pauses, Home/End, ←/→ one frame,
  Shift+←/→ ten, Del deletes, Ctrl+D duplicates. Presets stay in their
  list. Any clip type is drawn the same (also the `PHYSICS`
  that S2 adds: “physical simulation · 0–4 s”): the tree and the bars
  do not know the types, they read the phrase and the target.

**Depends on.** N1, U3. S2 adds `PHYSICS` in parallel: keep
`MotionClip` and `evaluate` as the API and draw generically.

**Acceptance.** Tests (mutation checked): each geometry moves the
parts where it says (linear separate/stack, radial perpendicular to the
axis, spherical from the point, levels by stages); exceptions do not
move; the staggered order respects the overlap; linear vs very
soft smoothness change the curve; reversing assembles; old projects with
`EXPLODE` and `AXIS_*`/`RADIAL` are read the same as before (snapshot);
tree ↔ selection ↔ viewport synchronised; dragging and stretching bars with
magnet (tests of the magnet's arithmetic). Browser check
`tools/animation-check.mjs` with captures `docs/ui/animation-timeline.png`
(tree + bars + properties with an exploded view chosen and its path in the
viewport) and `docs/ui/explode-types.png` (strip of 4 frames per type with
the sample container). Sheet `out/explode-sheet.html` for the visual
verdict. `SPEC.md` §3.7, `UI.md` §2.5, CHANGELOG; es/en strings; achromatic
chrome; everything through the store and undoable.

**Done.** The exploded view lives in `src/core/explode.ts` and is evaluated inside
`evaluate` (pure and deterministic; `MotionClip` and `evaluate` remain
the API): `explodeMovers` computes what moves as a unit
(a part, or a block in the levels), its final displacement and its time
window within the bar, and `evaluate` applies in each window
the clip's curve. Geometries `LINEAR` (*separate* and *stack* in Z, X, Y or
an own direction), `CYLINDRICAL` (the radial) and `SPHERICAL`; hierarchy
`NONE` / `ONE` / `ALL` (by stages chained with the overlap, and within
a group the parts move away from the group's centre in proportion to their
size); distance in × size or mm, even or by-distance distribution,
proportional to size, centre (assembly, part, pivot, point), order (all at once,
by distance with the farthest first, by depth) with
overlap, exceptions (`pinned`, which stores parts; pinning a group pins
its own), keep the orientation (off, each part tilts up to
20° about its own centre), model or group target. Generic optional
`MotionClip` fields: `reverse` (before starting it holds its
final state; `poseActive` makes the viewport and the engine show that state from
frame 0), `repeat` (the bar lasts `duration × repeat`, `clipEnd`),
`smoothness` (one control over *linear → soft → very soft*, blending them, that
writes the nearest one into `easing`) and `explode`. New store actions,
all undoable: `removeClips`, `duplicateClips`,
`setClipTimes` (absolute values: a drag with its gesture is one entry),
`splitClip` (the two halves follow one another in the types that add or
multiply), `reverseClips`, `setExplode`, `pinExplode`. The keys
`LINEAR` and `SPHERICAL` are **added** to `EXPLODE_MODES`.

**Decision on `RADIAL`.** No saved project or preset uses
`RADIAL`: `MotionClip` had no mode field at all (the `EXPLODE_MODES`
catalogue existed, but nothing wrote it, and the evaluator always did “outwards from
the centre”). Even so, `RADIAL` is a catalogue key with a written meaning
(“each part goes outwards from the centre” = spherical), and rule 7 does not allow changing its
meaning; besides, the catalogue already had `CYLINDRICAL` with the exact meaning of the new radial
(“they go out in a fan without going up or down”). So **`RADIAL` stays as a
synonym for the spherical one and the radial is `CYLINDRICAL`** (in the interface,
*Radial*). `AXIS_X/Y/Z` = linear *separate* on that axis; `CUSTOM` (a
direction per part) is not built and is read as the spherical one, which is what it
did before. An exploded view without parameters —all the earlier ones— is the one from
then: spherical, **each part the same distance** (`EVEN`), from the
centre, all at once; `tests/fixtures/explode-legacy.json` was taken with the
earlier code (six cases: the two presets, different curves, `RADIAL`,
the model and the closure moved and rotated, and with a turntable at
the same time) and is read the same to 1e-9 mm.

**The timeline** replaces U1's drawer (`src/ui/panels/animation.ts`
keeps its name; `anim-tree.ts`, `anim-timeline.ts`, `anim-props.ts`, and the
commands in `src/ui/anim-commands.ts`): three zones in a grid, the tree
fixed on the left and the ruler on top while the tracks scroll;
the camera track with its spans (draggable edge, the shot's camera and
remove in its menu, **+** to add); bars with their phrase, dragging of
all those chosen, stretching at both ends, magnet to edges, playhead,
shot cuts and seconds (within 6 px; otherwise, to frames; `Shift`
free) with a line that says where it snaps; multiple selection with
`Ctrl/⌘` and `Shift`; collapsible targets; properties with a one-line
header, the controls of the type and of the exploded view, exceptions, time (start,
duration, end, repeat, reverse), curve or smoothness with its preview;
the usual wizard, now with the target set; presets in their
list and in the header; loop and zoom. The arithmetic (rows, ruler, spans,
magnet) is in `src/core/timeline.ts`; the tree and the bars only read
the phrase and the target (a `PHYSICS` is drawn with a dot as icon and its
phrase or the name of its type). **Viewport**: `src/core/motion-hint.ts` gives
the target's outline (that of the part under the pointer) and the path in
model space —ring with an orbit's angle and a dot where
the camera is, arc of an elevation, arrow of a displacement, a
vector and a dot per part of an exploded view, axis and rotation of a *spin about
itself*—, and the preview (`setMotionHint`) draws it in the theme's ink
on top of everything, also in *Full* and while playing. A part's context
menu gains *Animate Cap…* and *Pin in the exploded view* /
*Free from the exploded view*. es/en strings; achromatic chrome.

Tests: `tests/explode.test.ts` (27: the snapshot, each geometry where
it says, units and proportionality, levels by stages, the
group as target, exceptions, order with overlap, smoothness,
reverse, repeat, orientation, splitting) and
`tests/animation-timeline.test.ts` (18: the magnet, the ruler, rows, the
header, tree ↔ selection ↔ viewport in the stores, commands and
keys, the path in the viewport), each checked by reintroducing the
failure it guards against; in the browser, `tools/animation-check.mjs` (the three
zones, the wizard, the outline and the path, rows marked from the
scene, dragging and stretching with magnet and undo, the keys, the menus,
each type moving the parts) with `docs/ui/animation-timeline.png` and
`docs/ui/explode-types.png`, and the sheet `out/explode-sheet.html` for the
visual verdict (◆ Fable: which default values and what look).

**What did not fit the plan** (rule 12; what is marked ◆ is a
**Fable** judgement call, who decides whether it changes):
- N1 was not built (its heading does not say *done*): the drawer being
  replaced is U1's (shots, cards and blocks). N6 brings from N1
  what its interface needed (reverse, repeat, header, curve with
  preview, camera track with spans); still pending from N1 are the *custom*
  curve with handles, `FADE`, `PAN`, `MATERIAL_COLOR`, camera
  changes with fade and animations under their target in the
  scene tree.
- ◆ Default values of a new exploded view: spherical, parts, **distribution
  by distance**, centre of the assembly, all at once, smoothness 50 %. *By
  distance* (the farthest travels the distance, the others in
  proportion) separates parts that are on the same side, like the neck and the
  cap; *even* (what it was before) moves them together. The sheet shows both.
- ◆ In the sample container the radial about Z only moves the label: the
  other parts are on the axis (which is what the geometry asks for); the sheet
  also shows the radial about X.
- ◆ *Keep the orientation* off tilts each part up to 20° as it moves
  away; the brief did not say how. It is the constant `EXPLODE_TILT_DEG`.
- By levels, the brief separated *all levels* and the order *by depth*; here
  *all levels* already goes by stages (the blocks and then
  their interior, chained with the overlap) and the order acts within
  each stage; *by depth* is mostly useful with *parts*.
- Two behaviour fixes that change projects with a set (L6) or with
  an exploded view on a node, never the snapshot's example: before, the exploded view
  also moved the set's backdrop and floor and took its centre
  from the whole scene; now a set's parts are never exploded. And
  an exploded view with target *a part or a group* moved the whole model
  (the target was ignored); now it moves what is under the group.
- Splitting at the playhead: only in types that add (rotations, distances,
  all-at-once exploded view) or multiply (scale, zoom in), played
  once and forwards; each half keeps the curve, so the
  position continues but the velocity is not that of the whole bar.
- The viewport's paths are drawn where the target is at rest: if the
  model also rotates, the exploded view's vectors do not rotate with it.
- No box selection in the tracks or double click to rename (bars
  have no name of their own yet: their phrase is it).
- The drawer grows to 300 px tall for the three zones.
- *+ Animate…* with the model chosen in a scene with a set: the set's backdrop and
  floor are scene roots, so the model is not “the whole
  model” (`SUBJECT`, which acts on all the roots) but a node, and the
  wizard sets it as *A part or group* (before *A part*: the label
  changes text, not key). Outside this phase and untouched: a rotation
  on `SUBJECT` (the presets' turntable) also rotates a set's backdrop and
  floor, because it rotates all the roots; noted for L6.
- In the strips, the base that goes below the floor appears darkened by
  the studio's shadow floor (it is behind it from the camera).

**Fable's verdict (2026-10-14).** Accepted with the choices marked ◆:
separation by distance by default, the radial about Z moves only what
is off the axis (the sheet shows the radial about X), the 20°
tilt with free orientation, the label's order in the Z stack, and the
decision on the keys `RADIAL` (spherical, as it was) / `CYLINDRICAL` (the new
radial), which applies rule 7 correctly.

## P6 · Plugins, and the film plugin (aintfilm) — **Opus**, decision **Fable** — done

Request (2026-10-14): a **Plugins** section in *Settings* with a
tool to add plugins to the view, and as the first downloadable
plugin the **film simulation engine of aintfilm** (the photo
editing and film simulation app from the same developer, in
development): its wasm engine, its settings and its recipes, in the
render window in a *Plugins* section after the AI one, with preview,
recipes and a grain simulator; the module **encrypted**, with the plugin's
logo, a link to the project (notice: app in development, this is a
preview) and the **closed licence** stated clearly.

**Decisions.**
1. **`.rpk` package** (*Repackshot plugin*): `RPK1` + a clear JSON header
   (`id`, `version`, `abi`, `bytes`, `sha256` of the ciphertext, `nonce`)
   + **AES-256-GCM** (WebCrypto) of a flat container (name/bytes
   entries: `manifest.json`, `plugin.js`, `module.wasm`, `presets/`,
   `logo.svg`, `LICENCE.txt`, `NOTICES.txt`). The **activation key**
   (32 bytes, base64) **is not in the repository** (the host is source-available:
   it cannot keep secrets): it arrives through the registry's `keyUrl` (a URL of the developer's, who can rotate it or make it conditional
   later) or is typed by the user on installing. The package is stored
   **encrypted** (IndexedDB, also in WebView2) and the key apart; it is
   decrypted **only in memory** on loading, never written in clear. What
   this protects: the module at rest and in transit, and that the package
   is of no use outside Repackshot without the key; what it does not: whoever debugs the
   browser with the key in hand. Stated that way in `ARCHITECTURE.md`.
2. **Host** (`src/plugins/`): registry (`src/data/plugins.json`: id,
   name, publisher, version, es/en summary, `closed` licence, `homepage`,
   package `url`, `sha256`, `bytes`, `keyUrl`), store (IndexedDB),
   loader (decrypts in memory → `plugin.js` as an ES module from a
   Blob URL in a **Worker** without DOM, with the `module.wasm` transferred;
   an empty `WebAssembly.Module.imports()` required for a module that
   declares it), ABI v1 by messages: `info`, `presets`, `render({w, h,
   linear f32 pixels by planes or RGBA8, settings}) → RGBA8 + info`,
   `cancel`. The manifest declares where it plugs in (`slots: ['render.plugins']`)
   and **its controls** (`controls`: key, es/en label, type
   slider/list/switch, min/max/step/default, group): the section's interface
   is **generic** and is drawn from the manifest; `plugin.js`
   translates controls and recipe into the engine's settings. A plugin never touches the
   DOM or the store: the host gives it pixels and receives pixels.
3. **Settings ▸ Plugins** (*system* group, before *Storage*):
   the registry's list with logo, name, publisher, version, size,
   summary, **“Closed licence”** and link; *Install* (download →
   check `sha256` → key by `keyUrl` or requested → store), *Update*,
   *Remove*, **Install from a file…** (`.rpk` + key): the tool
   stays in view for future plugins. Each installed plugin shows its
   full licence in an expandable block and the sentence: “This plugin's code is
   closed; Repackshot's licence does not cover it”.
4. **Render window ▸ Plugins**, after *AI*: a block per plugin
   with `render.plugins` slot. For the film one: logo, name,
   “Preview of a photo editing and film simulation app from the
   same developer, in development” with the link, closed licence;
   **preview** (the current result at preview size through the engine,
   in the worker, with a delay); **recipes** (the plugin's list by its
   categories and with **its public names**: aintfilm shows no manufacturer
   or film brands (its rule D112) and neither does this); the manifest's
   **controls** (exposure and push/pull, negative format,
   grain: amount and size, halation, diffusion, print/scan, seed,
   whatever the plugin declares); **Apply** → a new result in the results
   viewer, like the AI, with `provenance: { plugin, version, recipe,
   controls }`. The plugin's settings live in the render's
   (`plugins: Record<id, …>`), undoable and saved with the project.
5. **The film package** is built with `tools/plugins/build-film.mjs
   --aintfilm <checkout path>`: it takes `public/engine/itsnotfilm-engine.wasm`
   (reproducible build with no imports), the recipes
   (`src/engine/presets/`), the logo (`assets/exported/marks/LOGO.svg`) and
   the licence of that repository; the plugin's `plugin.js` (the C ABI
   glue: `inf_alloc`, `inf_render_linear_rgba`… with the rule of
   not retaining views between calls) is written **new** in
   `tools/plugins/film/` (it is ours; no code is copied from the other
   repository into ours: the closed part goes only inside the encrypted package).
   `tools/plugin-pack.mjs <folder> <out.rpk> [--key b64 | --new-key]`
   packs and encrypts. Brand check on the package and the
   host's strings with aintfilm's list of hashes
   (`scripts/check-brands.mjs` from that repository, run from there).
6. **Publication.** The `.rpk` as an *asset* of the Repackshot release
   (v0.1.6) and the registry pointing to it with its `sha256`; the developer
   keeps the key (the agent leaves it in the scratchpad for the
   lead, never in the repository) and `keyUrl` stays empty until
   it is hosted: meanwhile, it is asked for on installing.

Three more from the owner (2026-10-14, with the phase already built):

7. **The logo is the current one**, not `assets/exported/marks/LOGO.svg` (that is
   the old one and is not used anywhere): the 35 mm cartridge as a
   16×16 two-ink dot grid from `src/data/marks.ts` (`LOGO`, with
   the three tab columns closest to the cartridge in the dim
   ink, rule M32-02/D50), the one drawn by `src/components/DotGrid.tsx` and
   rasterised by `scripts/build-icons.mjs` into `design/icon/itsnotfilm-1024.png`
   and into the test sheet `design/icon/aintfilm-mark.png` (the reference for
   how it has to look, with the wordmark). `tools/plugins/build-film.mjs`
   builds the package's `logo.svg` from the rows of `LOGO`: one `rect`
   per dot, the two inks as two greys, square cells (it is vector:
   no need to worry about antialiasing), with exactly the same dim-ink
   rule as `DotGrid`. Afterwards (2026-10-14) the owner supplied **their logo
   as an image** (2000×2000, white dots on black: the cartridge seen
   from the front —axis at top and bottom, shoulders, body, the label band as a
   gap— and the tab coming out to the right, with its three columns closest
   to the cartridge in three greys from dark to light and then white):
   the `logo.svg` has to reproduce that dot pattern exactly, and this is
   checked by rasterising it at 2000×2000 on black with the local Chromium and
   comparing it with the image dot by dot. If `marks.ts` and the image do not
   match, the image wins: it is what the owner calls the logo. The logo goes
   on a black or dark tile on the plugin's card, so that the white
   dots read in both themes.
8. **The recipes are a horizontal carousel**, like the film strip of
   the mobile app: one card per recipe (the thumbnail on top, the public
   name below, the category as a small label), which scrolls
   sideways with the wheel or the trackpad and with the arrows, with the chosen card
   outlined, snapping to cards and fades at both ends
   when there are more; achromatic chrome, colour only inside the
   thumbnails. Each card's thumbnail is the recipe applied to **a
   single test scene**: a new `rt-cli` scene, `film-thumb`, in
   `engine/crates/rt-cli/src/scenes.rs` next to `e5-lamp` and
   `e5-glass-bottle` (the perfume bottle from `glass_bottle` next to the
   desk lamp from `lamp`, in the dark room, lamp lit,
   16:10, 320×200), rendered once with `rt` at 512 samples with
   denoise and put into the package as `thumb-base.png` (16-bit linear or
   8-bit sRGB, whichever the plugin's input prefers). On loading the plugin,
   the host asks the worker for each recipe's thumbnail from that
   base (stored in IndexedDB by plugin version and recipe id: it is
   done once) and shows a placeholder until each one arrives. That same base
   is what the preview shows when there is no result yet. If
   each thumbnail is slow for ~70 recipes, at half resolution (160×100)
   and enlarged by CSS; the time per thumbnail is reported.
9. **Animation**: when the plugin is applied to an animation job,
   each frame goes through the engine with its own seed, `seed = seed0 +
   frame index` (the engine's `seed` field), so that the grain is
   that of a real film frame by frame and not a fixed layer;
   the still image uses `seed0`; the preview shows frame 0;
   `provenance` stores `seed0` and the rule. A per-frame test with the test
   plugin (frame 0 and frame 1 differ where the test one uses the
   seed; the same `seed0` twice gives the same bytes).

**Depends on.** U5 (render window, viewer), X2 (derived result),
U6 (settings window).

**Acceptance.** Tests (mutation checked): packing → decrypting returns
the same files; a wrong key and a tampered package fail cleanly
(GCM tag); the registry's `sha256` checked; a test plugin from
the fixtures (no wasm: it inverts the pixels) goes through the worker end to
end and leaves a result with `provenance`; the manifest draws
its controls; the plugin's settings are undoable and are saved.
Browser check `tools/plugins-check.mjs` (installs the test plugin
from a local server with a typed key; opens the render window's *Plugins*;
applies) with captures `docs/ui/settings-plugins.png` and
`docs/ui/render-plugins-film.png` (the latter with the real film package
built from the checkout). `UI.md`, `ARCHITECTURE.md` (§1: plugins
are not dependencies: the user installs them, under their own licence;
new §: the `.rpk` format, the ABI and what the encryption protects), `SPEC.md`
§3.8, CHANGELOG, `release-notes` (how to publish the `.rpk`).

**Done** (2026-10-14). **The package** (`src/plugins/rpk.ts`, the same code in
the page and in the tools thanks to Node's type stripping): `RPK1`, the
clear header of decision 1 and AES-256-GCM of a flat container; the
encryption also authenticates the header (except its `sha256`), so an edited header
does not open; the `sha256` and the length are checked before decrypting.
`tools/plugin-pack.mjs` (`--new-key`, which only prints it, `--key`, `--key-file`)
and `tools/plugin-unpack.mjs`. **The host** (`src/plugins/`, a new layer of
`tests/boundaries.test.ts`: `plugins → core, data`): the registry
`src/data/plugins.json` with its loader; the IndexedDB store (encrypted package
and key apart in one transaction; in memory without it); installation from the
registry (registry size and `sha256`, header with its `id` and `version`,
the key that an update already has, the one from `keyUrl` or the typed one) and from a
file; startup (decryption in memory, `WebAssembly.compile` and the
`noImports` rule, `plugin.js` in a Blob URL as a module Worker, `init` with the
module and the files transferred) and ABI v1 (`info`, `presets`, `render`,
`cancel`, plus `ready`, `cancelled` and `error`); the service that passes a result
through a plugin (an EXR as linear planes of its light, otherwise RGBA8; the preview
at 480 px; the source's alpha put back). **Settings ▸ Plugins** (*System* group,
before *Storage*) and **Render window ▸ Plugins**
(after *AI*), both drawn from data: the registry and the
manifest; the settings in `RenderSettings.plugins` (undoable, a drag
one entry, with the project; an earlier project has `{}`); *Apply* leaves
a new result with `provenance: { plugin, version, recipe, controls, from,
label }`, saved where its source is and opened in the viewer compared with it, which
says where it comes from. **The film plugin**: `tools/plugins/film/manifest.json`
(the controls from §9 of aintfilm's manual: negative format, exposure and
push/pull, colour and its model, contrast, saturation, warmth, print
exposure, print or scan, grain —amount, size, colour, tonal bias, softness,
scanner sharpness, light response, scanning—, halation, diffusion, lens,
grain engine, seed), `tools/plugins/film/plugin.js` (new: the C ABI with
`inf_render_rgba` and `inf_render_linear_rgba` and an empty side registry, without
retaining views between calls) and `tools/plugins/build-film.mjs --aintfilm`, which
assembles and packs it. **The package built** (with decisions 7–9):
`film-0.1.0.rpk`, version **0.1.0** (aintfilm's; engine 0.1.0), **1,948,807
bytes**, `sha256`
**`e6b1e2c70beae17375d3eba222a2095fb653cce39264af12a0faa9229216b264`**, 137
files and 127 recipes (51 films, their colour alone, 8 grains, 13 filters, 4
lenses), pinned in the registry with the `url` of the v0.1.6 release and empty `keyUrl`;
the key is held by the lead (outside the repository). Tests: 62
new in seven files (`plugins-rpk`, `plugins-host`, `plugins-settings`,
`plugins-brands`, `plugins-film`, `plugins-thumbs` and `plugins-frames`; part
of `plugins-film` only where there is an aintfilm checkout; and that `?testPlugins=`
is not in a production version), with 44 mutations checked (each one
breaks what a test guards and that test fails; one more survives on purpose:
removing the ciphertext length check, which its `sha256` already covers); `tools/plugins-check.mjs` green
with the real package (installing from the local server with the typed key,
a wrong key, removing and installing from a file, the preview with the plugin's
numbers, undo, *Apply*, achromatic, reload) and the captures
`docs/ui/settings-plugins.png` and `docs/ui/render-plugins-film.png`.
`docs/release-notes/plugins.md`: how the `.rpk` is published and what is done with the
key.

**Done, decisions 7–9** (2026-10-14). **The logo** (7):
`tools/plugins/dot-grid.mjs` writes the package's `logo.svg`, a `rect` per
dot in square cells, from the **owner's logo image** (`build-film
--logo`: read dot by dot, its dot columns and rows by where there is ink
and each one's ink grouped into the image's levels) or, without it, from
the `LOGO` rows of the checkout's `marks.ts` with `DotGrid`'s two-ink rule; the old SVG is no longer used. The package's comes from the image: 15×15,
121 dots, the tab in `#808080`, `#BFBFBF` and `#E0E0E0` and the rest `#FFFFFF`,
the dot 0.862 of the cell. **Checked** by rasterising the SVG at 2000×2000 on
black with the local Chromium, placed where the image has its grid:
**225 of 225 cells equal** (the same ink class and each dot's mean
equal: maximum difference 0), the centres within 1 px at most, the four levels
128 · 191 · 224 · 255 in both, 98.9 % of pixels within 24 levels
and 96.2 % overlap of the ink (the image's dots are hand-drawn, they are not
perfect circles). It goes on the black tile in *Settings* and in the
render window, in both themes. **The carousel** (8): the `film-thumb` scene
of `rt-cli` (`rt --write-film-thumb`; the bottle and the lamp come from
`bottle_meshes`/`lamp_meshes`, and the E5 scenes of both still give
the same bytes) rendered at 512 samples with denoise (147 s on 4 threads) into
`tools/plugins/film/thumb-base.png`; the manifest names it (`base`); the preview
without a result is that image through the plugin (Apply still waits for
a result); the cards (`ui/panels/plugin-recipes.ts`) carry the base image
reduced to 160 × 100 for each recipe with the default controls, made one by
one, stored in IndexedDB (version 2, `thumbs` store) and delivered
at once the next time. **Time per thumbnail**: with the film engine,
~1 s at 320 × 200 and ~0.2 s at 160 × 100 in Node with the machine loaded (median
of 20 recipes: 963 ms and 199 ms), so they go at half resolution; in the
browser, the 128 cards in 27 s (0.21 s each, from the first opening to the
last image) and 1.7 s on opening again. **The per-frame seed** (9):
`role: 'seed'` on the seed slider (the film one and the test one, which gains a noise derived from it),
`frameControls`/`frameSeed`/`SEED_RULE`, the switch **Apply to render jobs**
(`RenderSettings.plugins[id].jobs`) and the queue step that sends each image through the
plugin; the first, to the history with `provenance.seed`. Browser check
green with the new points (`d2_base_preview_and_cards`, `d2_film_cards`,
`d2_film_cards_kept`, `e_jobs_switch_undoable`, `f_carousel_keys_wheel`) and the
two captures redone.

**What did not fit the plan.** (1) **The public names**: aintfilm's tree
still shows brands (its M38-07, the renaming, is pending; its
`check:brands` is red on purpose). What was decided there was used: a film is
its neutral id in capitals (*CN-01*, D113, from `stocks-map.json`, until
the owner chooses names in M38-10, and then the package has to be rebuilt),
with its box ISO; filters and formats, the words of D112 (*BLACK DIFFUSION*,
*WARM DIFFUSION*, *SPARKLE*, *PEARL*, *INSTANT 54×86*, *15-PERF 70 MM*); grains
and lenses, generic words, with those from aintfilm's dictionary where there
are any. (2) **The brand check**: aintfilm's `scripts/check-brands.mjs`
only walks its own list of paths and the checkout has no `node_modules`
(it imports `typescript`), so it cannot be run from there over another
folder. Its mechanism was rewritten, as it describes it, in
`tools/plugins/brand-scan.mjs` (it reads the checkout's list of hashes, which is not
copied) and was also checked with the exported functions of the script itself
(with a resolution hook towards a system TypeScript, without touching the
checkout): both give the same. Clean: the manifest, `recipes.json`,
`plugin.js`, the logo, the licence and Repackshot's strings. What remains, inside
the encrypted package and never shown, are the engine's internal labels: the
module (15 matches in the latest build, its `--dist` is red for the same reason), the
presets' settings (490: the type of the diffusion filters and the key of the paper of the
spectral model, which every complete preset has), `engine.json` (3: two format
ids) and `NOTICES.txt` (9, what a licence requires naming); they belong to its M38-07
and M38-08 (renaming *serde* labels by patch). (3) **The presets go
complete**, not sparse: the build reads them with `settingsFromValue` of the
checkout itself (run with Node's type stripping) so that the glue
scales values without guessing *serde*'s default values; they are 1.1 MB of the
package. A *colour only* recipe brings the engine's default grain (that is how
*serde* fills in a preset that does not say it): the *Grain* switch removes it.
(4) Added to the manifest, without being in the list: `groups` (the titles of the
groups), `minLabel` on a slider (aintfilm's rule that the left stop
says *PRESET* and sends nothing), `aux` and `notices`; and to the ABI, `init`,
`ready`, `cancelled` and `error`. (5) The registry's logo cannot be inline (it belongs
to the closed package): before installing a neutral icon is shown. `homepage` is
`https://aintfilm.app`, the domain configured by aintfilm's `src/lib/appConfig.ts`;
`publisher`, *Grohle*. The default seed is the engine's (1). (6) *Apply* saves the image where its source was
saved, like the AI's: in the browser it is a download. Cancelling it stops the worker
(the module's render is a single synchronous call) and the next use starts it again.
(7) The 480 px preview shows the grain of a small negative (*75 µm per
pixel*): it is what the engine says; *Apply* does it at the result's size. (8)
The tools need Node 22.18 or later. (9) `modelCatalogue()` in
`src/main.ts` reads `?testModels=` with `atob` without decoding UTF-8 (a name with
accents would come out wrong); the plugins one does it right; the models one was not touched. (10)
The launcher does not change (the store is IndexedDB in WebView2 too) and testing
on a real Windows stays on the list in `docs/release-notes/plugins.md`.

**What did not fit the plan, decisions 7–9.** (11) **The `marks.ts` logo is not
the image's**, and not only in the greys: the `LOGO` grid of the checkout is 16×16
with 137 dots (axis of 4, shoulders of 10, body of 12 that passes over the
tab) and a single dim ink `#4A4A4A`; the owner's image (like
the owner's drawing in their `design/screens/owner-0912b-film-cartridge.jpg`) is
15×15 with 121 dots (axis of 3, shoulders of 7, body of 9) and three greys.
The image won, as asked, but then the logo cannot come from the rows of
`LOGO`: it comes from the image, read by `build-film --logo` at build time
(the image belongs to the owner and goes only inside the package, like their logo: it is not stored in
this repository, nor its rows); without `--logo` the `LOGO` one comes out, which is not
published (the release notes say so). `DotGrid`'s rule is that of the
`marks.ts` path. It would be worth telling aintfilm that its `LOGO` is not the owner's logo. (12) **“One `rect` per dot” and round dots**: the image and
`DotGrid` draw circles; each dot is a `rect` with `rx = ry` half
its side (a circle), in its square cell, to satisfy both. (13) The
base image is **8-bit sRGB PNG**, what `rt` writes (it does not write 16-bit
linear), and enters through `inf_render_rgba`, like any PNG result; the scene carries
`clamp_indirect` 2: the filament seen through two glasses gives
caustics that the tracer finds as fireflies even at 512 samples with
denoise. (14) The cards are made when the plugin's block appears for the
first time (that is where its worker starts), not at application startup, and the
*No recipe* one also carries its image; a new version redoes them (the key is
the version, not the `sha256`: a different package with the same version would keep
the earlier ones, which is why the package rebuilt here, which was never published,
is still 0.1.0). (15) **Applying to an animation job did not exist**: the
plugin only worked on a history result, and the history stores
only the first frame of an animation. The switch *Apply to
render jobs* (`jobs`, off by default) was added, which passes every image of
the jobs (stills and frames) through the plugin, after saving the engine's one
and without entering the progress bar. (16) “The frame index” is its
number in the animation minus one, not its position in the job: a span
rendered separately (3–4) has the grain it has in the whole animation; the seed wraps
the slider's range (the film one's reaches 999,999,999). (17) The preview does not show other frames: it is always the
set seed, that of frame 0. (18) The IndexedDB thumbnail store
has no Node test (there is no IndexedDB in the tests): the browser check
sees that it stores and returns (`d2_film_cards_kept`); that *Remove* deletes them
is only checked by the tests on the in-memory store.

**P6b** (2026-10-14, request: the carousel like the film search of
aintfilm's app). **Done**: a thin slider under the carousel, as wide as it, tied to its
scrolling in both directions (its steps are the carousel's snap
positions, one per card and the last its end: `ui/strip-math.ts`), with the
chosen card marked on its track and operable with the keyboard; and the filters, which the
plugin declares in its `presets` response (`filters` and each recipe's
`tags`) and the host draws as rows of chips over the carousel, combined (AND), with
the count (*23 of 127 recipes*), the chosen recipe first and marked *Outside the filters* when they leave it
out, and saved with the plugin's settings (`filters`, undoable). The film one
brings those of the app (aintfilm's `docs/MANUAL.md` §7 and `src/lib/filmFilter.ts`): **Type** (its words:
*COLOUR* for colour negative, *B&W*, *SLIDE*, *CINEMA*, by each film's class) and **ISO** (its three
bands, *≤ 100 · 200–400 · ≥ 800*, cut at 100 and 400 by the box ISO),
plus **Group** (films, a film's colour, grain, diffusion, lens: the
package's groups). Package rebuilt with the same key: 1,956,072
bytes, `sha256`
`a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`, version
0.1.0 (not published yet). Tests: 9 new (`plugins-filters`, and one in
`plugins-film`), 15 mutations checked; the browser check
drags the slider, moves it with the wheel and with the keyboard, and applies two
filters (`f_scrub_slider`, `f_two_filters`). **What did not fit.** (1) The app has a
third filter, **BRAND**, and it is not there: those are manufacturer names (its D112); the
fourth, **ORIGIN** (from the app, mine, others'), would have only one here. There are no
more facets in the app (format, process, era): none were invented. (2) *Colour /
B&W* is the app's **Type**, with its four values: slide and cinema
are also colour, and the app separates them that way. (3) The app draws its filters
as dropdowns in a row (M31-03); here they are chips, as asked. (4) A
recipe without a film (grain, filter, lens) has no Type or ISO: it is only in
*All*, the app's rule.

## Owner's bug report (2026-10-14/15) — triage, B1 and decisions

The owner sent a report of serious bugs (stored verbatim in
`TODO.md`, second document). Its triage, point by point against the code
of `main` (`72e4f79`) and the O2 branch, is in **`TRIAGE.md`**: what exists
today, whether it reproduces, whether it is a *bug*, *missing* or a *decision*, cause, fix and
dependencies. From it come:

### B1 · Fixes from the report — **Sonnet** — done

**What.** The confirmed failures and what the owner asked for, leaving nothing
open:

1. **Click to focus (1.8).** The pick is already the pixel's; the same click
   undoes it: OrbitControls fires `end` on every `pointerup` and
   `src/main.ts` patches the camera with `focusDistance: v.distance`. A
   pure function in `core/camera.ts` (`orbitPatch(cam, view)`): no patch
   if the view did not change; the focus follows the orbit distance only if it
   already followed it (the gizmo rule from `view-objects.ts`). It is used in
   `onViewChange`, in the gesture and in *Look through*. Along the way: `clickAt`
   measures from the **viewed** camera (`viewedCamera`), not the active one.
2. **Cloth to *Nodes* (1.6, along the way).** The cloth's `outputSetup` uses
   `fabricMeanColor`, not `(a + b) / 2`: denim does not go back to the bluish
   grey that E6 corrected.
3. **`.repack` extension (4.1).** The owner asks for it, so the change
   to U2's contract is theirs (rule 12): `.repack` is saved, the content
   remains the same JSON, `.repack` and `.repack.json` are opened (also
   when dropped on the window); the launcher admits `repack` in
   `WRITABLE_EXTENSIONS` and in its dialogs; the Wine test and the
   documents (SPEC, ARCHITECTURE, UI) say so. The file association
   in the installer is left out (not asked for).
4. **AI attempts (2.2).** There is no endless loop in the code (cap of
   4 per variant), but the queue does not count it: the row says “attempt *a* of
   4”, the variant and the reason for the last failure, and the bar is divided by
   attempts. And the render window's preview stops restarting
   with every model-manager snapshot that changes neither what is installed nor
   what is ready (triage hypothesis: during a download they arrive every 200 ms).

**Acceptance.** Each fix with its test, which fails without the fix (rule
3): `tests/camera-focus.test.ts` (same view without a patch, orbit with the focus
following, orbit after a click-focus); the cloth's colour for all
`MATERIAL_PRESETS` (fails today on `DENIM`, `SATIN`, `MICROFIB`); the
`.repack` names and filters in the page and in `rt-app` (`files.rs`,
`dialogs.rs`); the queue row and the preview controller with
a fake clock. A browser check in `tools/` that makes the real click
on the sample bottle and reads *Focus distance* (in the triage
it went 688 → 660 → 688). `npm run qa`, `npm run engine:test`, fmt and clippy.

**Done.** (1) *Click to focus*: `orbitPatch(cam, view)` and
`focusFollowsOrbit` in `core/camera.ts` (no patch if azimuth, elevation,
distance, target and orthographic width do not change; the focus follows the distance
only if it already followed it), used by `onViewChange` and by the gesture in
`src/main.ts`, by `lookThroughAction` and by the camera's gizmo; the click
measures from the viewed camera (`focusPickAction` in `core/view-objects.ts`, which
`clickAt` calls: the camera of *Look through*, or the active one if looking through a
light). `tests/camera-focus.test.ts` (11 new tests) and
`tools/focus-click-check.mjs`: the real click on the bottle gives 688 → 660 and
stays (with the earlier `main.ts`, 688 → 660 → 688 and *Move the camera* in
undo: 4 of the 8 checks red). (2) *Cloth to Nodes*:
`fabricMeanColor` and `WEAVE_WARP_SHARE` move to `core/fabric.ts` (re-exported
by `core/materials.ts`, so that the graph uses them without an import cycle) and
the cloth's `outputSetup` uses them; test in `tests/material-graph.test.ts` with
all the `MATERIAL_PRESETS` (fails on denim, satin and microfibre without
the fix). (3) `.repack`: `core/project-names.ts` (`PROJECT_EXTENSION`,
`PROJECT_EXTENSIONS`, `PROJECT_FILTER_EXTENSIONS`, `isProjectName`), the browser's
picker (`accept` and `types`), the desktop dialog (one filter with
`repack` and `repack.json`), dropping and *Import*; `WRITABLE_EXTENSIONS`,
`is_project_name` and the tests of `files.rs`, `dialogs.rs` and `tests/files.rs`
in `rt-app`; `packaging/wine-dialogs.mjs` (run here against a Windows
build of the launcher under Wine: it passes, with `RPX_EXT=repack` and the filter
`*.repack;*.repack.json`); SPEC §3.9, ARCHITECTURE §8, UI.md and the U2 note.
(4) *AI attempts*: `AiPostProgress` carries `maxAttempts` and `reason`
(1-based, divided by attempts); the launcher gives `lastFailure` in the *post*
state and divides the bar into quarters (`attempt_range` in `post.rs`), the synthetic
service and the wasm driver likewise; the row says *AI · tile 2 of
4 · attempt 2 of 4* (also with the variant) and, below, *Attempt 1 did not pass:
<reason>* (`aiStatusText`, `aiWhyText`, es and en); the render window's preview
is only redone if the installed models or `ready` change
(`previewTriggers` in `ui/ai-preview.ts`; with the fake clock, 40 consecutive
download snapshots give 1 request and not 40). Each fix with its test, and each test
fails on reintroducing the failure (mutations checked one by one).

**What did not fit.** (1) **The cap is 4 everywhere** (`MAX_ATTEMPTS` of
`rt-post/job.rs` and `core/ai.ts`, the launcher's `maxAttempts`, the
synthetic one's loop): there is no endless loop, and with N variants it is up to 4 × N attempts. But
the wasm driver (`runGuarded`) counted attempts from 0 in the progress
and the rest from 1: now all from 1. What the person sees still cannot
be reproduced without the launcher's log (which now says *attempt k of 4
failed*). (2) **The bar in quarters has a cost**: with a single attempt
accepted the AI bar reaches 23 % before the job finishes and jumps
to the end (the row says *attempt 1 of 4*); it is what was asked for, but if it looks odd,
an uneven split (the first attempt with more bar) is a visual-judgement
call (rule 11). (3)
The reason goes on a second line of the row and in its tooltip; **the final
notice was not touched** (the triage mentioned it): the viewer's report already
says it. A running task's row with a retry grows (status and reason
wrap instead of being cut off) and the queue's columns are redistributed (the name
gives up width to the status). (4) **Click focus**: the focus plane with
*tilt* (b of the triage) and the pick through a traced lens's distortion
(O2) are not touched; with an animation shot with the playhead beyond 0 the click measures from
the viewed camera without the pose (the shot animates that focus anyway). (5)
**`.repack`**: no file association in the installers (not asked for);
saving over an open file writes it where it is, with whatever name it
has (a `.repack.json` stays one); `tools/desktop-window-check.mjs` and
`desktop-platform-check.mjs` now save `.repack`, but could not be
run here (they need the release launcher and its window). (6) **Finding
outside the brief**: on moving to *Nodes* a translucent plastic with internal scattering
(`HDPE_WHITE`, `PP_NATURAL`, `PMMA_FROST`) the graph loses the medium
(`kind`, `scatterMm`, `scatterColor`, `scatterG`: the graph has no inputs for
that); the base colour does now match in all materials. (7) A mock more
permissive than reality: the *post* state in `tests/ai-desktop-service.test.ts`
did not carry `lastFailure`; now it does.

**Pending from the owner** to close what could not be reproduced:
the launcher's log (`<data>/logs/repackshot.log`) of an AI pass
that gets stuck in attempts (2.2), and a saved scene where
denoise washes out lights and colours, with and without it (4.2: measured on the sample,
it changes mean luminance and saturation by less than 0.1 %).

### With O2

- O2 draws a traced lens's distortion in *Fast*, but the pick
  uses the undistorted ray: with a wide angle or the fisheye the click does not
  land under the cursor. Fixed in O2 (`593d480`: a single map in
  `render/lens-profile.ts` for the screen pass and the pick).
- **1.3** (really choosing the lens, distortion and bokeh) is O2.
- **1.4** (a window with the elements when hovering a lens in the list)
  comes after O2: the SVG cross-section already exists; what is missing is the floating notice and asking the
  engine for the information of the pointed-at lens (S–M, Sonnet). Done in **O2b**.

### Missing items that already have a phase

- **1.1 and 5.1** (mapping type, size, offset, size
  relative to the solid): M2a's controls exist, but only appear with an image in
  the slot; *Full* and *Render* draw them from **M2b** (done). The
  rest of 1.1 and the decision on 5.1 are still pending.
- **1.6** (nodes do not drive the material in *Full*, the default
  mode): **M3b** (done).
- **3.1** (live view of the render selected in the queue): new phase
  **U14** (Opus, M), after B1 because both touch the queue row: the
  running job shows its frames when selected (desktop: those of the job from
  `/api/render`; web: the pool's accumulation), without slowing
  the render (cost measured); finished ones still open the viewer.
  **Done**: see U14.

### Judgement calls (formerly “Decisions for Fable”)

**Since 2026-10-17 the lead takes them**, at the owner's instruction. Agents keep preparing and noting them with ◆, and do not take them on their own (rule 11). This list collects what was decided. Each entry says whether what exists is enough or which phase builds it. The starting data remain in `TRIAGE.md` and in each phase's paragraph.

**Phases that come out of this:**
- **C1** · Judgement calls applied: the small changes of this list, in a single PR. **Done**: see C1, below.
- **C2** · Focal-length switch (1.7). **Done**: see C2, below.
- **M3c** · *Wood* and *Cloth* nodes (1.6). **Done**: see M3c, after M3b.
- **M3d** · The family's wood in *Fast* through the *Wood* node's path (M3c ◆3). **Done**: see M3d, after M3c.
- **M3e** · *Fast*'s knots where *Full* puts them and the baked cloth when its threads are legible (M3d ◆1 and ◆2). **Done**: see M3e, after M3d.
- **N2b** · The studio travels with the project. **Done**: see N2b, after N2.
- **O2c** · Lens element editor (1.5). **Done**: see O2c, after O2b.
- 1.2 goes into **S3**. (done in S3)
- **S3b** · The rest of S3 (rain that settles and runs, dust that settles, the glass fed by the scene, the simulation in the worker with cache), with *Shape* out of *Advanced* and the glass approximated in *Fast* (S3 ◆5 and ◆9). **Done in part**: the *Shape*, the glass in *Fast* and everything that happens on the front glass; the parts' side, **S3c** (see S3b and S3c, after S3). **Done in part**: see S3b (the front glass); the rest, S3c.
- **S3c** · Drops and dust on the parts: rain that settles, runs and drips over the meshes, snow, the wet mark on the material and dust per part (S3b, “S3c”); and a warning when the engine lacks bit 7 and the scene's glass would come out clean. **Done in part**: the warning (and the bit 8 one) and everything that happens on still parts, in the engine and in *Fast*; drops through the air, dust motes, moving parts and the studio floor, **S3d** (see S3c and S3d, after S3b). **Done in part**: see S3c; the rest, S3d.
- **S3d** · What remains of drops and dust on the parts: dripping and splashes that fall through the air, dust motes, dynamic parts getting wet, the studio floor, finer samples on the set, the drops' part id and the meter text (S3c, “S3d”).

- **O2** (the traced-lens sheet). Accepted as it stands:
  - which lenses give cat's eye, bubble, creamy and swirl;
  - the assumed prescriptions and stops;
  - the anamorphic adapter's constants;
  - the charts' focal lengths;
  - mask sampling.

  Revisited only if a real render contradicts it.
- **2.1** (the AI guard). The owner says the AI phase “does almost nothing” (`TODO.md` §2.1), and the guard is almost invisible by design. Therefore:
  - the guard's default tolerances are **doubled**;
  - the **default intervention goes from 30 to 50**.

  Both remain in *Settings*. **C1.** (done in C1)
- **1.7** (the focal-length switch). It is a switch next to the focal length, *Keep the size of what is in focus*:
  - **off** (the default, as in a camera): the camera stays and the framing changes;
  - **on**: the camera moves closer or further along its axis so that the focused plane keeps its size in the image, i.e. the perspective changes and the size does not.

  The inspector says which is active. It is undoable in one step. **C2.** (done in C2)
- **6.1–6.3** (sets inside *Studios*, their lights switchable). **Closed by L7.** Sets are a group of their own, and each light is switched on and off in the *Lights* list without touching the rest.
- **5.1** (the size of textures and procedurals). **In millimetres**, absolute, as E6 already does. *Fit to part* remains as an option. The manual size writes those millimetres. SPEC l. 456 is corrected to say the same as l. 101 and E6. **C1**: check that the code already does it this way and correct the SPEC. (done in C1)
- **E13** (MNEE). **Not merged.** It costs 1.8–2× with curved glass and does not improve what is seen. Caustics stay in the photon map. The branch `wip/ccr-8df3f848/e13` stays as a reference.
- **E10** (adaptive sampling). **Accepted**, with 0.83× at equal time: it is only behind *Finish by noise* and makes nothing worse. The allocation rule is revisited if a real render asks for it.
- **1.2** (the drop and the geometry mix in *Ambient*). **Yes.** It goes into **S3**, the rain and dust phase, which already touches those geometries. (done in S3)
- **S4b** (ambient particles). Everything proposed is accepted:
  - the forward lobe, at 0.5;
  - the rain's cost (1.63×), which is only paid with rain;
  - the grain in the trails under side light;
  - the narrow-path rule, in which drops also refract.
- **1.5** (the editor for a lens's elements). **Yes**: edit, move, add and rotate 180°, on the own lens that O2 already stores. **O2c.** (done in O2c)
- **1.6** (*Wood* and *Cloth* nodes). **Yes**, with E6's recipes. The graphs' wood example has to resemble the *Wood* family (`m3b-wood.png`). **M3c.** (done in M3c)
- **M3b** (`NORMAL_MAP` with blue below 0.5). The node **does not let a normal point inward**: it brings it to the outward hemisphere. The flakes example is redone with outward normals. **C1**, with its test and, if the engine changes, with the pins that move explained. (done in C1)
- **4.2** (the fireflies clamp and the denoise edge by luminance only). **They stay as they are** until we have the owner's scene. Without it there is nothing to measure with.
- **Q1** (the section):
  - the control stays in the *Scene* inspector, and in the palette;
  - the cap of a cut glass **refracts**, as now, which is the physical thing;
  - the studio is **never cut**.
- **K1** (the interior recipes and the interiors Doctor):
  - the figures of the seven recipes are accepted;
  - the **starting recipe of the *Interior* type is *Midday window***;
  - the Doctor's thresholds are accepted as proposed: scale from 100 mm to 30 m, lens below 18 mm (warning from 24 mm), eye height from 0.3 to 2.2 m (to 1.5 m), near clipping at half the distance to the wall.

  **C1** sets the starting recipe. (done in C1)
- **D1** (the engine Doctor):
  - clipping with *Standard* is a **warning**, not a failure, because flat white backgrounds look for it;
  - the fix proposes **AgX**;
  - the thresholds for fireflies and the budget are accepted;
  - the video warning is woken up, because N1 is already done;
  - the denoise one stays as it is.

  **C1.** (done in C1)
- **N1** (animation). Everything proposed is accepted:
  - the wizard order, target first;
  - what a *Fade* is;
  - the solar arc's pole;
  - the shape of the fade to colour;
  - the automatic video quality.
- **L7** (*Sets* and *Lights*). The classification is accepted, the *Product type* filter only in *Sets*, the *Subject* filter, that a new set replaces the decoration and the three thumbnail sizes. One change: **it is not asked whether the lights present are the product type's untouched ones**; they are simply replaced. **C1.** (done in C1)
- **H1** (the auxiliary greys):
  - **4.5:1** (WCAG AA) is accepted for secondary text;
  - primary text stays at 7:1;
  - the hierarchy of greys is not flattened.

  If any pair in H1's report falls below 4.5:1, that pair is raised. **C1.** (done in C1)
- **U15** (the arrows):
  - the compact variant, always visible (the owner asked for arrows on all values);
  - the list of what was converted to sliders, as is;
  - repetition, 400 ms and then every 50 ms.
- **N2** (passes, batches and ZIP). Accepted:
  - alpha as an object mask, without the floor;
  - the four passes;
  - the encodings;
  - the ZIP off by default;
  - camera-by-camera order.

  A cut-out with texture will give partial coverage when the engine has it. One change: **a job's studio travels with the project**, stored inside, so that a project opened on another machine does not fail its jobs. **N2b.** (done in N2b)
- **K3** (the interiors camera). Everything proposed is accepted:
  - eye heights, 1.5 and 1.1 m;
  - interior lenses, 24, 28 and 35 mm;
  - the automatic measurement;
  - the EV 7 and 5 presets, with their calibration;
  - the exterior, from 0.05 to 1, with 1 by default;
  - that *Interior* switches on straight verticals;
  - the fisheye's field, measured on the diagonal.

- **F1** (focus by point and by object): the *Object* follows the centre of its box; the slider's range and logarithmic scale, as they are; in *Point* and *Object* **moving the slider becomes *Distance***; the best focus of the traced lens by fine-detail contrast, as it is (the corner with distortion +1 stays open); a focus clip wins; a click on a glass focuses its front face. **Done in F1.**
- **N2b** (the studio travels with the project). The four are accepted as they stand: the copy wins over a library studio with the same id and different content; editing a job without changing its studio keeps its copy; *Add to my library* saves with its id, is not undoable and lives in the *Queue* drawer; the schema stays at 2. **Done in N2b.**
- **C2** (focal-length switch). The six are accepted as they stand: the switch goes on each camera (it travels with it into the project and the studios); a locked camera changes the focal length without moving; the orbit's target advances along the axis when the camera would end up at less than 0.1 × distance × f′/f; the interior lenses go through the switch, the lens presets still frame the product and the *ZOOM* clips do not move; the row goes below *Focal length*; with orthographic or panoramic the switch remains usable, does nothing and says so. **Done in C2.**
- **O2c** (lens element editor). Accepted as it stands: the new element's default (radii ±4 f, 4 % of f thickness, the catalogue's simple-lens glass, as wide as the narrowest neighbour, centred in the gap), the margins (1 % of f of air, 5 % in front and behind, 1e-3 mm at the edges), the 10 % step of *Smaller · Larger* and the image-circle threshold (relative illumination 0.001). A circle that does not cover the frame **does not prevent applying** (strong vignetting is a look one may want, and the render shows it). The edited lens **keeps the stop's travel** from the catalogue's. **Done in O2c.**
- **M3c** (*Wood* and *Cloth* nodes). ◆1, the fuzz: it stays as is, a numeric output of the *Cloth* that can be used in the graph; the fuzz input of the material output (the program's 16th) arrives with **M5**, when the engine paints the fuzz, not before. ◆2, cloth under a bevel: accepted as is (outside the bevel radius, the same bits as the family; its own pin). ◆3, the family's wood in *Fast*: **yes**, to be baked through the same path as the node, so that wood in the scene looks as on the spheres in *Fast* too: **M3d**. The rest (view from inside, the normal's bit, knots against the box in *Fast*, the mean colour, the seed copied on converting), as is. **Done in M3c**, except M3d and what goes to M5.
- **M3d** (the family's wood in *Fast*). Accepted as is: the family is baked through the node's path and gives the same pixels. ◆1, the knots: **(b)**, E6's knot layer (each part's own, the one that matches *Full*) on top of a bake without knots, for the family and for the node; that *Fast*'s knots land where the render puts them matters more than the bake bringing them. ◆2, the cloth: **(b)**, baked only when a thread occupies at least 2.5 texels, with the fuzz (sheen) on top; below that it stays as today, without moiré. Both, in **M3e**. **Done in M3d**, except M3e.
- **M3e** (knots and cloth in *Fast*). Accepted as is. ◆1, the threshold: **it stays at 2.5 texels per thread**; at 2 the limit where moiré appears is brushed, and unbaked linen and felt read well in *Fast*. ◆2, the knot on top: **the darkened disc stays**; *Fast* is a preview, and the end grain, the crack and the grain around come out in *Full*. **Done in M3e.**
- **S3** (the drop, the shape mix and the front glass; first part). ◆1–4, 6 and 8 are accepted as they stand: the drop of 1.6 radii with a 0.15 tip; the tip behind the velocity (the teardrop the owner asked for, although a real drop falls almost round); the 1 : 1 : 1 : 2 mix; the *Water drops* preset; the glass's figures and ranges; the motes that only absorb. ◆5: **yes, *Shape* leaves *Advanced*** for the visible controls, because the owner asked for it and hidden it cannot be found; it goes in **S3b**. ◆7: **the physics stays**, without a non-physical control that sharpens the drops: with the lens and stop that call for it (wide angles, stopped down, glass far away) they read; revisited with a real render from the owner. ◆9: *Fast* does not draw the glass in this part; an approximation (the drops as discs) goes in **S3b**. **First part done in S3**; the rest, S3b.
- **S3b** (the front glass fed by the scene; the visible *Shape*; the glass in *Fast*). Accepted as it stands: ◆1, wettabilities per family (glass 70/50, plastic 90/65, metal 80/50, paper 100/20, paint 85/60); ◆2, sliding (C = 300, cap of 250 mm/s, 2 µm film); ◆3, the dust angle of repose of 35° ± 5°, and a vertical glass without dust; ◆4, snow, bubbles and confetti leave nothing on the glass (snow, with its layer, in S3c); ◆5, the effect's region does not limit the glass, and a lens looking down stays dry without wind, as the physics says; ◆6, **there is no non-physical intensity knob** (like S3 ◆7): with the presets' densities the dust is barely visible at 120 s, and whoever wants it raises the density; ◆7, *Fast*'s approximation as it comes out of the optics; ◆8, `MAX_GLASS_SECONDS` = 120. The warning for an engine without bit 7 goes in **S3c**. **Done in part in S3b**; the rest, S3c.
- **S3c** (rain, dust and snow on the parts; the bit 7 warning). Everything is accepted as it stands: ◆1, the wettability family of each category (`wettabilityFamilyOf`) and the values for wood (85/40, absorbs 0.01, porosity 0.6), cloth (110/40, 0.5, 1) and paper (absorbs 0.05); ◆2, what each effect deposits (`PARTS_FEED`); ◆3, the splash (up to 30 % of the water, 2 drops, at 4 diameters; an impact wets 2); ◆4, hanging = 1 and the drip that falls in the same step (the fall through the air, in S3d); ◆5, snow (repose 50°, packing 0.5, albedo 0.9, roughness 0.85, covers at 0.5 mm); ◆6, the set gets wet as a film; ◆7, the budgets (1 mm cell, 150,000 samples with a third for films, 120 s, 4096 drops); ◆8, how dark and bright wet things become (film at roughness 0.03, albedo exponent 1 + wet × porosity) and the dust's colour and roughness; ◆9, what is sheltered stays completely dry. **Done in part in S3c**; the rest, S3d.

**1.9** (double bar in aintfilm's LUT carousel) belongs to another
repository; the triage notes that Repackshot also draws the plugin's recipe
carousel, with no vertical bar.


## C1 · Judgement calls applied — **Opus** — done

**What.** The small changes from *Judgement calls* marked **C1**, in a single PR: 2.1, 5.1, M3b, K1, D1, L7 and H1.

**Done:**

- **2.1 · The AI guard.** Factory values: *Intervention* 50 (was 30) in `DEFAULT_AI_PIPELINE`, in `rt-post`'s `Settings::DEFAULT` and in *Settings* (`ai.intervention`); the tolerances, doubled: mean ΔE₀₀ 4 and 95th percentile 6 per material, and edges 4 px in *Settings* (`ai.guard*`, they were 2, 3 and 2) and in the synthetic service (`SYNTHETIC_LIMITS`); in the engine's guard (`Tolerances::PROVISIONAL`) 4, 6 and **3 px** (was 1.5). `AI-POST.md` §3.2 and §4 say so. *Migration*: the *Settings* document stores all the keys and `validateSettings` keeps what was stored (there is no schema step), so a value equal to the earlier factory one cannot be told apart from a choice: an existing installation continues with what it had; only a new one (or *Reset*) takes the new values. Tests: `tests/ai-settings.test.ts` (the new values, the synthetic one with the same, a stored document that keeps 30 and 2/3/2 and one without the key that takes 4) and `the_constants_are_the_contracts` in `rt-post` (50, 4/6/3 and the ΔEs equal to those in `settings.ts`). `tests/fixtures/ai-guard.json` regenerated: the *forbidden* scenario (which uses the default values) changes image, and *strong* and *limited* no longer need to clip the colour of the cap or the label.
- **5.1 · Size in millimetres.** The code already does it: `sizeMm` in mm (`core/textures.ts`), the size field is a `lengthField` that shows in the *Settings* unit and writes mm, *Fit to part* is a button (`insp-textures.ts`), wood and cloth are physical (rings per 100 mm, `pattern/wood.rs`) and wear stores its `refSize` in metres when the material is created. Only the SPEC was corrected (§3.3, the two paragraphs that said “still in part sizes” and “pending decision”).
- **M3b · `NORMAL_MAP`.** In tangent space the blue's `2b − 1` is taken as an absolute value: a normal with blue below 0.5 is reflected into the outward hemisphere, the same in `program/interp.rs` and in `core/material-interp.ts` (the same bits). The example *Metallic paint with flakes* passes the noise through *Separate RGB* → *Combine RGB* with blue at 1. Tests (each fails without the fix): `a_tangent_space_normal_map_never_points_into_the_surface` (Rust), the normal map in `tests/material-program.test.ts` and “the metallic flakes face out of the surface at every point” (it fails if both the fix and the new example are removed). **Pins that move, all because of a normal map with blue below 0.5:** the graph example `METALLIC_FLAKES` (`eb24ca6b` → `3795f601`, new example and new node), two cases of the cross test (`NMAP 0` and `NMAP 4`, the instruction alone in tangent space over colours with blue below 0.5; `NMAP 1`, in the part's, does not move), the fifth of `PINNED_M3B_PROGRAM_VALUES` (`0x587e_907c` → `0x6d55_bcef`: the flakes card from `NOISEC` into `NMAP`) and `PINNED_M3B_PROGRAMS_4SPP` (`0x0d6e_20ba` → `0x90b4_2b6b`, the same card in the image; also in `rt-app` and `rt-cli`). M3b's six passes and every pin of a scene without `NMAP` stay the same. `engine.yml` reads the pins from the code (`sed`), so its blocks do not change. In the region comparison (`tests/programs-full-browser.test.ts`) the flakes go from correlation −0.91 and a hue distance of 106 to **+0.87** and **28**, within the margin of the others: the test now requires hue and positive correlation of them.
- **K1 · *Interior* starting recipe.** `SceneTypeDefaults.lightSetup` (`INT_WINDOW_NOON` in *Interior*) and one more slot of K1's mechanism, `studio.lighting`: it stores the setup, its lights, `modified`, the dome intensity and the exposure, and writes the same as choosing the recipe in the catalogue (`applySet` with the decoration kept). It only acts on the untouched product-type lights (L7's definition, below); a chosen setup or edited lights stay. Going back to the previous type returns the lights as they were (the same fix), and if the person touched one of the recipe's lights, theirs stay. Tests in `tests/scene-type.test.ts` (six new; K1's round-trip ones pass unchanged, “removes nothing” no longer asks for the same lights in *Interior*).
- **D1 · Engine Doctor.** Clipping with *Standard* was already a warning (`WARN`: the Doctor has no other failure state); now the catalogue says so and the sentence (“it is what a plain white background looks for”) and the fix sets **AgX**. The video check already woke in N1 (dormant meant that until N1 the settings forced the frame sequence): it warns only of a container the system does not encode; the SPEC still said the earlier thing and was corrected. The denoise one does not change. Tests: three new in `tests/doctor-engine.test.ts` (warning and AgX in the fix and in the sentence in both languages; the video awake; the denoise the same) and the two that pinned *Filmic*.
- **L7 · The question about lights.** “The untouched product-type lights” is `typeLightsUntouched` (`core/lighting.ts`): the setup in force is the type's (`PRESET`), `studio.modified` is off (any added, duplicated, edited, placed, aimed or deleted light turns it on, and only setting a setup turns it off) and the lights, without a set's decoration, are value by value those of the type's `lightsFromRig` (so there are no own or kept lights, and a type chosen without redoing the studio does not count). With them, `requestSetup` replaces without asking, also if *Settings* remembers *Hide* or *Add*. Tests: two new in `tests/light-catalogue.test.ts`; `tests/library.test.ts` and `tests/light-panel-browser.test.ts` no longer expect the question on a freshly opened project (the second first chooses a setup without a question and then another, which does ask).
- **H1 · Contrast.** `tests/ui-contrast.test.ts` demands 7:1 of primary text (`ink-0`, `ink-1`, the inverted one) and 4.5:1 of secondary (`ink-2`) on all surfaces of the four themes, and that each grey be at least 10 % below the one above on each surface (the hierarchy is not flattened). The only pair below 4.5:1 was the light theme's `ink-2`: **`#6b6b6b`** (3.78:1 on `bg-3`, 4.39 on `bg-2`, 4.43 on *overlay*) becomes **`#5f5f5f`** (4.52:1 on `bg-3`, 6.4 on `bg-0`); the dark one (`#9a9a9a`, 5.10 to 6.86) and the high-contrast ones already reached it.

**What did not fit the plan** (rule 12; ◆ for whoever decides):

1. **The *Settings* guard controls did not reach the guard** (decided and done in the second round, below): `ai.guardDeltaE`, `ai.guardDeltaE95` and `ai.guardEdgePx` were stored and shown, but the guard always used `Tolerances::PROVISIONAL`, and the factory edge differed (1.5 px in the engine, 2 in *Settings*).
2. **Existing installations kept 30 and 2/3/2** by the *Settings* convention (what is stored governs): it was decided to migrate them (second round).
3. **`NORMAL_MAP` in the part's space** could still bend the normal inward with an intensity above 0.5: it was decided to fold that too (second round).
4. **K1**: the decoration of a product type that is a set (the puddle light, the backdrop) stays under the recipe, as when adding a recipe keeping the lights; removing it would force the slot to store scene parts to give them back. With *Interior*'s automatic exposure, the exposure the recipe sets (the type's plus 0.2) is the compensation, just as when choosing it in the catalogue.
5. **D1**: clipping was already a warning and the video had been awake since N1; what is new is the fix (AgX), the sentences, the SPEC and the tests.
6. **H1: `ink-3` is not raised.** It is the grey of the switched-off (disabled controls, separators, handles, empty thumbnails), which WCAG 1.4.3 does not measure; raising it to 4.5:1 would put it above `ink-2` and flatten the hierarchy. The text that is read and used it moves to `ink-2` (second round).
7. **Captures**: those this change left stale were re-recorded in the second round.

**Gates.** `npm run engine:build`, `npm run qa` (types and build green; of 3071 tests, in one pass only `tests/ai-desktop.test.ts` “cancelling mid-way” failed, a timing race with the machine loaded that sets the intervention to 100 and does not depend on the factory values: it passes alone three times in a row, and the whole suite with `npx vitest run --maxWorkers=2` gives 3065 pass and 6 skipped). In `engine/`: `cargo fmt --check`, `clippy --workspace --all-targets -D warnings`, `cargo test --workspace --release` (1130 pass, 5 ignored), the wasm32 build of `rt-wasm` and `rt-post-wasm` with no WASI imports, the parity blocks of `engine.yml` against the real `rt_wasm.wasm` (40 images; M3b gives `0x90b42b6b` with its six passes equal), the guard parity with the real `post.wasm` (`tests/ai-post-wasm.test.ts`) and the page-code tests with the real `rt.wasm` (107 pass). `tests/programs-full-browser.test.ts` and `tests/light-panel-browser.test.ts`, in Chromium.

**Second round** (what is marked ◆, decided by the lead):

- **Merge of `main`** (v0.1.17, the startup in *Fast* and O4): the CHANGELOG joins the two parts by areas; in the ROADMAP the name *Judgement calls* stays (O4 noted its decisions in its own phase and did not touch the list).
- **Migration of the earlier factory values.** `SETTINGS_SCHEMA` becomes **2** and its step 1 → 2 (`STEPS[1]`, with `OLD_AI_FACTORY`) changes a stored `ai.intervention` equal to 30 into 50, and tolerances equal to 2, 3 and 2 px into 4, 6 and 4 px, each on its own; any other value stays, and a schema-2 document is read as is (there a 30 is a choice). Test in `tests/ai-settings.test.ts`: an old document takes the new ones, one with 35 keeps 35 (and a ΔE of 5 or an edge of 1 their own), one of schema 2 keeps 30.
- **The guard controls reach the guard.** `AiPostRequest.tolerances` (`deltaEMean`, `deltaEP95`, `edgesPx`, the keys of `Tolerances::KEYS`) and `withGuardTolerances` (`core/ai-post.ts`), which wraps the application's service (`main.ts`) and puts in each request, the queue's and the preview's, what *Settings* says at that moment (`guardTolerances`). On desktop, `DesktopAiService` sends them in the JSON and the launcher already accepted them (`PostRequest.tolerances`); on the web, the synthetic service measures against them and `jobTolerances` puts them in the `post.wasm` job. The factory edge is **4 px everywhere** (`Tolerances::PROVISIONAL.edges_px`, was 3). With that a failure appeared: the profile that measures the edge reached 4 px on each side and could not measure more than about 3, so with a limit of 4 the check could never fail; it now reaches two pixels beyond the limit (`edge_reach`, from 4 to 16). Tests: with the real `post.wasm`, the plan and the report use 7.5, 9 and 6 if *Settings* says so, and the factory ones if not (`tests/ai-post-wasm.test.ts`); the synthetic service through `withGuardTolerances`, read on every call (`tests/ai-synthetic.test.ts`); the JSON the launcher receives (`tests/ai-desktop-service.test.ts`) and, with the real launcher and the fake runtime, the report of its guard with 7.5 and 6 (`tests/ai-desktop.test.ts`); in `rt-post`, `the_edge_profile_reaches_past_the_limit` and the two tests of a moved edge, which moved 3 px (within the new limit) and now move 6. `tests/fixtures/ai-guard.json` only changes the edge limit the report states (3 → 4): no image moved.
- **`NORMAL_MAP` in the part's space**: a result on the other side of the surface is reflected in its plane (`r − 2(r·n)n`, normalised), the same in `program/interp.rs` and in `core/material-interp.ts`. With intensity 0.5 or less it never happens (the normal is at least `1 − 2s` outward). Tests that fail without the fix: `a_part_space_normal_map_never_points_into_the_surface` (Rust) and the one in `tests/material-program.test.ts`. **Pin that moves:** only the `NMAP 1` case of the cross test (`9b01860a` → `6c271a5b`: the instruction alone in the part's space with intensity 1 and the one that gives a UV coordinate, over colours that point against the normal); the ten examples and the engine scenes use no part-space maps, and no pinned image moved.
- **Text in `ink-3`**: the *coming soon* label of the effect cards (`.fx-card-soon`), the *Edge smoothing* rank (`.sw-aa-rank`) and the names of hidden rows and switched-off lights (`.tree-row.is-hidden`, `.list-row.is-off`) move to `ink-2` (4.5:1). `tests/ui-contrast.test.ts` reads the stylesheets and demands that every rule with text in `ink-3` be a disabled or rejected control or decoration (separator, handle, icon, empty thumbnail), and that those four roles be `ink-2`; it fails if one goes back to `ink-3`.
- **A failure in the *Light* section that the starting recipe uncovered**: each light's fields were redone only when the lights' ids changed, and the recipe's are the type's (`l1`…`l3` and the puddle's), so with *Interior* the type's names (*Fill*, *Back 1*) continued over the recipe's lights, and on going back the recipe's. Now the role is also redone, if it is own, and its name (`tuneLightsKey`); test in `tests/scene-type.test.ts`, which fails with the earlier key. The browser check (`tools/scene-type-check.mjs`) found it; along the way what K3 had left stale was removed from it (it read the transform in the exposure control, and the name *Brightness (EV)* of the automatic exposure counted as a new control) and it does not compare the lights' rows, which with *Interior* are those of its recipe. `tools/ai-post-check.mjs` chose *PNG* by a text that is now also that of *PNG 16 bits*: it is given exactly.
- **Captures re-recorded** (in *Unreleased* in `GALERIA.md`): `scene-type-interior.png` (*Interior* with its starting recipe; `tools/scene-type-check.mjs` follows C1: it then chooses another recipe, which does ask), `m3b-graphs.png` (the flakes facing outward; now made by `tests/m3b-graphs-sheet.test.ts`, with `REPACK_WRITE_CAPTURES=1`) and, of the light theme, `ai-section-light.png` and `ai-results-light.png` (`tools/ai-post-check.mjs`, which expected the factory intervention at 30).

**Gates of the second round**, after the merge: `npm run engine:build` and `npm run qa` green (3108 tests: 3101 pass, 7 skipped); in `engine/`, `cargo fmt --check`, `clippy --workspace --all-targets -D warnings`, `cargo test --workspace --release` (1142 pass, 5 ignored), the wasm32 build with no WASI imports, the parity blocks of `engine.yml` against the real `rt_wasm.wasm` (42 images, with O4's; none moved), the guard parity with the real `post.wasm` (11 pass) and the page-code tests with the real `rt.wasm` (129 pass); the real launcher with the fake runtime (`tests/ai-desktop.test.ts`); `tools/scene-type-check.mjs` and `tools/ai-post-check.mjs` (36 checks) in Chromium.

## C2 · Focal-length switch — **Opus** — done

**Request** (`TODO.md` §1.7), as it stands: when the focal length changes
the zoom relative to the focused object changes, and this should be a
toggle: either the camera moves closer or the focused object / point does.
Decided in *Judgement calls* (1.7): a switch next to the focal length, *Keep
the size of what is in focus*; off by default (the camera stays and the framing
changes, as in a camera); on, the camera moves closer or further
along its axis so that the focused plane keeps its size (the perspective
changes, not the size); the inspector says which is active and each change
is an undo entry.

**Done:**

- **The state, per camera**: `CameraState.keepFocusSize` (optional; ◆ per
  camera and not as an inspector preference: each camera has its lens and
  its place, and so it travels by itself with the project, with *New from current
  view* and on duplicating, and with the library studios, which store the
  whole camera). On opening, only `true` is on (`io/project.ts`
  `withInteriorCamera`, `io/library.ts` `camera`); a project or a studio from
  before C2 is read as off.
- **The calculation, in the core** (`core/focal.ts`, ARCHITECTURE §2, SPEC §3.5
  *Focal length and the size of what is in focus*). A point at depth *z* comes out *f/z*
  times its size: the plane at *D* keeps it if it goes to *D·f′/f*, so
  the camera advances *D − D·f′/f* along the line joining it to its target, and the
  orbit distance and the focus distance drop by the same amount. *D* comes from
  F1's resolution (`focusedPlaneDistance`): the one typed in *Distance*; in
  *Point* and *Object*, `focusDistanceFor` of the point being followed at rest
  (the depth; with tilt, where the hinge plane cuts the
  axis; with straight verticals, measured along the camera's own axis, which is
  the one it moves along: the levelled camera that is rendered keeps the size
  and the place of the plane, checked in the tests). The **orbit target** stays as long as
  the camera stays in front of it at more than
  `MIN_ORBIT_FRACTION` (0.1) of the orbit distance scaled by the same
  ratio; otherwise it advances along the axis in front of it (◆ the rule and the 0.1). The far clipping plane stays
  where it was in the world when moving away.
  **Locked camera**: the focal length changes and the camera does not move (◆, as with
  the switch off; before C2 a locked camera's focal length could already
  be changed). **Orthographic and panoramic**: they do nothing (their framing
  is the width or the field of view, not the focal length), and the inspector's line
  says so (`focalBehaviour`). The action is `camera/focal` (`store.ts` sends it
  to `reduceFocal`), and K3's **interior lenses**
  (`camera/interiorLens`) go through the same place (◆).
- **The interface** (UI.md §5.1 *Camera*, §3): the switch in its row right
  below *Focal length* (in the scene's *Camera* section and in the card of
  a saved camera, which both `cameraFields` draw), with its helper line,
  which says which is active and how the other is, or why it does nothing
  (locked, orthographic, panoramic); the focal length field dispatches
  `camera/focal` with the field's gesture, so each press of the
  arrows (held, a single gesture), each drag and each typed value is
  an entry (*Camera: Focal length*); the switch, another (*Camera: Keep the
  size of what is in focus*). In the palette, *Focal length: keep the size of what
  is in focus (on or off)* for the camera being viewed, with a notice.
  Strings in `es` and `en`; the chrome is the usual switch's
  (achromatic, checked in both themes).

**Tests** (each was checked by undoing its change: it fails).

- `tests/focal-switch.test.ts` (19): off, the camera stays and the plane
  grows by the focal length ratio; on, in *Distance* with the focus on the
  target and off it, in *Point* and in *Object*, and with straight verticals,
  the points of the focused plane **projected** with the camera that is
  rendered (its levelled one and its shift) land where they did (< 10⁻⁹ mm) and their
  size does not change (< 10⁻⁹ relative), while what is in front shrinks and what is
  behind grows; in *Point* the point governs even if the stored distance
  is stale; the pushed target; the far clip; no NaN; the
  interior lenses; the locked camera, the orthographic and the two
  panoramic ones, still; undo (the switch and the focal length, one entry
  each, and undo returns the exact camera), a drag one entry
  (and it ends where a direct change does), each press of the arrows its own;
  round trip in the project (also a new camera copied), an older one
  and one with `"yes"` open as off; a library studio stores it
  and an older one is read as off; the palette command.
  Mutations: removing the movement fails 11 (and 3 in the browser);
  removing the path through the store, 16 (and 4); measuring *D* up to the target instead of
  the focused plane, 5 (and 1); reading *D* from the stored distance in
  *Point*, 1; removing the check for locked, for orthographic and
  panoramic, for the target push, for the clipping, for the interior
  lenses, for the project reading, for the library's or for the palette
  command, 1 each.
- `tests/focal-browser.test.ts` (5, Chromium with SwiftShader; skipped without
  it): the page `tests/browser/focal-page.ts` draws with the preview engine
  two glowing cards, changes the focal length through the store like the
  field (a drag from 50 to 85 mm, a press to 35 mm, straight
  verticals with 18° from 35 to 70 mm) and reads the canvas: on, the focused plane's card
  comes out with **the same pixels** (5145 of 5145, 83 px
  wide; in *Point* on the card behind, 2595 of 2595; with verticals,
  2806 of 2806), within the 1 % asked for, and in its place within one
  pixel, while the other changes; off, the card grows 1.70× (83 → 141
  px). One undo entry each time.
- `tools/focal-check.mjs` (20 checks on the built interface,
  `npm run build` first): the switch below the focal length, off and its line;
  off, the arrow changes the focal length and leaves the focus distance; switching on
  is one entry; the arrow moves the focus distance by the focal length ratio (688.4 → 696.5 mm from 85 to 86 mm) in one entry that a Ctrl+Z
  undoes whole; a drag, one entry; the orthographic and locked line
  (and the locked one does not move); the palette switches it off with its notice;
  the line in Spanish; achromatic in the dark theme and the light one. With the
  earlier field (`camera/set`) `on_the_camera_dollies` and
  `drag_dollies` fail. `--shots docs/ui` leaves the capture.

**Capture**: `docs/ui/c2-focal-switch.png` (the *Camera* block with the
switch on and its line; in `GALERIA.md`, *Unreleased*).

**What did not fit the plan** (rule 12; what is marked ◆ is decided in *Judgement calls*: it is accepted as it stands):

1. **The focal length has no slider**: it is a field with arrows that can be dragged
   (U15). The “slider gesture” is that drag (one entry); no slider was
   added to the focal length.
2. **There are no inspector preferences** where to store the switch; per
   camera fits with the rest (see above).
3. **With tilt (O1)** the size is kept where the plane cuts the
   axis: the hinge rule depends on the focal length, so the tilted
   plane rotates a little when it changes and its off-axis points
   do not keep exactly the same size.
4. **With a traced lens**, *D* is the paraxial distance that the
   store stores (it does not ask the engine); wide open, the best focus falls millimetres
   from it, and the size in the image depends on the geometry, not on that.
5. **The *Lens* presets** (`camera/lens`) still frame the part
   as before, with the switch on or off; and the animation's `ZOOM` clips
   change the focal length without moving the camera (an animated *dolly zoom*
   would be another clip).
6. **The switch stays active** with orthographic and panoramic (it can
   be left on for when the camera returns to perspective); the line says that
   there is nothing to keep there.

**Gates.** `npm run engine:build` (the usual `rt.wasm`, `rt-simd.wasm` and `post.wasm`: the engine was not touched, so `cargo fmt`, `clippy` and the separate wasm build are not needed) and `npm run qa` green: types, build and 193 test files, 186 pass and 7 skipped, with 3191 tests (3160 pass, 31 skipped; before the phase 191 files), without repeating anything with `--maxWorkers=2`. `tests/focal-browser.test.ts` ran inside, in Chromium; `tools/focal-check.mjs` (20 of 20) on the built `dist/`.

## F1 · Focus by point and by object — **Opus** — done

**Request** (2026-10-17, after B1): clicking on a point still does not
focus exactly on that face, at that pixel — marked as crucial. In addition, a
second focus mode is wanted in which an object is focused, with both
modes available at once. And, about values: up and down arrows
on all values, or sliders where they suit better, with the focus
controls using both: a slider with the value beside it with up and down
(the same request as U15). It is item 1.8 of `TODO.md`: the exact pixel of the
exact view.

**What.** (1) That the click leave sharp, in the final render, exactly what
is under the pixel, in any view: *Fast* and *Full*, thin lens,
tilt and shift (O1), traced lens (O2), U13's aspect ratios,
looking through a saved camera, the timeline with the camera
animated, and after orbiting or zooming in. (2) Three focus modes per
camera: *Distance* (the usual one), *Point* (the picked point, which the focus
follows) and *Object* (a part, a group or the model).

**Measured first.** A scene built for it (`tests/browser/focus-scene.ts`):
a 1.3 mm checkerboard tilted 45° in depth that fills the frame, flat light,
135 mm at f/1.4 at 600 mm (the depth of field is a couple of
millimetres: a millimetre of error moves the sharp band several pixels). A
headless browser draws the preview and makes the click like the viewer
(`tests/browser/focus-page.ts`); Node applies the action, asks the engine for the
exact depth and circle-of-confusion passes of the *Full* view
(640 × 400) and of the final render (480 × 270) at the click's pixel, its own
focus for what that pixel sees (`rt_scene_pick`), and renders the final one with
`rt` to see where the sharp band falls (a band-pass contrast along the
depth gradient, the centre of the band, measured the same before and
after; the band measures ±15 px with the thin lens and ±25 px with the traced
ones wide open, and about ±2 px is measurement noise; `tests/focus-measure.test.ts`,
`REPACK_FOCUS_MEASURE=1`). Seven clicks per case (centre, edges, corners;
the band, at the centre and two corners). Before F1 (at `319614b`) and after,
sharp band in render pixels from the click, and focus error in mm:

| case | before | after |
| --- | --- | --- |
| thin lens | 0.00 mm; band −0.5 to −2 px | the same (B1's pick was already the pixel's) |
| tilt 6° | exact depth, but band at +34.5 and −36.5 px in the corners | −1 and −2 px |
| shift | 0.00 mm | 0.00 mm |
| double Gauss f/1.4 (O2) | band at −31 px in the centre, −42 and −50.5 px in the corners, the click outside it | +5, −14.5 and −13 px, the click inside the band in all three (its contrast, 88 % of the maximum) |
| Petzval (O2) | −31.5 px in the centre, −32.5 and −44.5 in the corners | −2, +14 and +11 px, the click inside the band |
| distortion +1 (O2) | *Full* −2.28 mm and the final −0.97 mm in the corner (the viewport was not the render); band −31, −16.5 and −52.5 px | both at 0.00 mm from the engine's focus; band +5.5 and −15.5 px, the click inside; bottom right, −38.5 px (see “did not fit”) |
| 1:1 and 9:16 active | 0.00 mm | 0.00 mm |
| looking through, 9:16 | *Full* up to 34.8 mm and 15 px of circle of confusion in the corner; the final, fine | 0.00 mm and 0.1 px in both |
| timeline, t = 1 with orbit | ±6.5 mm, 3–4 px of circle; band −24.5 and +19.5 px | 0.00 mm; band 0 and −1.5 px |
| orbiting 8° after the click | up to 16.9 mm, 8 px of circle; band ±42–44 px (at the click's pixel) | 0.00 mm where the point has gone (leaving the distance, as before, would leave it up to 10.3 mm off); band −1 to −1.5 px |
| zooming in 15 % after the click | 80–101 mm, 45–70 px of circle | 0.00 mm where the point has gone (left, 90 mm off) |
| moving the part 15 mm after the click | — | 0.00 mm (left, 15 mm off) |

**Measured causes** (the brief's hypotheses, h1–h6):

1. **h1, the tilt.** The click set the point's depth, but the tilted
   lens focuses the plane of the hinge rule, which passes through the
   point at another distance: `u (f − sin α (p · b)) = f z`. The engine and the
   interface now use the same rule (`Camera::focus_distance_to`,
   `core/focus.ts focusDistanceFor`, with a parity test against `rt.wasm`).
2. **h3, the traced lens.** It was focused paraxially, and wide open its
   spherical aberration and field curvature put its sharp image several
   millimetres further. The engine solves the distance with its own rays.
   The first criterion, the circle of least confusion, did not serve either (the
   render stayed soft at −27.5 px): the halo drags the least squares.
   The one that remains is the fine-detail contrast (10 and 5 line pairs per
   mm of the 36 mm frame, the maximum nearest the least confusion): for the
   case's double Gauss, 601.5 mm by least confusion and 609.7 mm by
   contrast, which is where the render's own samples give most contrast
   (607–610 mm). With a single frequency and the maximum of the whole stretch, a point
   near the top edge came out at 538 mm instead of 585 (a side lobe, spurious
   resolution, above a weak main one).
3. **h1, the viewport was not the render.** The *Full* viewport widens the sensor
   to cover the viewport, and the traced lens took from the viewport's sensor the
   semi-apertures, the height of its distortion and its vignetting: with distortion, the
   viewport's pixel did not see the same as the render's. `LENS` now carries
   `frame_sensor_mm`.
4. **h1, looking through.** The *Full* viewport of a camera looked through
   used the active camera's frame: with another aspect ratio, another sensor.
5. **h2 and h4, the pose and the tracking.** On the timeline the click
   measured from the stored camera, not from the camera at that instant; and after the click
   the distance stayed still when orbiting or zooming. *Point* mode fixes it:
   the distance comes out, at each instant, from the camera as it is and from the
   point where it is.
6. **h6, the face.** The preview draws only the front face of each
   triangle and its pick did not see the back of a single-sided surface,
   which the engine does render. The ray is now cast through both faces.
7. **h5, rounding:** not a cause (only of what is shown).
8. **Another appeared while measuring:** a traced lens **breathes** (its field changes
   with the focus), so what the pixel shows moves when the
   focus reaches it (0.9 mm of depth in the corner with the tilted
   checkerboard). The click settles: it is repeated with the camera already focused until
   the point stops moving (`settledFocusPick`).

**What was done.**

- **The engine** (`rt_core::focus`, ARCHITECTURE §5.2 septendecies):
  `rt_scene_pick` (the primary ray of an image point, that of
  `generate_ray` with the pupil at its centre, and what it hits through both faces)
  and `rt_scene_focus_at` (the distance that focuses a point); `LENS
  frame_sensor_mm`; the best focus of a traced lens by contrast.
  `tools/wasm-parity.mjs --pick` and CI pin the picks of the O1 and
  O2 scenes (`PINNED_FOCUS_PICK_O1`, `PINNED_FOCUS_PICK_O2`). No render
  hash changed.
- **The click** (`main.ts focusPickAt`): the scene of only the view's camera
  as `projectScene` writes it for *Full* (`io/rsb.ts focusPickRsb`:
  pose, camera looked through with its frame, viewport image around
  the frame), the engine's ray, cast against the preview's geometry
  through both faces (`PreviewEngine.pickAlong`), settled with a traced
  lens. Without `rt.wasm` or with an earlier one (detected by the name of the
  exports, with no new `rt_features` bit), the preview's pick
  and the paraxial distance.
- **The modes** (`CameraState.focusMode`, `focusPoint`, `focusObject`;
  SPEC §3.5): the point is stored in the part's coordinates; the distance is
  resolved where it is used (`resolvedFocusDistance`, and `focusDistanceAt(state,
  camera, t)` for the queue, batches and the render window); the store leaves
  the resting one in `focusDistance` (`syncFocus`). If the part or the
  object is deleted, the camera goes back to its last distance in the same action,
  with a notice. Earlier projects, saved cameras and library studios
  are read as *Distance*; round trip on saving and opening; all undoable.
- **The interface** (UI.md): *Focus* segmented *Distance · Point · Object*;
  the distance as a logarithmic slider with its field beside it (`slider`
  now admits its own scale, `scale`, and there is `lengthSlider`); in *Point*,
  *Focus with a click* (the same undo entry); in *Object*, choosing in the
  viewport or in the tree, with the name; *Keep in focus* in a part's
  menu; four commands in the palette; the point's mark in the viewport with the
  camera selected.

**Tests.** `tests/focus-modes.test.ts` (27: each lens's rule, parity
with `rt.wasm`, tracking when orbiting, zooming in, moving the part,
animating it and animating the camera, the focus clip, *Object*, the return to
*Distance* on deleting, no NaN, undo, old and damaged projects, the
mark, the slider, the ray of a camera looked through and that of a traced
lens in the viewport, the settling); `tests/focus-browser.test.ts` (9, with
Chromium: the click in the browser lands on the engine's focus for that pixel
in six cases, the exact depth with the thin lens, the sharp band of the
tilt by the click, and the viewport without engine); `rt-core focus::tests` (10,
among them that the render's own samples, through the focus, give more
contrast where the pick focuses); `tools/focus-click-check.mjs` (15
checks on the built interface). Each fix was checked by
undoing it: the corresponding test fails (the PR report lists them).

**What did not fit the plan:**

1. **The traced lens needs the engine to focus.** Without `rt.wasm` the
   distance is the paraxial one (millimetres off, wide open). With it, solving
   costs 0.4 to 0.6 s in the page with the machine loaded (and the settled click, up to three); the frames of
   a gesture use the last difference from the paraxial for that lens.
2. **The desktop has no call of its own**: the page carries its
   `rt.wasm`, the same `rt-core` the launcher renders with; there is no
   `/api/pick`.
3. **The artistic *swirl*** enters the best focus as in the image.
4. **The camera walk (N3) is not wired**: the hook
   (`focusDistanceAt`) is there; the queue and batches are touched by N2.
5. **The library's camera reader** (`io/library.ts`) still does not read
   a camera's optics (it already was so); it reads the focus modes.
6. **`slider()`** changed inside just enough: an optional scale
   (`toUnit`/`fromUnit`, 1000 positions), together with the arrows, the compact
   variant and U15's `setDisabled` (merged).
7. **A click on glass** focuses its front face, like the rest (decided).
8. **The corner of a traced lens with artistic distortion +1** (bottom right,
   at f/1.4) still has the band at −38.5 px from the click, outside it:
   the focus written is the engine's for that pixel (0.00 mm), so what
   does not match is the best-focus criterion with what the render sees there (a
   sensor point far out, with a lot of aberration); the other traced corners
   fall inside the band. The criterion was accepted; this corner stays
   open.
9. **`cargo test --workspace`** with the machine loaded: four tests of
   `rt-app` (downloads and updates with local servers, the
   adaptive one with several threads) and four of `rt-cli` (TIFF) sometimes fail and
   pass alone; they do not touch F1.

**With K3 and N2** (merged after the phase): the pick's ray is that of
`Camera::generate_ray` with the pupil at its centre, so orthographic, the
two panoramas and straight verticals pick by themselves. `Camera::focus_distance_to`
and `core/focus.ts focusDistanceFor` were extended: a panorama is
pinhole and its focus distance (and the pick's depth, like its
pass) is the distance to the point, also behind the camera; with straight
verticals the camera that is rendered is the levelled one (`renderedCamera`),
and the distance is that of that camera divided by cos(corrected tilt), a traced
lens solved on it. Tests: the pick and the primary ray in
`rt-core focus::tests` with orthographic, equirectangular and fisheye cameras;
the TS–`rt.wasm` parity and the click path, one per projection, in
`focus-modes.test.ts`. N2: the queue and batches already write the distance that
each camera follows (resolved by the engine boundary, `viewCamera`, with the
job's camera and pose); `batch.test.ts` checks it in a cameras × studios
batch and in the frames of an animation, and fails without that
resolution.

**With O4** (merged after the phase): *Through two points* leaves the camera in
*Distance* (it could follow a point or an object) in the same undo
entry, and with a traced lens it focuses on the mean of the distances
that the engine resolves for the two points with the chosen tilt (O4's
decision 3). The best focus of a tilted traced lens uses the
samples of the tilted lens (its grid of sensor limits); the interface's paraxial
rule for it is the simple lens's hinge, like O4's plane. The earlier
unused focus functions
(`camera.ts focusDistanceTo`, `interior-camera.ts focusDistanceFor`) were
removed; their tests point to `core/focus.ts focusDistanceFor`.

**Decisions** (2026-10-17, by the session lead; they were ◆): the *Object*
follows the centre of its box (the other two candidates remain written and unused); the slider's range and logarithmic scale, as they are; in
*Point* and *Object* the slider shows the distance that comes out and **moving it moves
the camera to *Distance*** from there, in a single undo entry (the
slider is not redrawn when the mode changes, so the drag
continues; `tools/focus-click-check.mjs` checks it); the best focus of a
traced lens by the contrast of 10 and 5 line pairs per millimetre, the maximum
nearest the least confusion (the corner with distortion +1 stays open);
a focus clip on a camera in *Point* wins, as now; a click on a
glass focuses its front face.

## Suggested order

1. **U1** (Opus) and **E1** (Sonnet), in parallel: the interface and the
   engine skeleton. Without the first there is nowhere to see anything; without the
   second there is nowhere to build the tracer.
2. **E2** → **E3** (Opus): acceleration and integrator. Meanwhile,
   **U2**, **I1** and **I3** (Sonnet): project in a file, OBJ and STL, and the
   rest of the importers with the import sheet. Import is
   the trunk: it goes ahead of everything that is not the engine.
3. **E4** (Opus): the engine in the browser. It closes v0.1 with a real render
   in the viewport and on the command line.
4. **U5** (render window), **I2** (STEP and IGES), **L4** (own
   lights): what makes it behave like KeyShot in daily use
   (U3 and U4 are already there).
4 bis. **First release `v0.1.0`**, on request: **U2**
   (project in a file), **X1 part A** (files and `sha256` of the
   models), **U6** (Settings and model manager), **P2** (launcher,
   portables and installer; the launcher and the native engine can start
   in parallel with U5) and **P1** (the release). L4 follows afterwards.
5. **E5** → **E6** → **L1** → **L2** → **L3**: light and materials
   until the 72 recipes are reviewed on the own engine.
6. **M1**, **N2**, **D1**, **P1**: they close v0.2.
7. **E7**, **M2**, **N1** → **N3**, **L5**, **E8**, **Q1**, **P2**,
   **X1** → **X5** (AI post-processing, `AI-POST.md`), and **K1** →
   **K2** → **K3** (scene type, room and interiors camera):
   v0.3.
8. **K4** → **K5**, **K6**, **K7**, **K8**: interiors and furniture, v0.4.
9. **H1** at the close of each version.
