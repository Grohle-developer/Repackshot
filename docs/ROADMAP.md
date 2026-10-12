# Roadmap — Repackshot

Qué hay que hacer, en qué orden, y **qué modelo ejecuta cada fase**. Es
autocontenido: cada fase se puede ejecutar leyendo este documento, los
que enlaza (`SPEC.md`, `ARCHITECTURE.md`, `UI.md`) y el repositorio.

---

## Contexto (leer siempre primero)

Repackshot es un renderizador de producto al estilo KeyShot, libre (MIT),
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
| **v0.1** — "parece el producto" | Abre en modo estándar; importa glTF, OBJ, STL, FBX, 3DM, 3MF, PLY, DAE y USD con la hoja de importación; tipo de producto, materiales del catálogo, montaje de luz; el motor en Rust renderizando progresivamente en el visor y a PNG, en el navegador y en la línea de comandos | F0, A1–A3, U1, U2, I1, I3, E1–E4 |
| **v0.2** — "sirve para trabajar" | STEP e IGES con caras CAD; herramienta de mover y operaciones de pieza al estilo KeyShot; focos propios y montajes guardados; biblioteca propia; vidrio y emisores reales, madera y tela, bisel, colocación por reflejo, campo claro, cielo, HDRI, miniaturas propias, recetas revisadas, cara CAD, cola y pases | I2, U3, U4, L4, E5, E6, L1, L2, L3, M1, N2, D1, P1 |
| **v0.3** — "sustituye al comercial" | Desgaste visible, texturas y etiquetas, animación y vídeo, luces IES, lotes nativos, escritorio | E7, E8, M2, N1, L5, P2, Q1 |

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

## U1 · La interfaz — **Opus** — abierta

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
trazador cuando se para*, y una acción `setEngine`. Los tipos `SceneNode`, `MaterialInstance`, `LightInstance`,
`CameraState`, `Shot`, `MotionClip`, `RenderJob` en `src/core/*.ts`,
exportados y documentados con una línea cada uno.

## U2 · Proyecto en archivo y límites — **Sonnet**

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

## I1 · Importadores OBJ y STL — **Sonnet**

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

## I2 · STEP e IGES — **Opus**

**Decisión tomada (Fable).** Se lee STEP (AP203, AP214, AP242) e IGES con
**OpenCascade** compilado a wasm a través de `occt-import-js` (envoltorio
MIT; OCCT es LGPL-2.1 con la excepción de Open CASCADE, que permite
enlazarlo sin contagiar la licencia del proyecto). Entra solo en la capa
`io/` del lado web, se carga **bajo demanda** al soltar el primer archivo
CAD (unos MB que no se pagan si no se usan), y el motor de render no lo
conoce. Un teselador de B-rep propio en Rust queda como idea para
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

## I3 · Importadores y hoja de importación — **Sonnet**

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

## E2 · Geometría y aceleración — **Opus**

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

## E3 · Integrador v1 — **Opus**

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

## E4 · El motor en el navegador — **Opus**

**Qué.** `src/io/rsb.ts`: escritor RSB en TypeScript desde el
`ProjectState` (mallas, materiales, rig resuelto por `setupRig`, cámara,
entorno, render), con test de paridad byte a byte contra el escritor de
`rt-core` (fixture generado por `rt --write-example`). `src/render/worker.ts`
y `src/render/pathtracer.ts`: pool de workers, cada uno con su `rt.wasm`
y su copia de la escena, baldosas intercaladas, acumulación y
transformada en el hilo principal, `status()` honesto (muestras, tiempo,
workers, SIMD disponible). Cambio automático *preview mientras se mueve,
trazador cuando se para*, con reinicio al cambiar cualquier cosa de la
escena; `setEngine` para forzar. *Render* y la cola usan el pool a la
resolución de salida y con el presupuesto. Si `rt.wasm` no está (no se
ha ejecutado `npm run engine:build`), la interfaz arranca solo con la
vista previa y el medidor lo dice.

**Depende de.** U1, E3.

**Criterio.** Paridad: la misma escena renderizada por `rt` y por el pool
en Chromium local (vía `tools/screenshot.mjs` con `?engine=pathtracer`)
da el mismo hash de imagen a 4 muestras; `tests/rsb.test.ts` en verde;
captura del visor convergiendo con el medidor mostrando muestras reales;
orbitar sigue siendo fluido.

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

## U3 · Herramienta de mover y operaciones de pieza — **Opus**

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

## U4 · Biblioteca propia — **Sonnet**

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

**Depende de.** E5, L2.

## M1 · Cara CAD entera — **Sonnet**

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

## N1 · Animación y vídeo — **Opus**

**Qué.** `evaluate(state, t)` completo para todos los `MOVE_KINDS`;
despiece (centro, disposición, factor); fundidos a color y cruzado (el
cruzado renderiza dos cámaras en la ventana de solape); conflicto visible
entre movimientos; *Construir vídeo*: un RSB por fotograma renderizado
por el pool de workers con el presupuesto de la barra de render y
codificación en el navegador (WebCodecs → WebM/MP4; secuencia PNG como
alternativa siempre disponible). Reproducción fluida en el visor con la
vista previa.

**Depende de.** U1, E4.

**Criterio.** Tests de `evaluate` con números (orbitar 90° en 4 s a mitad
con `EASE` da 45°); los 16 presets producen un estado válido en cada
fotograma; un vídeo de 2 s a 12 fps sale y se reproduce.

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

## P1 · Releases y demo pública — **Haiku**

**Qué.** Workflow de release: versión en `package.json`, etiqueta `vX.Y.Z`
creada al publicar (no antes), changelog desde la etiqueta anterior,
`dist/` adjunto; despliegue de `dist/` a GitHub Pages en cada push a
`main` para que la demo esté siempre viva. `docs/CHANGELOG.md`.

**Depende de.** U1.

**Criterio.** Una release de prueba `v0.1.0-alpha.1` publicada y retirada;
la página de Pages carga la interfaz.

## P2 · Escritorio con Tauri — **Opus**

**Qué.** Empaquetar la aplicación web con Tauri (Rust) para Windows,
macOS y Linux, enlazando `rt-core` **en nativo** (todos los hilos, sin
wasm) detrás de la misma interfaz `RenderEngine`, con diálogos nativos
de archivo, carpeta de salida y lectura de HDRI/modelos grandes sin
pasar por `<input>`. Sin cambios en `src/` más allá de `io/native.ts` y
`render/native.ts` detrás de las mismas interfaces que la web.

**Depende de.** v0.2 cerrada.

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

- **I2**: licencia y entrada de STEP, tras el informe.
- **Formatos nativos** (`.bip`, `.ksp`, `.sldprt`, `.ma`, `.ztl`, `.f3d`):
  decidido que **no** se leen (propietarios, sin especificación pública;
  leerlos exigiría analizar sus binarios, que las reglas de sala limpia
  prohíben). La entrada es lo que cada programa exporta (`SPEC.md` §5).
  Se revisa solo si aparece una especificación pública o una biblioteca
  MIT/Apache que los lea.
- **E4**: si el trazador en wasm no da interactividad suficiente en
  portátiles, mantener three.js como vista previa (la decisión actual) o
  pasar a trazado a baja resolución mientras se mueve y retirar three.
- **E8**: cómo renderiza `rt` una animación (portar `evaluate` a Rust o
  un RSB por fotograma).
- **L3**: los números de las recetas sobre el motor propio.
- **E7**: umbrales del desgaste sobre la hoja de contactos.
- **UI**: si tras U1 el inspector contextual necesita una pestaña
  *Biblioteca* separada (la decisión de `UI.md` es que no; se revisa con
  uso real).

---

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
4. **I2** (STEP e IGES), **U3** (mover y operaciones de pieza), **U4**
   (biblioteca) y **L4** (focos propios): lo que hace que se comporte
   como KeyShot en el día a día.
5. **E5** → **E6** → **L1** → **L2** → **L3**: la luz y los materiales
   hasta que las 72 recetas estén revisadas sobre el motor propio.
6. **M1**, **N2**, **D1**, **P1**: cierran v0.2.
7. **E7**, **M2**, **N1**, **L5**, **E8**, **Q1**, **P2**: v0.3.
8. **H1** al cierre de cada versión.
