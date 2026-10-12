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
- `src/render/` — motores detrás de `RenderEngine` (`ARCHITECTURE.md` §5)
- `src/ui/` — la interfaz (`UI.md`)
- `tests/` — vitest; `tools/screenshot.mjs` — captura con Chromium local
- `.github/workflows/qa.yml` — la suite corre en cada pull request

**Reglas de trabajo no negociables** (ampliadas en `../CLAUDE.md`):

1. Ningún cambio se entrega sin `npm run qa` en verde.
2. Todo bug corregido lleva su test de regresión, comprobado que falla
   si se reintroduce el bug.
3. Una fase por PR; al cerrarla se marca aquí con un párrafo de qué se
   hizo y qué no encajó con el plan.
4. Cromo acromático; cadenas en `es` y `en`; todo por el *store*; claves
   de catálogo estables; sin binarios ni recursos de KeyShot.
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
  decisiones acopladas: la interfaz, el trazador de caminos, los
  importadores complejos, la animación. Lee la fase, la ejecuta entera y
  anota lo que no encajó.
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
| **v0.1** — "parece el producto" | Importar glTF, tipo de producto, materiales del catálogo, montaje de luz, render progresivo a PNG en el visor | F0, A1–A3, U1, U2, I1, R1 |
| **v0.2** — "sirve para trabajar" | Vidrio y emisores reales, madera y tela, bisel, colocación por reflejo, campo claro, cielo, miniaturas propias, recetas revisadas, cara CAD, cola y pases | R2, R3, L1, L2, L3, M1, N2, D1, P1 |
| **v0.3** — "sustituye al comercial" | Desgaste visible, texturas y etiquetas, animación y vídeo, STEP, escritorio | R4, M2, N1, I2, P2, Q1 |

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
con `world: 'SKY'`); 77 materiales en 7 categorías; 8 ópticas; 15
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
R1 solo tenga que añadir una segunda implementación y una acción
`setEngine`. Los tipos `SceneNode`, `MaterialInstance`, `LightInstance`,
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

## I2 · STEP — **Opus**, tras informe de licencia (**Fable** decide)

**Qué, primera parte (informe).** Un agente Sonnet redacta
`docs/notes/step-import.md`: opciones para leer STEP en el navegador
(`occt-import-js` sobre OpenCascade, licencias exactas de cada capa,
tamaño del WASM, calidad del teselado, alternativas), y una
recomendación. **Fable decide** si entra, con qué licencia y cómo se
aísla (módulo cargado bajo demanda, nunca en el paquete base).

**Qué, segunda parte (si procede).** `src/io/step.ts` como carga diferida,
con las caras CAD originales conservadas como rangos de triángulos (lo
que necesita M1 para "una cara de CAD es una cara").

## R1 · Trazador de caminos v1 — **Opus**

**Qué.** `src/render/pathtracer/`: el motor que hace que el visor sea el
render. WebGPU con *fallback* a WebGL2 (o `three-gpu-pathtracer` como
motor provisional detrás de la misma interfaz, si la implementación
propia no llega a tiempo: se anota cuál es). BVH en GPU; BSDF de
principio físico (difuso Lambert/Burley + especular GGX con Fresnel +
metal) con rugosidad y color; luces de área rectangulares, cuadradas y de
disco con muestreo explícito (NEE) y MIS contra el BSDF; sol direccional
con disco angular; cúpula procedural de estudio como luz de entorno con
muestreo por importancia; suelo con sombra de contacto y opción de solo
sombra (fondo transparente); acumulación progresiva con reinicio al
cambiar algo; exposición y transformada de vista del estado; `pick` por
rayo. Entra como motor por defecto cuando WebGPU está disponible; la
vista previa se queda para orbitar si el dispositivo no llega.

**Depende de.** U1.

**Criterio.** `tests/pathtracer/`: furnace test (esfera blanca en entorno
uniforme converge a la radiancia del entorno ±1 %), esfera difusa bajo luz
de área contra la solución analítica del factor de forma (±2 %), espejo
plano que refleja la cúpula con el gradiente correcto (media de tres
franjas), energía conservada con rugosidad 0 → 1 (la imagen no gana luz).
Las pruebas se ejecutan con Chromium local (`--enable-unsafe-webgpu` o
swiftshader para WebGL2) y se saltan con aviso si no hay GPU. Hoja de
contactos `tools/contact-sheet.mjs`: 16 estudios × 12 montajes elegidos,
con media, quemados y tapados por imagen, como la de EZ Packshot; se
adjunta al PR como `out/contact-sheet.html`.

**Qué no tocar.** Las recetas (`src/data/`): si un montaje sale mal, se
anota para L3, no se cambia.

## R2 · Dieléctricos, emisores, barniz, cielo — **Opus**

**Qué.** Transmisión con IOR y absorción (vidrio, acrílico, policarbonato,
vidrio tintado), rugosidad en transmisión; barniz (coat) como capa
dieléctrica; anisotropía; subsuperficie aproximada (difusión por
*random walk* corto o perfil de Burley); emisores de cuerpo negro y
color; control de cáusticas (AUTO sigue al tipo de producto); cielo
procedural (modelo de literatura pública: Preetham o similar con
atribución) para `world: 'SKY'`, con el sol del rig; HDRI de archivo
(RGBE y EXR mediante decodificador propio o licencia compatible) con
rotación e intensidad; fondo de imagen. Denoise ligero propio al terminar
(filtro guiado por normales y albedo, opcional).

**Depende de.** R1.

**Criterio.** Vidrio en furnace test con absorción cero no pierde energía
(±2 %); una esfera de vidrio frente a un panel con `camera = true` produce
el campo claro del montaje BACKLIT; test de cielo: luminancia del cenit
frente a horizonte en el orden esperado y color del sol de 5200 K; hoja de
contactos con los tres montajes SKY y los de campo claro.

## R3 · Madera, tela y bisel en el sombreado — **Sonnet**

**Qué.** Portar las recetas procedurales de EZ Packshot (veta de anillos
con dos colores, variación, ruido axial y poro; trama de hilos con tipo
de tejido, hilos por cm y relieve) como funciones de sombreado del
trazador, con escala en tamaños de pieza; bisel de aristas en el
sombreado (normal redondeada cerca de aristas vivas, radio en mm) para
que un CAD no delate el render. La pelusa queda fuera (fase propia si
hace falta).

**Depende de.** R1.

**Criterio.** `shadereval`-like: evaluar las funciones en CPU sobre un
plano y comprobar estadísticas (periodo de anillos, contraste, media de
rugosidad); captura de las 13 maderas y las 12 telas como esferas de
catálogo; el bisel cambia la normal solo a menos del radio de una arista
viva (test con un cubo).

## R4 · Desgaste visible — **Opus**, con visto bueno **Fable**

**Qué.** Los ocho tipos de desgaste de `src/data/wear.ts` como capas del
sombreado (aristas por curvatura y bisel, arañazos por curva de nivel de
ruidos estirados, huellas, polvo por normal hacia arriba, suciedad por
oclusión, pátina por manchas, micro-rugosidad, abolladuras), con la
escala física, semilla y variación por pieza de la receta. Calibración:
Opus implementa y Fable ajusta umbrales sobre una hoja de contactos de
desgaste (materiales × básicos). Después del visto bueno, el panel de
desgaste deja de decir *próximamente*.

**Depende de.** R3.

**Criterio.** Hoja `out/wear-sheet.html`; con el maestro a 0 la imagen es
idéntica a sin desgaste (test de píxeles); el mismo material en dos piezas
con `wearPerObject` no repite el patrón (correlación baja entre máscaras).

## L1 · Colocación por reflejo, campo claro, luces editables — **Sonnet**

**Qué.** Colocación por reflejo exacta con `pick` del motor (reflejar el
rayo de cámara en la normal picada y poner el foco a su distancia);
campo claro por entorno para `camera = true` (disco suave en coordenadas
de ventana, radio aparente a partir del tamaño y la distancia del panel,
radiancia acotada), de modo que ningún foco se vea nunca como objeto con
bordes; edición foco a foco con `modified`; *Restablecer montaje*.

**Depende de.** R1.

**Criterio.** Test geométrico: con una esfera y un clic en su punto
(x, y), el foco acaba en la dirección reflejada (producto escalar > 0.999);
captura de BACKLIT, SILHOUETTE y ECLIPSE con el disco visible y sin
rectángulos.

## L2 · Miniaturas propias — **Sonnet**

**Qué.** `tools/render-thumbs.mjs`: renderiza con el propio motor (Chromium
local) las 72 miniaturas de montaje (160 × 120 y 64 × 64) con la pieza de
ejemplo en gris neutro, y las esferas de los 77 materiales, con el hash
de su receta en un chunk `tEXt` del PNG; `--check` falla si alguna está
desactualizada y la suite lo ejecuta. Sustituye las PNG portadas de EZ
Packshot en `public/thumbs/`.

**Depende de.** R2 (para que las de color y vidrio salgan bien).

**Criterio.** `--check` en verde en CI; cambiar un número de un montaje
sin regenerar hace fallar la suite.

## L3 · Revisión fotográfica de las recetas — **Fable**

**Qué.** Con la hoja de contactos de R1/R2 y las miniaturas de L2, revisar
los 72 montajes y los 16 rigs de tipo de producto sobre el motor propio y
ajustar **solo datos** (`src/data/light-setups.ts`, `studios.ts`). Lo que
se mide: un brillo por fuente con la forma de la fuente; menos del 1 % de
píxeles de la pieza quemados a exposición 0; luminancia media de la pieza
dentro de ±0.3 EV entre montajes del mismo tipo de producto; nada de
zonas negras por encima del 5 % en fondos claros; la miniatura tiene el
brillo donde el render.

**Depende de.** R2, L2.

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
sustrato). Es la función más usada de packaging y cosmética.

**Depende de.** R2.

**Criterio.** Captura con una botella etiquetada; test de proyección caja
(un cubo recibe la textura sin estirar en las seis caras); el proyecto
guarda las imágenes embebidas.

## N1 · Animación y vídeo — **Opus**

**Qué.** `evaluate(state, t)` completo para todos los `MOVE_KINDS`;
despiece (centro, disposición, factor); fundidos a color y cruzado (el
cruzado renderiza dos cámaras en la ventana de solape); conflicto visible
entre movimientos; *Construir vídeo*: fotogramas por el motor con el
presupuesto de la barra de render y codificación en el navegador
(WebCodecs → WebM/MP4; secuencia PNG como alternativa siempre disponible).
Reproducción fluida en el visor con la vista previa.

**Depende de.** U1, R1.

**Criterio.** Tests de `evaluate` con números (orbitar 90° en 4 s a mitad
con `EASE` da 45°); los 15 presets producen un estado válido en cada
fotograma; un vídeo de 2 s a 12 fps sale y se reproduce.

## N2 · Cola, pases y lotes — **Sonnet**

**Qué.** Cola de render con progreso y cancelación sobre `render()` del
motor; pases alfa, profundidad, normales e id de pieza como salidas
opcionales (PNG 16 bits o EXR); lote cámaras × estudios con nombre de
archivo por plantilla (`{proyecto}_{camara}_{estudio}`); descarga en ZIP
propio (sin dependencia: el formato *store* de ZIP es trivial).

**Depende de.** R1.

**Criterio.** Tests de nombre de archivo y de cola (orden, cancelar el
segundo deja el tercero); un lote de 2 × 2 produce 4 imágenes.

## D1 · Doctor de motor — **Sonnet**

**Qué.** Los chequeos que dependen del motor: dispositivo (WebGPU
disponible, caída a WebGL2 avisada), denoise, transformada de vista,
cáusticas (fireflies: muestras aisladas muy brillantes detectadas en la
acumulación), formato de salida de vídeo, tiempo estimado frente al
presupuesto. *Arreglar todo* en un clic.

**Depende de.** R1.

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

**Qué.** Empaquetar la aplicación web con Tauri para Windows, macOS y
Linux, con diálogos nativos de archivo, carpeta de salida y lectura de
HDRI/modelos grandes sin pasar por `<input>`. Sin cambios en `src/` más
allá de una capa `io/native.ts` detrás de la misma interfaz que la web.

**Depende de.** v0.2 cerrada.

## Q1 · Vista en sección — **Sonnet**

**Qué.** Plano de corte por clic + eje, por dos puntos, o animado como un
movimiento más (`MOVE_KINDS` gana `SECTION`); se implementa en el
sombreado del trazador (descartar la parte del plano, tapar con el color
del material) y en la vista previa con `clippingPlanes` de three.

**Depende de.** R1, N1.

## H1 · Accesibilidad e i18n — **Haiku**

**Qué.** Orden de foco de todos los paneles, `aria-label` en cada icono,
contraste ≥ 7:1 verificado por test sobre los *tokens*, `prefers-reduced-motion`,
revisión de las cadenas `es` (acentos, tono) y `en`, documentación
sincronizada con lo hecho (README, SPEC) tras cada hito.

**Depende de.** U1; se repite al cierre de cada versión.

---

## Decisiones pendientes de Fable (no adelantar)

- **I2**: licencia y entrada de STEP, tras el informe.
- **R1**: si el trazador propio no cierra en un PR razonable, aceptar
  `three-gpu-pathtracer` como motor provisional y en qué condiciones se
  sustituye.
- **L3**: los números de las recetas sobre el motor propio.
- **R4**: umbrales del desgaste sobre la hoja de contactos.
- **UI**: si tras U1 el inspector contextual necesita una pestaña
  *Biblioteca* separada (la decisión de `UI.md` es que no; se revisa con
  uso real).

---

## Orden sugerido

1. **U1** (Opus): la interfaz. Sin ella no hay dónde ver nada.
2. **U2** e **I1** (Sonnet), en paralelo: proyecto en archivo, OBJ y STL.
3. **R1** (Opus): el trazador. Cierra v0.1 con un render de verdad.
4. **R2** → **R3** → **L1** → **L2** → **L3**: la luz y los materiales
   hasta que las 72 recetas estén revisadas sobre el motor propio.
5. **M1**, **N2**, **D1**, **P1**: cierran v0.2.
6. **R4**, **M2**, **N1**, **I2**, **Q1**, **P2**: v0.3.
7. **H1** al cierre de cada versión.
