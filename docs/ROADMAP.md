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

## E5b-1 · Cáusticas y *denoise* propio — **Opus**

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

## E6 · Madera, tela y bisel en el sombreado — **Sonnet**

**Qué.** Portar a `rt-core` las recetas procedurales de EZ Packshot (veta
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

## L4 · Focos propios — **Opus**

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

## L5 · Luces IES — **Sonnet**

**Qué.** Lector propio del formato IES LM-63 (texto público) en
`rt-core`, foco de tipo IES en el motor y en la vista previa (aproximado
por un foco direccional con la intensidad del eje), sección RSB propia,
y el tipo en *+ Añadir luz*.

**Depende de.** L4, E5.

**Criterio.** Dos perfiles IES de prueba escritos a mano; la intensidad
muestreada a 0°, 30° y 60° coincide con el archivo.

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

## U10 · Recorrido guiado y avisos de la IA — **Sonnet**

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

## M2 · Texturas de imagen y etiquetas — **Opus**

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

## N1 · Animación y vídeo al estilo KeyShot — **Opus**

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

## D1 · Doctor de motor — **Sonnet**

**Qué.** Los chequeos que dependen del motor: `rt.wasm` cargado y
número de workers (y aviso si el navegador solo da uno), SIMD disponible
en wasm, denoise, transformada de vista, cáusticas (fireflies: muestras
aisladas muy brillantes detectadas en la acumulación), formato de salida
de vídeo, tiempo estimado frente al presupuesto. *Arreglar todo* en un
clic.

**Depende de.** E4.

**Criterio.** `tests/doctor-engine.test.ts` con un motor falso que simula
cada estado; cada chequeo se dispara y se limpia.

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

## K1 · Tipo de escena, luz de interior y Doctor de interiores — **Sonnet**

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

## Q1 · Vista en sección — **Sonnet**

**Qué.** Plano de corte por clic + eje, por dos puntos, o animado como un
movimiento más (`MOVE_KINDS` gana `SECTION`); se implementa en el
integrador (descartar la parte del plano, tapar con el color del
material) y en la vista previa con `clippingPlanes` de three.

**Depende de.** E3, N1.

## H1 · Accesibilidad e i18n — **Haiku**

**Qué.** Orden de foco de todos los paneles, `aria-label` en cada icono,
contraste ≥ 7:1 verificado por test sobre los *tokens*, `prefers-reduced-motion`,
revisión de las cadenas `es` (acentos, tono) y `en`, documentación
sincronizada con lo hecho (README, SPEC) tras cada hito.

**Depende de.** U1; se repite al cierre de cada versión.

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
