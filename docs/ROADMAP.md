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

## E5 · Dieléctricos, emisores, barniz, cielo, HDRI — **Opus**

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

## X2 · Pases del motor para la IA — **Opus**

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

## X3 · Tubería de post-procesado y guarda — partida en X3a–X3d

Decisión del líder (`AI-POST.md` §7): en escritorio todo nativo (la
página solo envía ajustes y recibe resultados), la guarda en un *crate*
propio sin dependencias, y la web detrás.

### X3a · `rt-post`: la guarda y los píxeles — **Opus**

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

### X3b · stable-diffusion.cpp en escritorio — **Opus**

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

### X3c · La tubería completa de escritorio — **Opus**

**Qué.** `AI-POST.md` §7.3: `/api/ai/post` en el lanzador (pases
guardados del render → `rt-post` → stable-diffusion.cpp por mosaico →
`rt-post` → reintentos), progreso y cancelación; el `AiPostService` de
escritorio en `src/io/`; integración en la cola (el trabajo guarda las
dos imágenes y el informe; el historial las conserva); `AI_AVAILABLE`
pasa a ser lo que diga `status()`.

**Depende de.** X2, X3a, X3b; X4 para verlo de punta a punta.

**Criterio.** De punta a punta con el proceso auxiliar falso: un render
final con IA deja dos imágenes y el informe en el historial; con
intervención 0, la imagen de la IA es la del motor bit a bit; cancelar a
mitad deja la del motor; un modelo que la compilación no carga sale con
el motivo. Lista corta de comprobación para el equipo del usuario (Vulkan,
una imagen de 1024², tiempo anotado).

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

## X4 · Interfaz del post-procesado — **Sonnet**

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
Hošek–Wilkie (tras confirmar la licencia de las tablas; si no,
Preetham) e HDRI con CDF 2D; rectángulos y discos por ángulo sólido;
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
- **Interiores** (`INTERIORS.md`): licencia exacta de las tablas de
  Hošek–Wilkie (si no se confirma, Preetham); si se activa el aislamiento
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
| **P3a** | Opus | Modo Completo que no se para (reproducir con una sesión larga de cambios contra el lanzador y arreglar la causa), *Pausar* / *Reanudar* / *Iniciar cola* que funcionan en web y escritorio |
| **P3b** | Opus | Escritorio sin rastro de navegador: diálogos nativos de carpeta y archivo desde el lanzador (PowerShell en Windows, `zenity`/`kdialog` en Linux, sin `unsafe`), escritura de renders, proyectos y modelos por el lanzador, menú contextual, selección, traducción, zoom, recarga, impresión, búsqueda y navegación del navegador desactivados, icono y título propios; estudio de WebView2 para Windows |
| **P3c** | Opus | **Ventana propia en Windows** (decisión del líder tras la captura del aviso «¿Desea salir de la aplicación?» de Edge: *todos los avisos y ventanas con nuestra interfaz, nada de avisos web; producto cerrado y profesional*): ventana Win32 sin marco con **WebView2** (el motor de Edge que trae Windows 10/11) y barra de título dibujada por nosotros (título, minimizar, maximizar, cerrar, arrastre), menús contextuales, atajos, barra de estado, zoom, autorrelleno, traducción, descargas y diálogos de script del navegador **desactivados por la API**, y el cierre (botón, `Alt F4`, barra de tareas) **interceptado** para preguntar con nuestra propia ventana si hay cambios sin guardar; Edge `--app` solo como respaldo automático si falta el *runtime*. En Linux sigue Chromium en modo aplicación con el endurecimiento de P3b hasta P3d (ventana propia con WebKitGTK, que exige un binario glibc y no el musl estático) |
| **P3e** | Opus | **Escritorio: todo sobre el lanzador** (decisión del líder tras «se pisa el texto» y «dice no pillar la GPU por ser browser»: *en escritorio la página es solo interfaz*): una costura de plataforma con implementación web y de lanzador; ajustes, biblioteca, historial, miniaturas, equipo y espacio usado en la carpeta de datos por el lanzador; puerto estable por carpeta de datos; ni una fila que hable del navegador; filas de Ajustes que no se pisan |
| **U7** (hecha) | Sonnet | Arrastrar un material (miniatura del catálogo o de *Míos*) sobre una pieza del visor o del árbol, con resaltado (`UI.md` §2.3), y **M1** (cara CAD entera y *Separar por caras CAD*), más selección por caja con `Ctrl/⌘` + arrastrar. Ver U7 y M1 más arriba |
| **E5** | Opus | Ya descrita: vidrio y transmisión, barniz, emisores reales, cielo, HDRI, imagen de fondo |
| **E5b** | Opus | Reflejo del suelo, efectos de imagen (halo, nitidez, saturación, contraste, viñeta), región de render, pases (alfa, profundidad, normales, id de pieza), cáusticas y *denoise* propio |
| **E6**, **E7** | Sonnet, Opus | Ya descritas: madera, tela, bisel, subsuperficie, anisotropía; desgaste visible en motor y visor |
| **L4**, **L5** | Opus, Sonnet | Ya descritas: focos propios (área, punto, foco, sol) con todas sus operaciones; IES |
| **M2** | Opus | Ya descrita: texturas de imagen y etiquetas |
| **N1**, **N2** | Opus, Sonnet | Vídeo codificado (WebCodecs y muxers MP4 y WebM propios) y lo que quede de pases y lotes |
| **U8** | Sonnet | Lo pequeño de la interfaz: copia automática y recuperación, letras de acceso en menús, cambiar atajos, *Buscar actualizaciones*, los chequeos del Doctor que faltan y sus *Arreglar* (**D1**) |
| **X1b–X4** | Fable, Opus, Sonnet | Ya descritas: el post-procesado IA completo (X3 partida en X3a–X3d, `AI-POST.md` §7) |

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

Orden: oleada 1 **P3a**, **P3b**, **U7**, **E5** en paralelo; oleada 2
**E5b**, **E6**, **L4**, **N1**, **U8**; oleada 3 **E7**, **M2**, **L5**,
**N2**. El post-procesado IA, **adelantado a petición del usuario (2026-10-13)**: **X3a**, **X3b** y **X4** ya; **X2** al fusionarse E5; **X3c**, **X3d** y **X1b** detrás (`AI-POST.md` §7.6). Cada fase quita sus
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
