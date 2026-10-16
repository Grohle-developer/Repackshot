# Triaje del «Reporte de errores graves — Render IA y errores anteriores»

Fuente: `docs/TODO.md` desde la línea 260, tal cual. Código leído en `main`
(`72e4f79`, rama `ccr-8df3f848-6ukiky`); O2 leído en `/home/user/Repackshot-o1`
(rama `o1`, `c416f2f`, sin fusionar). No se ha tocado código ni documentos.
Pruebas hechas en una copia de trabajo propia (scratchpad `triage/`): la
compilación de la interfaz en `triage/dist`, `triage/focus-repro.mjs` (Chromium
local), `triage/dn/` (renders de `rt` con y sin *denoise*, `dnstats.py`,
`clamp.py`) y `triage/vt/fabric.test.ts` (vitest con su propia configuración).
Ese *scratchpad* es efímero (se pierde con la sesión): lo que hace falta de
él lo reescribe la fase que lo usa (B1: la comprobación de navegador del
enfoque y el test de la tela).

Clasificaciones: **bug** (el código no hace lo que dicen los documentos),
**falta** (no se construyó, o está marcado *próximamente*), **decisión**
(necesita criterio fotográfico, visual o de arquitectura antes de construir;
regla 11: la toma el responsable, aquí solo se preparan los datos).

---

## 1.1 · Editores de materiales: tipo de mapeado, tamaño y desplazamiento

**Qué hay hoy.**
- *Inspector ▸ Texturas* (M2a, hecha) ya tiene el mapeado común del material:
  *Proyección* (UV, Caja, Plana, Cilíndrica, Esférica), *Eje*, *Juego de UV*,
  *Tamaño* en mm con *Ajustar a la pieza*, *Giro*, *Desplazamiento* U/V,
  *Repetición* U/V y *Bordes* (`src/ui/panels/insp-textures.ts:131-224`;
  acciones `texture/setMapping`, `src/core/textures.ts:633`). **Pero el bloque
  solo aparece cuando alguna ranura tiene imagen** (`insp-textures.ts:344`,
  `any ? mappingBlock(...) : null`): en un material sin imagen no hay ningún
  mando de mapeado a la vista.
- El editor de nodos (M3a) tiene el nodo *Mapeado* con las mismas proyecciones
  más *Objeto (3D)*, tamaño, giro, desplazamiento y repetición
  (`src/data/material-nodes.ts:207-224`).
- **En *Completo* y en *Render* nada de esto se ve**: las texturas las pinta el
  motor en M2b, en cola (ROADMAP §M2b, l. 3234; nota del inspector
  `texture.engineNote`, `src/ui/strings.ts:3118`, «próximamente»). Como el
  visor arranca en *Completo* por defecto (`src/ui/ui-state.ts:505`), quien
  cambie el mapeado en el modo por defecto no ve ningún efecto.
- No hay proyección llamada «triplanar»: *Caja* es la mezcla triplanar por
  |n|⁴ en *Rápido* (`render/texture-shader.ts`), y en un programa de nodos
  toma solo la cara dominante (M3a, «no encajó» 2). Sin mando de ancho de
  mezcla.
- El inspector edita solo el mapeado común; el propio de cada ranura solo se
  puede devolver al común (`insp-textures.ts:117-126`), aunque el *store* ya
  lo admite (M2a, «no encajó» 3).
- No hay herramienta interactiva de mapeado en el visor (mover, girar o escalar
  la proyección sobre la pieza): solo las etiquetas se mueven
  (`ui/panels/viewport-labels.ts`).
- Las familias procedurales no tienen mapeado: la madera solo *Escala*
  (`woodScale`, `src/core/materials.ts:147`; la médula se orienta sola por el
  lado más largo, E6), la tela solo *Hilos por cm* (`:166`), sin eje, giro ni
  desplazamiento.
- O2 no lo toca.

Lo que el usuario pide «como KeyShot»: por su documentación pública (a
comprobar por observación, regla 1) KeyShot ofrece además *Triplanar*,
*Cámara* y *Nodo* como tipos de mapeado, una herramienta de mapeado
interactiva en el visor, ajustar a la geometría y sincronizar el mapeado de
todas las texturas de un material.

**Reproducción.** Confirmado leyendo el código (las líneas de arriba). No se
puede afirmar qué editor miraba el usuario: si fue un material sin imagen, el
bloque no existe; si fue en *Completo*, existe pero no hace nada visible.

**Clasificación.** **falta** (con una parte de **decisión**: qué conjunto de
mandos «al estilo KeyShot» se añade y si las familias procedurales ganan
mapeado propio, que cambia el `PATN` de E6).

**Arreglo propuesto.** (a) M2b (L, fase): el motor lee `IMGS` y el mapeado de
`MATL`. (b) Interfaz (M): enseñar el mapeado aunque no haya imagen solo si
hay algo que mapear (nodos o procedural), editar el mapeado propio de cada
ranura, nombre y mando de *Triplanar* (mezcla), y una herramienta de mapeado
en el visor. (c) Mapeado de la madera y la tela (M, toca `PATN` y
`rt_core::pattern`).

**Dependencias.** M2b (E6 y E9 ya están: desbloqueada), M3b para los nodos,
5.1 (tamaño relativo). (b) puede salir sola; (a) y (c) no.

---

## 1.2 · Ambiente: forma de gota y geometrías variadas

**Qué hay hoy.** S4a (hecha): una forma por efecto, *Punto/esfera*, *Copo/disco*
o *Estela/cápsula* (`src/data/effects.ts:48`; `FXAM.shape`,
`engine/crates/rt-sim/src/params.rs:24` y `:63`, «the geometric shape of every
particle of an effect»). Las primitivas las fijó S0, decisión 4 (esfera, disco
orientado, cápsula) (ROADMAP §S0). No hay gota ni mezcla de formas dentro de un
efecto. S4b (en cola) toca la lluvia y las gotas (lóbulo hacia delante, sin
cáusticas), no la forma. O2 no lo toca.

**Reproducción.** Confirmado por código: no existe ninguna forma de gota.

**Clasificación.** **decisión**. Preguntas abiertas: (1) qué es «gota»: la
lágrima icónica (no física: una gota de lluvia real es esférica hasta ~1 mm y
se aplana por debajo, como un pan de hamburguesa, por encima de ~2 mm) o la
forma física; (2) «que varíen de geometrías»: mezcla aleatoria de las formas
existentes por partícula (barata: el motor ya tiene las tres), o formas nuevas
(gota, malla del usuario como confeti), que amplían la decisión 4 de S0.

**Arreglo propuesto** (tras la decisión). Mezcla de formas por partícula: M
(`FXAM` con pesos por forma, `rt-sim` elige por la semilla, `rt-core`, visor
Rápido con `InstancedMesh`). Primitiva de gota nueva: M–L (intersección propia
en `rt-core/geometry/particles.rs` con su test de energía, `rt-sim`, `FXAM`,
paridad wasm y *hashes*).

**Dependencias.** S0 (decisión de Fable), S4b (mismo código: hacerlo después o
dentro). No sale como arreglo suelto.

---

## 1.3 · Lentes: elegir lente, distorsión y bokeh naturales

**Qué hay hoy (main).** *Cámara ▸ Lente* es una lista de 8 `LENS_PRESETS` que
solo ponen focal y f/ (`src/data/lenses.ts:9-16`;
`src/ui/panels/insp-scene.ts:495-505`). Las 16 prescripciones de A6
(`src/data/lenses.json`) están en datos pero no se pueden elegir. O1 (lente
fina) da formas de bokeh, ojo de gato aproximado, anamórfico, *tilt-shift*,
aberración cromática y remolino, **solo en *Completo* y en el render**
(`camera.dofNote`, `src/ui/strings.ts:557`: «el modo Rápido no la dibuja»);
una lente fina no distorsiona. Además, 11 de los 16 tipos de producto van a
f/8, 3 a f/11 y 2 a f/5,6 (`src/data/studios.ts`): con esa profundidad de
campo el bokeh apenas se ve. Eso explica «hay algún efecto pero no se nota».

**O2 lo cubre casi entero**: *Lente fina · Lente trazada*, carácter, las 16
lentes trazadas superficie a superficie, distorsión, viñeteo, ojo de gato,
burbuja, cremoso y remolino por la propia lente, tipos de bokeh de la lente
trazada, y en *Rápido* distorsión y viñeteo aproximados (Repackshot-o1,
ROADMAP §O2 «Hecho»; UI.md *Cámara ▸ Lente*). Lo que queda: la fusión, el
veredicto de Fable sobre la hoja (O2, «no encajó» 11), el ruido del bokeh
trazado (unas cinco veces la varianza de la lente fina con las mismas
muestras, «no encajó» 2) y la inclinación sin trazar («no encajó» 3).

**Reproducción.** Confirmado por código en main.

**Clasificación.** **falta**, cubierta por O2 (pendiente de fusión y de
veredicto).

**Arreglo propuesto.** Fusionar O2. Aparte (S): que los tipos de producto o la
nota de la cámara digan que con f/8 el bokeh no se verá (o un aviso del Doctor);
el criterio de f/ es fotográfico y no se cambia aquí.

**Dependencias.** O2, veredicto de Fable. Nada que sacar suelto antes.

---

## 1.4 · Ventana con los elementos al pasar el ratón por la lente

**Qué hay hoy.** En main, nada. En O2 el corte en SVG se dibuja **dentro** de
la sección *Lente*, para la lente puesta, con lo que el motor ha preparado
(escala a la focal, enfoque, semiaperturas: `src/ui/components/lens-section.ts`,
«drawn from the lens as the engine prepared it»; `src/ui/panels/insp-traced.ts:193`
en Repackshot-o1). No hay ventana flotante al pasar por una lente de la lista.

**Reproducción.** Confirmado por código (O2).

**Clasificación.** **falta**, parcialmente cubierta por O2 (el dibujo existe;
el *hover* no).

**Arreglo propuesto** (S–M, tras O2). Un aviso flotante sobre cada entrada de
*Lente* (y los chips) con el SVG. Decisión técnica menor: para una lente que
no está puesta no hay `LensInfo` del motor; o se le pregunta al motor por la
lente señalada (`rt_scene_lens_info`, asíncrono, con caché por clave), o se
dibuja desde la prescripción sin enfocar ni escalar (no sería «lo que se
traza»). Toca `insp-traced.ts`, `lens-section.ts`, cadenas `es`/`en`, una
comprobación en `tools/lens-check.mjs`.

**Dependencias.** O2. No antes.

---

## 1.5 · Editor de lentes: editar elementos, tamaños, distancias, añadir, girar 180°

**Qué hay hoy.** O2 hizo el editor de O5 (carácter, corte, ajustes *no físico*,
*Guardar lente como…*), pero **una lente propia guarda la clave del catálogo y
sus ajustes, no una copia de las superficies** (O2, «no encajó» 5). Solo el
hueco variable de la lente blanda se edita. La prescripción viaja entera en
`LENS` (O2: «la página escribe los mismos bytes para las 16 lentes»), así que
el motor no debería necesitar formato nuevo; no lo he comprobado con una
prescripción editada.

**Reproducción.** Confirmado por los documentos y el código de O2.

**Clasificación.** **decisión**. Preguntas: (1) si una lente propia pasa a ser
una prescripción completa editable (cambia el tipo `lens` de la biblioteca de
U4/O2 y su validación al importar); (2) qué se garantiza de una lente editada
(que forme imagen, sin reflexión total, semiaperturas válidas; si pierde la
marca `verified` y pasa a `own-design`); (3) qué mandos: radio, grosor, hueco,
vidrio (nd, vd), semiapertura, añadir y quitar elemento, «girar 180°»
(invertir el orden de las superficies y el signo de las curvaturas del
elemento o del grupo); (4) si el motor recalcula los números al vuelo (cada
edición es un `LensInfo` nuevo).

**Arreglo propuesto.** Una fase propia (L): modelo de prescripción editable en
`src/core/traced-lens.ts`, validación paraxial en la página o en el motor,
editor en la sección *Lente* con el corte interactivo, biblioteca, tests de
ida y vuelta y de que una lente invertida dos veces es la misma.

**Dependencias.** O2 (fusión) y la decisión.

---

## 1.6 · Las maderas no se ven como en las esferas; ningún material funciona con los nodos

**Qué hay hoy.**
- **Nodos en *Rápido***: el grafo se hornea en mapas de 512² que entran por las
  ranuras de M2a (color, rugosidad, metal, normal, alfa, emisión); las demás
  salidas van con su media, Fresnel a 60° y curvatura 0; lo 3D es un corte
  frontal dibujado como caja (M3a «Hecho» y «no encajó» 3;
  `src/render/graph-preview.ts`).
- **Nodos en *Completo* y *Render***: solo la media de cada salida
  (`src/io/rsb.ts:1057`, `flattenGraph`), y un material de nodos no lleva
  `PATN` (`rsb.ts:1216`). Lo dice la interfaz (`src/ui/strings.ts:717`). Con el
  visor en *Completo* por defecto (`ui-state.ts:505`), **un grafo no tiene
  ningún efecto espacial en el modo por defecto**: es exactamente «ningún
  material está funcional respecto a los nodos». M3b (el motor evalúa grafos)
  está en cola, tras M2b.
- No hay nodo *Madera* ni *Tela*: pasar una madera o una tela del catálogo a
  *Nodos* da el grafo mínimo con su color plano (`src/core/material-graph.ts:365`
  y `minimalGraph`, `:425`), así que en *Completo* pierde anillos, poros, nudos
  y tejido (documentado en el comentario de `outputSetup`).
- **Madera**: en *Rápido*, color medio y nudos oscurecidos
  (`src/render/materials.ts:122-129`; nota `material.fullOnly`,
  `strings.ts:742`); en *Completo*, la veta de E6 a escala física (anillos de
  2 a 5 mm según la especie). Las esferas del catálogo son de three.js
  (`src/render/thumbs.ts`, `applyMaterial`): color plano. Las esferas con veta
  que el usuario vio pueden ser la hoja de E6 (`rt --pattern-sheet`, esferas y
  cajas de 60 × 40 × 25 mm) o las esferas de 64 × 64 de las tarjetas del
  editor de nodos (intérprete en CPU con el ruido 3D exacto), que en *Rápido*
  se ven como corte frontal y en *Completo* como media. El veredicto de M3a ya
  dejó dicho que la madera de `MATERIAL_GRAPHS` tiene que parecerse a la
  familia *Madera* y que eso lo mira M3b.

**Bug encontrado de paso (confirmado con un test).** `outputSetup` de la tela
usa `(a + b) / 2` (`material-graph.ts:405`) en vez de `fabricMeanColor` (la
parte de la cara de la urdimbre por tejido, `src/core/materials.ts:187`), que
es lo que usan el motor, *Rápido* y las miniaturas. Su propio comentario dice
que el grafo mínimo recibe «the values the engine and the preview read».
Pasar a *Nodos* cambia el color: vaquero (`DENIM`, sarga 3/1) de
(0,276, 0,318, 0,407) a (0,380, 0,410, 0,470), es decir, vuelve al gris
azulado que E6 corrigió; raso Δ 0,029; microfibra Δ 0,007; las demás, igual
(`triage/vt/fabric.test.ts`). Se escapó porque los tests de
`tests/material-graph.test.ts:238-250` solo comprueban la ida y vuelta, no que
el grafo mínimo dé el mismo material al motor.

**Reproducción.** Nodos: confirmado por código. Madera: no puedo saber qué
esferas miraba el usuario ni en qué modo; sin su escena, no confirmado.
Tela → nodos: confirmado con el test de arriba.

**Clasificación.** **falta** (M3b; *Rápido* aproxima), con un **bug** suelto
(el color de la tela al pasar a nodos) y una **decisión** (si M3b añade nodos
*Madera* y *Tela* que expongan las recetas de E6, para que «todos los
materiales» funcionen con nodos).

**Arreglo propuesto.**
- Bug (S): `outputSetup` FABRIC con `fabricMeanColor(p)`. Test que fallaría:
  para cada `MATERIAL_PRESETS`, `materialToRsb({ ...m, graph: minimalGraph(m) }).baseColor`
  igual a `materialToRsb(m).baseColor` (falla hoy en `DENIM`, `SATIN`,
  `MICROFIB`).
- M3b (L, fase): intérprete del programa en `rt-core`, con la prueba cruzada
  TS/Rust de M3a; nodos de E6 si se decide.
- Mientras tanto (S): que la tarjeta y la sección del material digan, en
  *Completo*, que el grafo se ve como media (ya está en el editor; comprobar
  que se ve en el inspector).

**Dependencias.** M2b → M3b; E6 (hecha). El bug sale solo.

---

## 1.7 · Focal: interruptor entre acercar la cámara o el objeto enfocado

**Qué hay hoy.** El campo *Focal* despacha `camera/set { focalMm }`
(`insp-scene.ts:506`): la cámara no se mueve y el sujeto cambia de tamaño
(zoom puro, `src/core/camera.ts:332-339`). Elegir un preset de lente hace otra
cosa: `camera/lens` llama a `frameActive` (`camera.ts:366-371`), que vuelve a
encuadrar todo, mueve la distancia y **pone el foco en la distancia de
encuadre** (`frameBox`, `camera.ts:199`). No hay modo «conservar el tamaño del
sujeto» (*dolly zoom*); solo existe como movimiento de animación
(`contra_zoom`, `src/data/camera-moves.json:74-83`: dolly 40 % más focal × 0,6).
O2 no lo toca (mismo `camera/set` en Repackshot-o1).

**Reproducción.** Confirmado por código.

**Clasificación.** **decisión**. Preguntas: (1) qué se conserva en el modo
«la cámara se acerca»: el tamaño del plano del objetivo (`target`) o el del
punto enfocado (`focusDistance`) (no son lo mismo tras *Enfocar con clic*);
(2) valor por defecto del interruptor y si es por cámara (se guarda en el
proyecto) o de la interfaz; (3) si el preset de lente debe seguir el mismo
interruptor en vez de reencuadrar siempre; (4) qué hace en ortográfica (nada).
Dato: para conservar el tamaño en el plano a distancia `d`,
`d' = d · f'/f` y `focusDistance' = focusDistance · f'/f` si el foco sigue al
sujeto; la cámara de L4 bloqueada no puede moverse.

**Arreglo propuesto** (S, tras decidir). Campo en `CameraState` o ajuste,
`camera/set` con la regla, el interruptor junto a *Focal*, cadenas, test de
que el tamaño proyectado del objetivo no cambia.

**Dependencias.** Ninguna; sale sola.

---

## 1.8 · Enfocar con clic no enfoca en el píxel clicado

**Qué hay hoy.** SPEC §3.5: «*Enfocar con clic*: el punto picado fija la
distancia de enfoque». El pico sí es el del píxel: `clickAt`
(`src/ui/panels/viewport-overlays.ts:593-603`) toma el punto con el
*raycaster* de la vista Rápida (`src/render/preview.ts:1811`) y la distancia
a lo largo del eje (`focusDistanceTo`, `camera.ts:123`, el arreglo de v0.1.6).
La proyección de Rápido cubre todo el lienzo con el marco de U13 centrado
(`preview.ts:1155-1171`), y la imagen de *Completo* cubre el mismo lienzo
(`src/io/rsb.ts:1275-1286`), así que el marco no introduce desplazamiento
(como mucho medio píxel CSS, porque `resize` usa `clientWidth` entero y
`local()` el rectángulo fraccionario: `viewport.ts:68`,
`viewport-overlays.ts:424-427`).

**El fallo está después**: el mismo clic deshace el enfoque. OrbitControls
dispara `end` en cada `pointerup` aunque no se haya movido nada
(`node_modules/three/examples/jsm/controls/OrbitControls.js:1608-1621`, oyente
en `document`, `:1562`), después del oyente del lienzo que enfoca;
`preview.ts:473-476` lo pasa a `onViewChange`, y `src/main.ts:1066` construye
el parche con **`focusDistance: v.distance`**. `sameView` (`camera.ts:291`)
compara también el foco, que ya no es la distancia de órbita, así que despacha
*Mover la cámara* con el foco devuelto al objetivo. Lo mismo pasa con un foco
tecleado: cualquier clic en el visor (seleccionar una pieza) lo devuelve a la
distancia de órbita. El camino de *Mirar a través* tiene el mismo patrón
(`src/core/view-objects.ts:222`), y el del *gizmo* de cámara ya hace lo
correcto: el foco sigue a la distancia solo si la seguía
(`view-objects.ts:139-140`).

**Reproducción.** Reproducido en Chromium con la compilación de main
(`triage/focus-repro.mjs`): con *Enfocar con clic* activo y un clic sobre el
frasco del ejemplo, el campo *Distancia de enfoque* pasa por
**688 → 660 → 688** y la entrada de deshacer queda en *Deshacer: Mover la
cámara*; un foco tecleado de 638 vuelve a 688 tras un clic en la escena. La
rama de O2 tiene la misma línea (`src/main.ts:1115` en Repackshot-o1).

**Clasificación.** **bug**.

**Causa.** `src/main.ts:1062-1070`: el parche de la vista pone siempre
`focusDistance: v.distance` y un clic sin movimiento cuenta como cambio de
vista.

**Arreglo propuesto** (S). Una función pura en `src/core/camera.ts` (p. ej.
`orbitPatch(cam, view)`) que devuelva `null` si azimut, elevación, distancia,
objetivo y ancho ortográfico no cambian, y que mueva el foco solo si seguía a
la distancia (la regla de `view-objects.ts:139-140`); usarla en `main.ts`
(`onViewChange` y `gestureView` de `onGesture`, `:1079`) y en
`lookThroughAction`. Tests: en `tests/camera-focus.test.ts`, (1) una vista
igual a la de la cámara con foco ≠ distancia no da parche (falla hoy), (2) una
órbita con el foco siguiendo lo mueve, (3) una órbita tras un enfoque con clic
lo conserva; y una comprobación de navegador (`tools/`, como
`focus-repro.mjs`) que hace el clic real y lee el campo.

Dos fallos menores del mismo camino, leídos en el código y no reproducidos:
(a) `clickAt` mide desde `activeCamera(s)` (`viewport-overlays.ts:600`)
aunque la vista sea la de otra cámara (*Mirar a través*) o la de un plano de la
animación con el cabezal fuera de 0 (`preview.ts:1136-1146`): debería usar la
cámara vista (`viewedCamera`) y su id; (b) con *tilt* (O1) el plano de foco
gira alrededor del punto del eje, y un punto fuera del eje no queda en él.
**Riesgo con O2**: *Rápido* dibuja la distorsión de una lente trazada como
pase de pantalla (`render/lens-profile.ts`), pero `pick` sigue usando el rayo
sin distorsión (`preview.ts:1842` en Repackshot-o1): con un gran angular o el
ojo de pez el punto picado no será el que está bajo el cursor. Afecta también
a `glyphAt`, al *gizmo* y a la selección por caja.

**Dependencias.** Ninguna para el arreglo principal (sale solo, también sobre
O2). El riesgo de distorsión, con O2.

---

## 1.9 · aintfilm: doble barra vertical en el carrusel de LUTs

Fuera de este repositorio según el reporte; solo se anota. Un dato: Repackshot
sí dibuja el carrusel de recetas del plugin de película (*Ventana de render ▸
Plugins*, `src/ui/panels/plugin-recipes.ts`), pero es horizontal y su tira
lleva `overflow-y: hidden` (`src/ui/render.css:452-456`). Si la captura del
usuario fuera de la ventana de render de Repackshot y no de aintfilm, el fallo
sería de aquí. No comprobado.

---

## 2.1 · El Render IA no hace casi nada

**Qué hay hoy.** La guarda (X3a, `rt-post`) deja pasar solo un cambio suave de
luz y color, con topes que escalan con los mandos y la *Intervención*. Valores
por defecto (`src/core/ai.ts:46-51`): Intervención 30, Luz 50, Rebotes 40,
Desgaste 20, Fuerza del estilo 30. Con `MAX_STRENGTH = 0.4`
(`engine/crates/rt-post/src/job.rs:12`), el modelo trabaja a fuerza
img2img **0,12**. Los topes del primer intento (`prepared.rs:61-71` con
`Tolerances::PROVISIONAL`, `job.rs:145-160`) son: luz local
0,5 × 0,3 × 0,3 = 0,045 en logaritmo natural (**±4,6 %** de luminancia),
rebotes 0,4 × 0,3 × 0,15 = 0,018 (**±1,8 %** de color), estilo ±1,8 %,
desgaste 0,9 %; y cada material queda dentro de ΔE₀₀ medio 2 y p95 3, al 80 %
de margen (`guard.rs:47`, `MARGIN`). Cada reintento multiplica todo por 0,6
(`RETRY_FACTOR`, `job.rs:17`); el cuarto, a 0,216 del primero. Si ningún
intento pasa, se entrega la imagen del motor sin cambios. Todos esos números
están marcados *provisionales* y los fija Fable en X1 parte B con la hoja
comparativa que el usuario ejecuta en su equipo (ROADMAP §X1, parte B, no
hecha; CHANGELOG v0.1.6: «las tolerancias de la guarda son provisionales»).

**Reproducción.** No hay GPU ni modelo aquí; confirmado por código y por la
aritmética de arriba: con los valores por defecto el cambio permitido es casi
imperceptible por construcción.

**Clasificación.** **decisión** (X1 parte B, Fable): los topes `cap_*`, los ΔE,
`MAX_STRENGTH` y los valores por defecto de los mandos. Opciones: subir los
topes y la fuerza; que *Intervención* 100 signifique un cambio visible (hoy
±35 % de luz y ±16 % de color en el mejor caso); o separar los topes de
materiales críticos (etiquetas, logotipos) de los demás. Hecho que ayuda: la
única pasada real (SD 1.5 en CPU, Intervención 100) pasó al primer intento con
ΔE₉₅ 1,9 y la guarda limitó el suelo al 71 % (ROADMAP §X3c).

**Arreglo propuesto.** Tras la hoja de X1b: cambiar `Tolerances::PROVISIONAL`
y los valores por defecto (S), con los tests de `rt-post` que fijan las
constantes al día. Mientras tanto (S): que el informe diga cuánto se aplicó
(ya dice «La IA se limitó al N %») también cuando se acepta al primer intento
con los topes al máximo.

**Dependencias.** X1 parte B. No sale suelto.

---

## 2.2 · Se queda en un bucle de intentos

**Qué hay hoy.** El bucle tiene tope: `rt-app/src/ai/post.rs:883-1001` repite
mientras `rt_post::accept` diga `Retry`, y `accept` solo lo dice si
`attempt + 1 < MAX_ATTEMPTS` (4) (`rt-post/src/lib.rs:459-468`; y rechaza
`attempt ≥ MAX_ATTEMPTS`, `:318`). Lo fijan tests (`rt-app/tests/ai_post.rs:338`,
`rt-post/src/tests.rs:672-674`). La página espera hasta un estado final
(`src/io/ai-post.ts:216-224`). La cola repite el paso por cada variante de X4b
(`src/ui/render-queue.ts:188-223`): con N variantes son hasta 4 × N intentos,
cada uno con todos sus mosaicos. La fila dice «IA · mosaico i de n · intento a»
sin «de 4» ni el motivo del fallo (`src/ui/panels/queue.ts:36-50`), y la barra
se acerca a 1 sin llegar en cada reintento (`post.rs:997`).

**Reproducción.** **No reproducido** (sin modelo ni GPU). No he encontrado en
el código un bucle sin fin. Lo que el usuario ve como bucle puede ser:
(1) todos los intentos fallan en la misma comprobación, que bajar la fuerza no
arregla, y con variantes el ciclo vuelve a empezar; (2) en CPU cada intento
tarda minutos por mosaico (la única pasada real: 53 s para 256 × 192); (3) en la
vista previa de la ventana de render, la vigilancia de `u.models`
(`src/ui/panels/ai-post.ts:419-430`) llama a `preview.touch()` con cada
instantánea del gestor de modelos, que durante una descarga llega cada 200 ms
(`src/io/downloads.ts:131`, `:608-620`): la vista previa se abandona y vuelve a
empezar sin terminar nunca (hipótesis leída en el código, no probada). Para
reproducirlo hace falta el registro del lanzador
(`<datos>/logs/repackshot.log`): cada intento fallido deja
«AI post N: attempt k failed: <motivo>» (`post.rs:991-995`), con el número de
variantes, el motor de ejecución (CPU o GPU) y el tamaño del trabajo.

**Clasificación.** **bug** provisional (el usuario describe algo que no acaba,
contra el contrato de §7.2 de AI-POST), pendiente de reproducir. Si el
registro enseña que acaba a los 4 intentos, pasa a **falta** (lo que la cola
cuenta) más la decisión de 2.1.

**Arreglo propuesto.** (a) S: «intento a de 4», la variante, y el motivo del
último fallo en la fila y en el aviso final; la barra repartida por intentos.
(b) S: la vista previa no se reinicia por instantáneas del gestor que no
cambian `installed` ni `ready` (comparar esos campos, no el objeto); test con
el controlador y un reloj falso (`AiPreviewController` ya se prueba así).
(c) Lo que diga el registro.

**Dependencias.** 2.1 (si fallan todos los intentos, es la guarda), X1b.

---

## 3.1 · Cola: vista en tiempo real del render seleccionado

**Qué hay hoy.** La fila de la cola solo enseña miniatura cuando el trabajo ha
terminado (`src/ui/panels/queue.ts:86-99`); mientras corre, estado y barra.
`FrameRequest.onProgress` da números, no imagen (`src/ui/ports.ts:262-288`).
El render nativo es progresivo y publica fotogramas (`engine/crates/rt-app/src/render.rs:1-36`,
los que usa el visor *Completo* en `src/render/native.ts`); en la web, el
*pool* de `src/render/tiles.ts`. U5 no lo planeó y UI.md §2.5 no lo menciona.

**Reproducción.** Confirmado: no existe.

**Clasificación.** **falta**. Queda por precisar (lo dice el propio reporte):
solo el trabajo en curso o también los terminados (estos ya abren el visor de
resultados), y a qué tamaño.

**Arreglo propuesto** (M). Un `onFrame` en `FrameRequest` (escritorio: el
fotograma del trabajo de `/api/render`; web: la acumulación del *pool* cada
cierto tiempo), un panel o el visor de resultados en modo «en curso» al
seleccionar la fila, con su coste medido (no frenar el render). Test de la cola
con un render falso que entrega fotogramas.

**Dependencias.** U5 (hecha), N2 (en cola, toca la cola). Sale sola.

---

## 4.1 · Se guarda `.repack.json` y no `.repack`

**Qué hay hoy.** Es lo documentado: `.repack.json` en U2 (ROADMAP l. 285-322),
SPEC §3.9 (l. 1221), ARCHITECTURE §8 y UI.md (l. 121). En el código:
`PROJECT_EXTENSION` (`src/ui/commands.ts:516`, con el comentario «it is JSON,
so `.json` alone is not enough»), `isProjectFile` (`:519`), el selector web
(`src/io/project-file.ts:66`, `:90`), el filtro del diálogo de escritorio
(`src/io/desktop-files.ts:297`), el lanzador (`engine/crates/rt-app/src/files.rs:54`,
`dialogs.rs:898`) y su prueba con Wine (`packaging/wine-dialogs.mjs:77-81`).
Además el lanzador solo escribe extensiones de una lista que no tiene `repack`
(`files.rs:40-41`, `WRITABLE_EXTENSIONS`): guardar `.repack` en escritorio
sería rechazado. Ningún instalador asocia la extensión al programa.

**Reproducción.** Confirmado por código.

**Clasificación.** **decisión** (cambia el contrato de U2; regla 12): (1) si el
contenido sigue siendo JSON y solo cambia la extensión; (2) si se siguen
abriendo los `.repack.json` (lo natural: sí, y soltarlos en la ventana);
(3) si se registra la extensión en el instalador de Windows y la entrada de
Linux (doble clic abre Repackshot); (4) tipo MIME para el navegador.

**Arreglo propuesto** (S–M). Las constantes de arriba, `WRITABLE_EXTENSIONS`,
los filtros y `accept` aceptando las dos, los tests de `files.rs` y
`dialogs.rs`, la prueba de Wine, y los documentos. Asociación de archivos: M
(NSIS y `.desktop` con MIME).

**Dependencias.** U2, P2 y P3e (diálogos del lanzador). Sale sola tras decidir.

---

## 4.2 · El *denoise* lava luces y colores y quita personalidad

**Qué hay hoy.** `rt_post::denoise` (E5b-1): à-trous de 5 pasadas guiado por
albedo, normal, profundidad e ids, con la parada de luminancia de SVGF, sobre
luz lineal (también en la página: `src/render/denoise.ts`), nunca en espacio de
pantalla. Dos cosas que quitan energía o color a propósito: el **recorte de
luciérnagas**, que baja a 4× de su vecino más brillante cualquier píxel que lo
supere en la misma superficie, sin mirar su varianza ni las muestras, y cuyo
exceso «se pierde» (`engine/crates/rt-post/src/denoise.rs:121-126`, `:512-548`);
y una parada de bordes **solo de luminancia** (`SIGMA_LUMINANCE`, `:50`): dos
luces de igual brillo y distinto color sobre una superficie se pueden mezclar.
Valores por defecto: *denoise* en visor y render, intensidad 100
(`src/core/render.ts:94`), el visor con el filtro ligero de U11 (3 pasadas,
`denoise.rs:86-89`). Lo que cambió hace poco y puede confundirse con el
*denoise*: U11 (el visor reduce ruido siempre, en directo), el filtro de píxel
*Fine* (Blackman–Harris de 3 px) por defecto desde E11
(`src/core/antialias.ts:24`), que suaviza, y la compensación de energía de
E9a (+13 a 16 % de luz en las escenas fijadas).

**Medido** (`triage/dn/`, `rt` de main, 480 × 360, TIFF de 32 bits lineal):
- Frasco de ejemplo contra una referencia de 4096 muestras: a 16 y 256 muestras
  el *denoise* no cambia la luminancia media (0,21368 y 0,21377 frente a
  0,21374), ni la saturación media (0,1985 frente a 0,1984), y la energía del
  0,1 % más brillante queda a −0,35 % a 256 muestras; el gradiente medio en
  pantalla, −4 % frente a la referencia (no emborrona de más). relMSE: de
  0,00226 a 0,0002 a 16 muestras.
- Escena de vidrio y cáusticas de E5b: a 256 muestras, luminancia media
  −0,33 %, energía del 0,1 % más brillante −1,8 %, máximo −6,7 %, saturación
  +0,45 %; de 2236 píxeles por encima de 1,0, 32 bajan más de un 25 % (los
  brillantes conservan el 97,4 % de su energía). A 16 muestras, luminancia
  media −2,1 % y los brillantes conservan el 77,6 % (parte es ruido).

**Reproducción.** **No reproducido** en las escenas del motor: no hay
desaturación medida y la pérdida en las luces es pequeña a 256 muestras, algo
mayor a pocas muestras (la del visor). La escena del usuario puede tener lo
que estas no tienen: brillos de un píxel de luces pequeñas (joyería, metal
pulido, copos de pintura), justo lo que el recorte de luciérnagas trata como
ruido aunque esté convergido, o luces de colores (sets `POP_COLOR`,
`WARM_COOL_CINEMA`). Para reproducirlo: su escena con *Guardar también sin
denoise* (los dos ficheros del mismo render) y si lo ve en el visor o en el
render final.

**Clasificación.** **decisión** de criterio visual, tras medir: el código hace
lo que dice E5b-1 (incluido perder la energía de las luciérnagas). Opciones:
(1) recortar solo píxeles con varianza alta o por debajo de N muestras;
(2) añadir crominancia a la parada de bordes; (3) bajar la intensidad por
defecto de U11b; (4) filtro *Standard* por defecto si la queja es la nitidez.

**Arreglo propuesto.** S: reproducir con la escena del usuario y medir qué
mecanismo es (con `--denoise-strength`, `--pixel-filter` y el recorte apagado
en una copia). Después, S–M en `denoise.rs` con *hash* nuevo de
`PINNED_DENOISED_EXAMPLE_4SPP` y un test de un brillo de un píxel convergido
que conserve su energía (fallaría hoy).

**Dependencias.** E5b-1, U11, U11b, E11. Sale solo.

---

## 5.1 · Los materiales no se ajustan al tamaño del sólido

**Qué hay hoy.** Todo tamaño de material es absoluto, por decisión documentada:
- Imágenes: `sizeMm` en mm (SPEC §3.3, l. 446-457: «por qué el tamaño va en
  mm y no en tamaños de pieza»). La primera imagen pone el tamaño de la
  escena entera, `scene.partSizeMm` (`src/core/textures.ts:621`), no el de la
  pieza que lleva el material; *Ajustar a la pieza* usa el lado mayor de las
  piezas que lo llevan, a mano (`insp-textures.ts:169`,
  `src/ui/texture-commands.ts:94-103`). El plan de M2a decía «escala (mm o
  tamaños de pieza)»; se construyó solo mm.
- Madera y tela: escala física por decisión del líder en E6 («La escala es
  física, no en tamaños de pieza»; SPEC l. 101-105).
- Nodos: las coordenadas de objeto en mm × 0,01 (`OBJECT_SCALE`,
  `src/core/material-program.ts:201`).
- Solo UV se adapta sola (las UV de la malla).

Incoherencia de documentos de paso: SPEC l. 456 dice que «el procedural
(desgaste, veta y trama de E6) sigue en tamaños de pieza», contra SPEC l. 101
y E6.

**Reproducción.** Confirmado por código: es el comportamiento documentado.

**Clasificación.** **decisión** (contradice decisiones del líder en M2a y E6).
Preguntas: ajuste dinámico siempre o con un interruptor por material
(*Tamaño: mm · relativo a la pieza*); con un material compartido por piezas de
tamaños distintos, ¿relativo a cada pieza (el motor necesita la caja de cada
instancia al sombrear) o a la escena?; y qué gana si el usuario fija un tamaño
a mano (lo pregunta el propio reporte). Para la madera y la tela, si una
receta física puede tener modo relativo sin dejar de parecer madera.

**Arreglo propuesto.** Tras decidir: unidad «tamaños de pieza» en
`TextureMapping` y en el nodo *Mapeado* (M, interfaz y RSB de M2b), y en `PATN`
si alcanza a E6 (M). S, independiente de la decisión: que la primera imagen
tome el tamaño de las piezas que llevan el material (`materialPartSize`) y no
el de la escena, como ya hace el botón (contradice el comentario «one repeat
spans the part» solo cuando la pieza es más pequeña que el modelo; la SPEC
dice «tamaño de la pieza», que define como el del modelo, así que también es
de decidir).

**Dependencias.** M2b (el motor tiene que leerlo), E6, M3b, 1.1.

---

## 6.1 · Los presets de estudio, fuera de *Luces*, dentro de *Estudios*

**Qué hay hoy.** Los 16 sets de L6 son montajes de luz de estilo `SETS`
(`src/data/light-setups.ts:31`, `:101-444`) y se eligen en *Escena ▸ Luz*,
primero y en grande: dos columnas cuadradas frente a tres a 4:3
(`src/ui/panels/insp-scene.ts:289-299`, `large: st.style === 'SETS'`;
UI.md l. 542-547). La pestaña *Estudios* del panel izquierdo es otra cosa:
estudios guardados por el usuario (cámara, montaje, entorno, materiales)
(`src/ui/panels/scene.ts:364-420`; UI.md l. 248-250). Y *Producto ▸ Crear
estudio* monta el tipo de producto, que desde L6 toma las luces de un set
(`src/data/studios.ts:11`, `PRESET_SETS`).

**Reproducción.** Confirmado: es lo que L6 diseñó.

**Clasificación.** **decisión** (L6 fue diseño de Fable). Preguntas: qué es
«estudios» para el usuario (la pestaña de estudios guardados, la sección
*Producto* con *Crear estudio*, o una sección nueva); si un set deja de ser un
montaje de luz y pasa a ser un estudio (decoración + sus luces + cámara
sugerida) con los montajes de luz como capa aparte.

**Arreglo propuesto.** Tras decidir: M (mover la rejilla de sets, sus filtros y
*En el set*; claves estables, regla 7).

**Dependencias.** L6; va con 6.2 y 6.3.

## 6.2 · Elegir estudio con muestras del tamaño actual

**Qué hay hoy.** Las miniaturas grandes son las de `thumbs cols-2` de los sets
(`insp-scene.ts:297`), 256 × 256 renderizadas por el motor.

**Clasificación.** **decisión** (parte de 6.1); una vez decidido, S (la misma
rejilla grande donde vaya).

## 6.3 · Las luces propuestas se añaden al estudio, sin interferir, y se apagan fácilmente

**Qué hay hoy.** Elegir cualquier montaje (set o no) **sustituye todas las
luces**, focos propios incluidos: `studio/setSetup` y `studio/applySetup`
ponen `lights: lightsFromRig(...)` (`src/core/lighting.ts:602-629`,
`lightsFromRig` en `:160`), con una confirmación si el montaje estaba
modificado (`src/ui/commands.ts:1766-1777`); un set además cambia su
decoración (`src/core/sets.ts:633-645`). Apagar luces de una en una ya existe
(`LightInstance.enabled`, `lighting.ts:51`; interruptor por luz en la pestaña
*Luces*, UI.md l. 229-231).

**Clasificación.** **decisión** (modelo de luces): si las luces se agrupan
(las del estudio y las de cada montaje añadido, con su interruptor de grupo),
qué pasa con *Restablecer al montaje* y *modificado*, cómo lo guarda el
proyecto y la biblioteca, y cómo lo ve el Doctor (exposición con más luces).
Dato: «añadir sin interferir» duplica luz; los sets están calibrados en
exposición para sus propias luces (L6, `exposureEv`).

**Arreglo propuesto.** Tras decidir: M (grupos de luces en el *store*,
`lightsFromRig` que añade, la lista con grupos, migración de proyectos, tests
de deshacer). K8 (grupos de luz tras el render) es vecino.

**Dependencias.** L6, L4; con 6.1.

---

## Hallazgos fuera de los ítems

- **Enfoque con clic**, además del bug de 1.8: mide desde la cámara activa al
  mirar a través de otra o en un plano animado (`viewport-overlays.ts:600`), y
  con O2 el pico no deshace la distorsión de *Rápido*.
- **Tela a nodos**: el color cambia (1.6), test incluido.
- **SPEC l. 456** contradice a SPEC l. 101 y a E6 sobre la escala del
  procedural (5.1).
- **M2a** prometía «mm o tamaños de pieza» y solo hizo mm, sin anotarlo en «no
  encajó» (5.1).
- **Lanzador**: `WRITABLE_EXTENSIONS` no admite `repack` (4.1).

## Tabla

| Ítem | Clasificación | Tamaño | Depende de | Orden |
| --- | --- | --- | --- | --- |
| 1.8 Enfocar con clic | bug (reproducido) | S | — (riesgo con O2) | 1 |
| 1.6b Tela a nodos cambia de color | bug (test) | S | — | 2 |
| 2.2 Bucle de intentos | bug provisional, sin reproducir | S (diagnóstico y rótulos) | registro del usuario, 2.1, X1b | 3 |
| 4.2 *Denoise* lava luces y colores | decisión, sin reproducir (medir primero) | S + S–M | E5b-1, U11, U11b, E11 | 4 |
| 1.3 Elegir lentes, distorsión, bokeh | falta (O2 la cubre) | — (fusionar O2) | O2, veredicto Fable | 5 |
| 1.4 Ventana de elementos al pasar el ratón | falta | S–M | O2 | 6 |
| 1.1 Mapeado en los editores | falta (+ decisión menor) | L (M2b) + M (interfaz) | M2b, M3b, 5.1 | 7 |
| 1.6 Nodos y maderas | falta (+ decisión: nodos de E6) | L (M3b) | M2b → M3b | 8 |
| 3.1 Cola en vivo | falta | M | U5, N2 | 9 |
| 2.1 La IA no hace casi nada | decisión | S tras la hoja | X1 parte B | 10 |
| 6.1–6.3 Estudios y luces añadidas | decisión | M | L6, L4 | 11 |
| 1.7 Focal: acercar cámara o sujeto | decisión | S | — | 12 |
| 4.1 `.repack` | decisión | S–M | U2, P2/P3e | 13 |
| 5.1 Tamaño relativo al sólido | decisión | M | M2b, E6, M3b | 14 |
| 1.2 Gota y formas variadas | decisión | M–L | S0, S4b | 15 |
| 1.5 Editor de elementos de lente | decisión | L | O2 | 16 |
| 1.9 aintfilm | fuera del repositorio | — | — | — |

Orden: primero lo que rompe algo ya entregado (1.8, el color de la tela, el
diagnóstico de 2.2 y la medida de 4.2), después lo que falta y ya tiene fase
(fusionar O2; M2b → M3b, que arreglan a la vez 1.1, 1.6 y parte de 5.1; la cola
en vivo), y al final las decisiones. Entre las decisiones va primero 2.1
porque de ella depende que el Render IA sirva de algo, y después las que
desbloquean trabajo pequeño (6.x, 1.7, 4.1).
