# Herramientas de estudio: óptica, entorno, luz, cámara y partículas

Plan del líder (2026-10-13) tras la petición del usuario: integrar, *a
nuestra manera y sin marcas*, lo que hacen cuatro add-ons de Blender
(simulación de lentes, estudio de HDRI, herramienta de luces y
movimientos de cámara prefabricados) y un **simulador de partículas de
todo tipo**. La investigación que lo sostiene está en `docs/research/`
(`products.md`, `optics.md`, `hdri-library.md`, `particles.md`), en
inglés tal como se preparó. Las fases están en `ROADMAP.md`.

## 0 · Reglas que valen para todo este documento

- **Sala limpia.** De los productos de terceros solo se usan sus
  descripciones públicas (páginas, manuales, preguntas frecuentes,
  registros de cambios). **Nunca** se compran, descargan ni leen sus
  scripts, sus ficheros de lentes, sus HDRI, sus texturas ni sus vídeos:
  son GPL o comerciales y contaminarían la licencia PolyForm del
  proyecto. Ningún nombre de producto ni de marca aparece en la interfaz,
  en las claves ni en los presets.
- **Nombres genéricos.** Lentes por su familia óptica (*Triplete*,
  *Doble Gauss rápido*, *Petzval de retrato*, *Gran angular de telefoto
  invertido*, *Catadióptrico*…), nunca por fabricante o modelo; los
  nombres comerciales de diseños (Tessar, Sonnar, Planar, Biotar, Heliar,
  Cooke, Imagon) no se usan, ni «retrofoco», que fue una marca registrada
  (`docs/research/optics.md` §2.1, §2.6): el nombre genérico es *telefoto
  invertido*. Un test falla si aparece una marca o un fabricante. Los vidrios se guardan como `nd` y `vd`, nunca por
  su nombre de catálogo.
- **Procedencia de cada asset.** Todo asset se crea con un generador
  propio y determinista y se guarda como **receta** (parámetros, semilla,
  versión del generador) más el *hash* del resultado; un test lo
  regenera y compara. Las prescripciones de lentes guardan como
  procedencia el número de la patente caducada o el libro del que salen
  (hechos, no obras). Nada se genera con modelos de imagen por IA: no
  dan valores físicos (un HDR necesita radiancias reales) y dejarían
  dudosa la autoría.
- **Física primero, ajustes artísticos encima y a la vista.** Lo que sale
  de la óptica o de la simulación se calcula; los ajustes no físicos
  (más aberración cromática, remolino exagerado…) se aplican encima, se
  marcan como tales en la interfaz y se guardan aparte.
- **Determinismo** (regla 8b): mismo resultado en cualquier máquina y con
  cualquier número de hilos; solo `+ − × ÷ sqrt` y las funciones de
  `fmath`, nunca `f32::sin/exp/powf`.

## 1 · Óptica: lentes, bokeh y aberraciones

**Qué se construye.** Dos modos de cámara en el motor:

1. **Lente fina mejorada** (rápida, la de siempre): forma del diafragma
   (círculo, polígono de 3 a 18 láminas con redondez y giro, imagen de
   máscara con muestreo por CDF 2D), perfil de densidad de la pupila
   (uniforme, centro brillante, anillo brillante, apodizada), obstrucción
   central (anillo de espejo), ojo de gato aproximado por intersección
   con un segundo disco desplazado según la altura de imagen, anamórfico
   (focales horizontal y vertical, pupila elíptica, desestiramiento),
   **descentramiento e inclinación** (*tilt-shift*: plano de enfoque
   inclinado), *split diopter*, aberración cromática por canal y
   remolino como ajuste. Cubre la mayoría de los tipos de bokeh sin
   trazar la lente.
2. **Lente trazada** (Kolb, Mitchell y Hanrahan 1995): la cámara traza
   cada rayo por las superficies reales de una prescripción (radio,
   espesor, vidrio `nd/vd`, semiapertura, asférica, cilíndrica, espejo,
   diafragma) desde el sensor hacia la pupila, con la intersección
   estable en `f32` que recomienda la investigación y límites de pupila
   de salida precalculados por altura de imagen. Salen *solas*:
   distorsión, viñeteo óptico y mecánico, bokeh de ojo de gato, burbuja
   o cremoso según la aberración esférica, coma, astigmatismo, curvatura
   de campo, aberración cromática lateral y longitudinal, respiración de
   foco y el carácter que cambia al cerrar el diafragma. Coste medido:
   0,4–1 µs por rayo de cámara (6–16 superficies), pequeño frente al
   trazado de la escena.

**Aberración cromática** (decidido): cada muestra de cámara elige una de
**tres bandas** (R, G, B) estratificada y traza la lente con el índice de
esa banda (de `nd` y `vd`); la escena sigue en RGB y la muestra pesa solo
su canal. Da los flecos de color sin una escena espectral y sin el ruido
de la longitud de onda única.

**Bokeh, todos los tipos y elegibles tal cual.** Un selector *Bokeh* con
miniatura por tipo (el núcleo del desenfoque renderizado por el propio
motor): disco, poligonal (láminas rectas o curvas), ojo de gato,
remolino, burbuja (anillo brillante), cremoso (centro brillante), anillos
de cebolla, donut catadióptrico, óvalo anamórfico con rayas, apodizado,
coma (cometa), doble línea o nervioso, flecos cromáticos, texturizado
(polvo, rayas, filtro), formas propias (estrella, corazón…), diafragma de
varios agujeros, borde de difracción (próximamente: necesita óptica de
ondas) y respiración de foco. Cada tipo es una combinación guardada de
parámetros del modo 1 o una lente del modo 2; el usuario lo elige y,
si quiere, lo afina.

**Lentes de partida** (`src/data/lenses.json`, claves estables; hecho en
A6): las 16 prescripciones de `docs/research/optics.md` §2.3 con nombre
genérico y su procedencia (patente caducada o libro): triplete; cuatro
elementos con doblete trasero; Petzval de retrato; cinco elementos
simétrico; doble Gauss normal; doble Gauss rápido f/1.4; asimétrico
rápido f/1.5; teleobjetivo de enfoque interno; gran angular de telefoto
invertido; ojo de pez 180°; catadióptrico; blando de aberración esférica
variable; macro con elemento flotante; doblete acromático; menisco
simple; adaptador anamórfico 2×. **Número de elementos y grupos**,
longitud y diafragma se muestran desde la prescripción, nunca inventados.

El registro de cada lente sigue `optics.md` §5 y añade lo que A6 necesitó:
las superficies van en **un solo marco global con signo** (la luz viaja
hacia +z, un radio positivo tiene el centro a +z, `d` es la distancia con
signo a la superficie siguiente y un espejo invierte la marcha, de modo que
las distancias que le siguen son negativas; el catadióptrico queda como una
secuencia desplegada); el vidrio es `{ nd, vd }`, más `vdEstimated` cuando la
fuente no da el número de Abbe y `native` cuando la fuente daba índices de la
línea e (el catadióptrico y el doble Gauss rápido: `nd` se convierte con
la fórmula del informe y los valores nativos se conservan); `status`
(`verified`, `caveat`, `experimental`, `own-design`) y `stopBasis`
(`stated`, `assumed`, `placeholder`) dicen cuánto se fía uno de la
prescripción y de la posición del diafragma (las seis que la fuente da y
las nueve que se suponen en el medio del hueco que el informe nombra; la
focal y el tiraje paraxiales no dependen de ello, el aspecto con el
diafragma cerrado sí); `reported` guarda lo que el informe trazó y lo que
dice la patente, con el que `tests/lenses.test.ts` compara un trazado
paraxial propio (0,05 % con lo trazado por el informe, 1 % con la patente).
Los *coatings* por época, los valores del diafragma y los del bokeh son
**provisionales** hasta que O1 los juzgue con renders (regla 11).

**Coatings y flare.** Reflectancia por superficie según el tratamiento:
**sin tratar** (~4 %), **monocapa** (~1,3 % con tinte), **multicapa**
(~0,3 %), con su color de interferencia de lámina delgada; de ahí salen
la transmisión (T-stop), el velo de contraste y los **fantasmas** del
flare (trazado de las rutas con dos reflexiones, más barato en una
pasada aparte) y el **tinte de color** de la lente. **Estrella de
difracción** por láminas (regla par/impar), **bloom y halación** como
efecto de imagen físico sobre el búfer lineal.

**Editor de lentes y presets propios.** En el inspector de cámara:
selector por **carácter** (*Clínica · Suave · Remolino · Vintage ·
Anamórfica · Macro · Gran angular · Tele*), la familia, focal, f/,
láminas, máscara, coating, foco, *tilt-shift*, y en *Avanzado* los
ajustes artísticos marcados *no físico*. Un **corte de la lente** en SVG
dibujado desde la prescripción. **Guardar lente como…** a la biblioteca
propia (U4), con la prescripción y los ajustes; cambiar de lente nunca
toca la resolución de salida.

**Hecho en O2 y O2c** (era la fase O5 de la tabla del `ROADMAP.md`). O2 hizo
el selector por carácter, el corte en SVG, los ajustes no físicos marcados y
*Guardar lente como…*; O2c, el **editor de los elementos** (`UI.md` §2.11):
radios, grosor, vidrio, tamaño y aire de cada elemento, añadir, borrar y
girar 180°, sobre una copia que el motor comprueba antes de ponerla en la
cámara. Donde O2c se aparta de este párrafo: la lente propia guarda la
prescripción **solo si se editaron sus elementos** (si no, la clave del
catálogo y los ajustes, como decidió O2); el tamaño de un elemento es su
apertura libre; las medidas son las del diseño, que el motor escala a la
focal de la cámara.

**Hecho en O1.** El modo 1 entero en `rt-core/src/optics` (sección RSB
`LENS`, opcional, después de `CAMR`): diafragma redondo, de 3 a 18
láminas rectas o curvas con giro, o máscara por CDF 2D; texturas de
pupila; los cuatro perfiles de `PUPIL_PROFILES`; obstrucción; ojo de gato
por un segundo disco (con su viñeteo); anamórfico 1,33× y 2× con la
imagen desestirada; descentramiento y plano de enfoque de Scheimpflug;
aberración cromática por tres bandas (decisión 3) y remolino como ajustes
marcados *no físico*. Todo con su densidad exacta y sin rechazo; un RSB
sin `LENS` no cambia ni un bit. En la interfaz, *Cámara ▸ Bokeh* con las
miniaturas de los 16 tipos que hace el modo 1 renderizadas por `rt`
(`tools/bokeh-thumbs.mjs`) y *Óptica avanzada*. El *split diopter* y las
rayas del anamórfico (`streaks`, pase de *flare*) no entran en O1; la
hoja `out/bokeh-sheet.html` espera el veredicto de los valores de
`bokeh.json` (regla 11).

## 2 · Entorno: estudio de HDRI propio

**Qué se construye.** Un **editor de entorno por *pines*** (formas
vectoriales sobre la esfera): softbox rectangular, disco, anillo, tira,
degradado (lineal, radial, en espejo), *scrim* con punto caliente,
bandera o recorte que quita luz, imagen del usuario, sol y cielo. Cada pin
se define por la **iluminancia** que da a incidencia normal (en pasos
relativos) y su temperatura de color; el generador calcula la radiancia
pintada con las fórmulas cerradas de `docs/research/hdri-library.md`
§4.1. El motor **evalúa los pines analíticamente** en cada dirección (sin
hornear, sin depender de la resolución) con una tabla de muestreo por
importancia que se rehace al cambiarlos. *Colocar brillo*: clic en la
pieza y el pin se mueve para que el reflejo caiga ahí. **Exportar HDR o
EXR** (2k, 4k, 8k) solo cuando se pide.

**Cielos.** Un cielo físico propio para el día (fase E5c: la forma de Hošek–Wilkie con coeficientes ajustados a nuestro simulador de atmósfera, en sala limpia; Preetham como alternativa); la
hora azul y la noche con un integrador de atmósfera propio más adelante.

**Biblioteca propia** (`src/data/environments.json`): las **39 recetas**
de la investigación (20 de estudio, 11 de exterior, 8 de interior), cada
una una lista de pines o un cielo, con nombre genérico, miniatura en
bola cromada y bola gris renderizadas por el motor, y su *hash*. Los de
interior se hornean renderizando una sala con nuestro motor.
**Decidido:** no se ofrecen descargas de HDRI de terceros (se quita de
K7); el usuario puede importar cualquier HDRI suyo.

## 3 · Luz: herramientas de colocación y modelado

Sobre los focos propios de L4 y la colocación por reflejo de L1:

- **Tres modos de colocación**: *Reflejo* (el brillo cae bajo el cursor),
  *Directo* (la luz apunta a ese punto) y *Órbita* (gira alrededor del
  objetivo, con ejes fijables); suavizado de la normal con un modo
  *Preciso*; evitar obstáculos con un rayo; **potencia automática** que
  mantiene la iluminancia en el objetivo al cambiar tamaño o distancia
  (calculada por el motor, regla 10).
- **Modelado de la luz**: emisores con perfil procedural (*scrim* con
  pluma, inclinación e imperfección, octabox, tira con rejilla, paraguas,
  plato de belleza, panel LED, anillo), **gobos** (patrones proyectados
  en espacio de la luz con *mantener vertical*, sin distorsión
  trapezoidal), **banderas, relleno negativo y reflectores** como
  tarjetas con su visibilidad propia.
- **Control fino**: equilibrio **difuso / especular** por luz (pesos por
  lóbulo en NEE y MIS, sin luces auxiliares), **enlazado de luz y
  sombra** por pieza, **solo** de una luz, parpadeo determinista.
- **Medir**: **falso color** por zonas (11 zonas de un paso) y fotómetro
  puntual con la luminancia del motor; **hornear el montaje a entorno**
  (evaluación analítica de los emisores, sin ruido) para exportarlo o
  usarlo como HDRI.
- Los patrones de gobo y los perfiles de los emisores son **recetas
  propias** generadas por código; no se copia ninguna biblioteca.

## 4 · Cámara: movimientos prefabricados

Sobre la animación de N1 y el paseo de N3:

- **Biblioteca de movimientos** en unidades relativas al producto
  (grados, % de la distancia de encuadre, fracción de la esfera que lo
  envuelve), cada uno se expande en barras de la línea de tiempo y es una
  función pura del tiempo: *Plato giratorio*, *Acercamiento ¾*, *Alejarse
  y revelar*, *Arco ascendente*, *Desplazamiento lateral y vertical*,
  *Contra-zoom*, *Espiral ascendente* y *descendente*, *Cambio de foco entre piezas*, *Recorrido
  macro por una arista*, *Órbita de vista explosionada*, *Grúa*, *Barrido
  rápido*. Sin las categorías de acción (disparos, caídas…) que no
  sirven para producto.
- **Cámara en mano** con ruido de banda limitada y semilla (*sutil ·
  medio · fuerte*), escalado por focal y distancia; **rampas de
  velocidad** con la curva de tiempo propia; **desenfoque de movimiento**
  del motor (obturador en grados).
- **Dibujar el recorrido** sobre el suelo o una esfera alrededor de la
  pieza, **grabar un vuelo libre** y simplificarlo a puntos editables,
  **bloqueo de objetivo** con giro suavizado.
- Vista previa dentro de la aplicación (trayectoria y encuadres en el
  visor y miniatura animada), sin vídeos externos; proporciones 2,39:1,
  9:16, 1:1 y 4:5 en la ventana de render.

## 5 · Partículas de todo tipo

> **S0 decidido** y **S4a hecha** (`ROADMAP.md`, sección «Herramientas de
> estudio»): las partículas de aire sin estado (polvo, polen, lluvia,
> nieve, polvareda, ceniza, burbujas, confeti) como efectos de la sección
> *Ambiente* de *Escena*, simulados por `engine/crates/rt-sim` y
> renderizados por el motor como esferas, discos y cápsulas (`FXAM`,
> `ARCHITECTURE.md` §5.2). Lo de abajo es el resto de la familia: el nodo
> de escena con emisores, las fuerzas que no son de forma cerrada, la
> colisión con las piezas y las horneadas siguen pendientes. Los valores
> de partida de los presets de S4a se aceptaron con la hoja
> `out/ambient-sheet.html`; el lóbulo hacia delante, la lluvia sin
> cáusticas y el coste a las densidades de los presets son S4b.

Un nodo de escena **Efecto** con emisor (punto, superficie de una pieza,
volumen, curva o estallido en un fotograma), cantidad, vida, velocidad y
dispersión, tamaño, giro, fuerzas (gravedad, viento, turbulencia de
*curl noise*, vórtice, atractor, arrastre), colisión con las piezas,
material, semilla y **congelar en el fotograma** para fotos fijas. Dos
clases (decidido):

- **Sin estado**: cada partícula es una función pura de (semilla, id,
  tiempo): polvo, chispas, luciérnagas, luces bokeh, lluvia, nieve,
  confeti que cae, burbujas que suben, dispersión. Encaja con la
  animación determinista y no necesita caché.
- **Horneadas**: interactúan entre sí y se guardan en una caché: caída y
  reposo de piezas (cuerpos rígidos), granos, telas y cintas, líquidos,
  humo y vapor. Un único marco de **dinámica por posiciones (XPBD)** para
  rígidos, telas, pelo, granos y líquidos (PBF); humo en rejilla (Stam).

Presets con nombres genéricos (`docs/research/particles.md` §5.4):
ambiente (motas de polvo, polen, calima, haces de luz, niebla baja,
vapor, bruma, pulverizador), superficie (condensación, rocío, gotas,
gotas que resbalan, escarcha), dispersión (en superficie o volumen,
grageas, guijarros, hierba, pelo, cerdas), caída y reposo (granos,
pastillas, cubitos, ingredientes), estallidos (polvo, color, confeti,
pétalos, purpurina, chispas), líquidos (corona de salpicadura, fruta
que cae, vertido, ondas, burbujas, espuma, goteo), clima (lluvia, nieve,
granizo, hojas al viento), luz (luciérnagas, luces bokeh, brasas, estela,
llama), flotar (levitación, piezas en órbita, ingredientes sin gravedad)
y tejidos (tela sobre la pieza, cinta, papel). Los valores de partida de
cada preset los fija Fable con capturas.

Lo que necesita el motor, por orden: conjuntos de instancias compactos
(millones), esferas, desenfoque de movimiento, volúmenes (seguimiento
delta y de razón, fase HG, emisión de cuerpo negro), curvas para pelo y
césped, y superficies de líquido reconstruidas.

## 6 · Assets: qué se crea y cómo

| Asset | Fichero | Cómo se crea |
| --- | --- | --- |
| Lentes de partida | `src/data/lenses.json` | Las 16 prescripciones de la investigación, transcritas con su procedencia y comprobadas con un test de focal y tiraje paraxiales (A6, hecha) |
| Tipos de bokeh | `src/data/bokeh.json` | Los 20 tipos como combinaciones de parámetros (o la lente trazada que los da, o óptica de ondas: próximamente); miniaturas renderizadas por el motor (A6, hecha; las miniaturas, con O1) |
| Máscaras de diafragma y texturas de pupila | `public/assets/aperture/` | Generador propio (`tools/assets/aperture-masks.mjs`): 45 PNG de 512²: polígonos de 3 a 18 láminas rectos y curvos, estrellas, corazón, varios agujeros, anillos con obstrucción, anillos de cebolla, polvo, rayas, malla; con receta, semilla y *hash* (A6, hecha) |
| Entornos | `src/data/environments.json` | Las 39 recetas; los HDR se generan bajo demanda o al exportar, no se suben; miniaturas pequeñas sí |
| Perfiles de emisor y gobos | `src/data/light-shapes.json`, `public/assets/gobo/` | Recetas procedurales (softbox, octabox, tira con rejilla, paraguas, plato, panel, anillo; persianas, ventana, hojas por ruido, puntos, rejilla). Los gobos están hechos (A6, `tools/assets/gobos.mjs`, 12 PNG de 1024²); los perfiles de emisor, con L7 |
| Movimientos de cámara | `src/data/camera-moves.json` | Datos en unidades relativas al producto: **14 movimientos** (los 13 de §4 con la espiral en dos, ascendente y descendente) y 3 presets de cámara en mano; `src/core/camera-moves.ts` los expande en barras (A6, hecha) |
| Efectos de partículas | `src/data/effects.json` | Claves y nombres; valores de partida por Fable |

Primero se crean los que no necesitan motor nuevo (lentes, tipos de
bokeh, máscaras, gobos, movimientos de cámara); los entornos cuando el
evaluador de pines exista.
