# Especificación de comportamiento

Qué hace Repackshot, visto desde fuera, y el modelo de datos que lo
sostiene. Es la **especificación de caja negra** que exigen las reglas de
sala limpia del `README.md`: describe comportamientos y flujos de trabajo,
nunca cómo los implementa ningún otro producto. Las ideas vienen de dos
sitios: el uso normal de renderizadores de producto comerciales (lo que
hacen, no cómo), y EZ Packshot, cuyas soluciones se reutilizan con permiso
de su autor.

---

## 1 · Para quién y para qué

Diseñadores de producto, fotógrafos de producto y estudios pequeños que
necesitan **una imagen de catálogo o una animación corta de un objeto**
con la menor fricción posible. Vienen de un CAD (STEP, glTF exportado),
saben de fotografía y no tienen por qué saber de rendering. El criterio de
éxito es el de EZ Packshot: *abrir, importar, elegir tipo de producto,
pintar materiales, elegir luz, render*, en diez minutos y sin manual.

El producto es una **aplicación web** (y más adelante de escritorio) que
funciona sin conexión una vez cargada, no sube nada a ningún servidor y
guarda proyectos en un archivo.

---

## 2 · El flujo de trabajo

**Modo estándar, por defecto.** La aplicación abre con todo ya puesto,
como hace KeyShot: el estudio *Estándar* (tres puntos, cúpula de estudio,
cámara de referencia, calidad de previa, HD) está construido antes de
importar nada, y una pieza importada sin material recibe un material
neutro por defecto. No hay que elegir nada para empezar a trabajar; los
tipos de producto y el resto de presets son atajos encima de ese estado,
no un requisito.

1. **Importar o cargar el ejemplo.** Arrastrar un archivo (ver §6: glTF,
   OBJ, STL, FBX, 3DM, STEP, IGES, 3MF, PLY, DAE, USD) o pulsar *Cargar
   pieza de ejemplo*: una pieza procedural original, con varias partes
   agrupadas, que sirve para ver un resultado terminado sin traer nada.
   Al importar, una hoja de opciones en línea (unidades, eje arriba,
   centrar, apoyar en el suelo, encuadrar, agrupar por, mantener
   materiales, calidad de teselado) con valores por defecto que funcionan.
2. **Tipo de producto y estudio.** Elegir una de 16 categorías (joyería,
   relojería, perfumería, cosmética, electrónica, electrodoméstico,
   mobiliario interior y exterior, calzado, textil, packaging, automoción,
   herramienta, óptica, médico, genérico). *Crear estudio* monta en un
   clic: tamaño de referencia, focal, diafragma, exposición, fondo, suelo,
   sombra, cáusticas, calidad, y un rig de focos adecuado a la
   reflectancia típica de esa categoría.
3. **Materiales.** Elegir el nivel (modelo, grupo, pieza, caras) y pulsar
   o arrastrar un material del catálogo (77 presets en 7 categorías). Si
   el objetivo ya tiene materiales distintos, se pregunta con inventario.
   Editar parámetros con nombres de fotógrafo. Añadir desgaste.
4. **Luz.** Elegir un montaje del catálogo (72 en 8 estilos) por su
   miniatura e intención; la exposición no cambia al cambiar de montaje.
   Afinar focos si se quiere; colocar un foco por reflejo apuntando a
   dónde se quiere el brillo. **O montar la luz desde cero**: añadir
   focos propios (área, punto, foco direccional, sol; IES más adelante),
   moverlos y apuntarlos con el *gizmo*, y guardar el resultado como
   montaje propio en la biblioteca.
5. **Cámara e imagen.** Óptica, focal, diafragma, enfoque con clic,
   encuadre, perspectiva u ortográfica; exposición, transformada de vista,
   halo, viñeta. Guardar cámaras y estudios.
6. **Render.** Calidad, resolución, presupuesto de muestras o tiempo,
   formato; *Render* o *Añadir a la cola*. El visor tiene dos modos,
   elegidos con un conmutador en la cabecera: **Rápido** (vista previa
   rasterizada, inmediata, para editar luces, materiales y encuadre) y
   **Completo** (el motor simulándolo todo en el visor, también al mover
   la cámara, a menos resolución durante el gesto). *Render* usa siempre
   el motor completo, esté el visor como esté: lleva la imagen a
   resolución y calidad completas y la guarda.
7. **Animación** (opcional). Planos y movimientos en lenguaje llano,
   presets, línea de tiempo de bloques, vídeo.

El **Doctor** vigila todo el rato y arregla con un clic lo que suele
estropear un render: escala absurda, pieza bajo el suelo, suavizado,
bisel de aristas, clipping de cámara, luces visibles, cáusticas, formato.

---

## 3 · Modelo de datos

### 3.1 · Escena

Un **árbol** de nodos. Tipos: `MODEL` (raíz de una importación), `GROUP`
(ensamblaje), `PART` (malla), `CAMERA`, `LIGHT`, `FLOOR` (las luces y las
cámaras viven fuera del árbol, en `studio.lights` y `camera.cameras`: ver
§3.4 y §3.5). Cada nodo:
`id`, `name`, `parent`, `children`, `transform` (posición, rotación en
grados, escala; local al padre), `visible`, `locked`. Una `PART` lleva
además `mesh` (id de geometría: posiciones, normales, índices, uv
opcional, y aristas vivas si el importador las trae), `material`
(instancia) y `faceMaterials` opcional (rangos de triángulos → instancia,
para el nivel *Caras*). Una `PART` hecha con *Añadir ▸ Primitiva* (fase
U9) lleva además `primitive`: `{ kind, params }`, la forma (clave estable
del catálogo `src/data/primitives.json`) y sus medidas en mm; su malla se
genera de ahí (ver *Primitivas*, abajo).

**Tamaño de la pieza** (`partSizeMm`): la mayor dimensión de la caja
envolvente del modelo, detectada al importar y editable. Todo lo que
tiene escala física se expresa en tamaños de pieza o se deriva de aquí:
distancia de cámara, tamaño y distancia de focos, radio de bisel, escala
del desgaste y del grano.

**Apoyo en el suelo**: el punto más bajo de **todas** las mallas del
objetivo (no de una sola) baja a `z = 0`. **Centrar**: el centro de la caja
envolvente en XY a `(0, 0)`.

**Operaciones sobre piezas, al estilo KeyShot.** Sobre cualquier
selección (modelo, grupo o pieza):

- **Herramienta de mover**: *gizmo* en el visor con asas de traslación,
  rotación y escala, ejes locales o globales, incrementos con `Shift`,
  campos numéricos en el inspector (posición, rotación en grados, escala
  con bloqueo proporcional), y *Restablecer transformación*.
- **Pivote**: centro de la caja envolvente (por defecto), base de la caja,
  origen del archivo, o un punto picado; *Establecer pivote*.
- **Apoyar en el suelo** (el punto más bajo de todas las mallas de la
  selección a `z = 0`), **Centrar** (centro XY a `0, 0`), **Centrar y
  apoyar** en una acción.
- **Ocultar / Mostrar / Aislar / Mostrar todo**, **Bloquear**,
  **Renombrar**, **Eliminar**, **Encuadrar**, **Fijar como objetivo de
  cámara** (la cámara mira a la selección).
- **Duplicar** (copia independiente) y **Duplicar enlazado** (comparte
  malla y material; cambiar uno cambia todos), **Agrupar / Desagrupar**,
  **Mover a grupo**.
- **Patrón**: lineal (n copias a distancia en un eje) y circular (n
  copias alrededor de un eje), como instancias enlazadas, editable
  después.
- **Materiales**: *Desenlazar material* (la pieza pasa a tener su propia
  copia), *Enlazar con…* (varias piezas comparten uno), *Copiar / Pegar
  material*, *Seleccionar por material*.
- **Geometría**: *Invertir normales*, *Suavizado* (ángulo), *Bisel de
  aristas* (radio en mm, solo sombreado), *Separar por caras CAD* y
  *Separar por material* (cada rango pasa a ser una pieza).

- **Escalar** (fase U9): la herramienta *Escalar* (`S`), el mismo *gizmo*
  con solo sus asas de escala, y *Clic derecho ▸ Escalar…*: uniforme (%),
  por eje (X, Y, Z en %) o a medida (mm del ancho, fondo o alto, con la
  proporción bloqueada), alrededor del pivote de la selección y en los
  ejes de *Mover* (globales o locales); *Restablecer escala* devuelve a
  cada nodo la escala con que entró en la escena, alrededor de su propio
  pivote. A medida mide la selección por sus vértices proyectados sobre
  esos ejes (`selectionExtents`).

Todas son acciones del *store*, deshacibles, y las que tienen sentido en
masa aplican a toda la selección.

**Primitivas** (fase U9, `src/core/primitives.ts` y
`src/core/primitive-ops.ts`). Doce formas paramétricas, con claves
estables: `BOX` (ancho, fondo, alto, radio de bisel y sus segmentos),
`PLANE`, `DISC`, `CYLINDER`, `PEDESTAL` (cilindro con bisel arriba),
`SPHERE`, `CONE`, `TORUS`, `CAPSULE`, `TUBE` (radio exterior e
interior), `STEPS` (número de escalones, subiendo hacia +Y) y `SWEEP`
(fondo infinito: un suelo que sube en curva hasta una pared en +Y).

- **Geometría**: generada pura y determinista (la misma especificación da
  los mismos bytes), en mm, Z arriba, centrada en su caja (su caja *es*
  sus medidas: los ángulos múltiplos de 90° usan senos y cosenos exactos);
  cerrada y estanca salvo el plano, el disco y el fondo infinito; normales
  de la superficie dentro de cada cara lógica (una esfera es lisa con
  cualquier número de segmentos) y triángulos orientados hacia ellas, hacia
  fuera; UV en [0, 1] por cara y sin estirar (el lado largo llena el
  cuadrado; un lateral de revolución da una vuelta en u, las tapas se
  proyectan desde arriba, el fondo infinito se desenrolla de un tirón).
  Cada **cara lógica** (la tapa, el lateral, el bisel, cada escalón…) es
  un rango consecutivo de triángulos, guardado en `faceRanges`: el nivel
  *Caras*, M1 y *Separar por caras CAD* las usan como caras CAD, y toda
  arista entre dos de ellas es arista viva (`sharpEdges`), como en STEP.
- **Medidas**: se acotan a lo que da una forma (un bisel no pasa de la
  mitad del lado menor, ni del radio o el alto del pedestal; el tubo del
  toro no pasa del radio; una cápsula es al menos tan alta como ancha; el
  hueco del tubo es menor que el tubo; la curva del fondo infinito cabe en
  su suelo y su pared), las longitudes a la diezmilésima de mm y los
  segmentos enteros.
- **Dónde nace** (`placePrimitive`): con producto (cualquier pieza que no
  sea primitiva), el tamaño de la escena es su mayor dimensión. *Caja* y
  *Pedestal* nacen como **base**: bajo el producto, en el suelo, con 1,4
  veces su huella (los lados de la caja; el radio del pedestal sobre el
  punto del producto más alejado de su eje vertical), un alto de 0,15
  (caja) o 0,3 (pedestal) tamaños de producto y un bisel del 3 % de su
  menor medida, y el producto sube hasta apoyarse encima, en la misma
  acción (una entrada de deshacer); un producto bloqueado no sube. *Plano*
  (3 veces el lado mayor de la huella) y *Disco* (1,4 veces la huella) se
  tienden bajo el producto. El *Fondo infinito* se **ajusta a la cámara
  activa** (`fitSweep`): girado en Z al acimut de la cámara (la pared de
  cara a ella), centrado de lado en el producto, la pared a 1,75 veces el
  fondo del producto detrás de su centro (más atrás si la curva llegaría
  bajo el producto, y siempre detrás de los focos encendidos del montaje
  que están detrás del producto: a 1,25 veces lo que cada uno está detrás
  del centro más la mitad de su panel, para que el contraluz quepa entre
  el producto y el papel; un sol no cuenta), el ancho 1,3 veces lo que el encuadre de salida abarca
  donde toca el fondo, el alto 1,15 veces lo más alto que el encuadre
  alcanza en la pared (y al menos 1,25 veces el producto), el suelo hasta
  delante de lo más cercano que el encuadre ve de él, y una curva de 0,3
  veces el alto; los rayos por el encuadre (la óptica, el sensor de 36 mm
  y el formato de salida de la cámara; también ortográfica) caen todos
  sobre él. `scene/fitPrimitive` (*Ajustar a la cámara*) lo rehace en una
  entrada de deshacer. Los tres, a una
  milésima del tamaño sobre el suelo del estudio, porque una superficie
  sobre el suelo que hace de *shadow catcher* parpadearía entre los dos. El
  resto se apoya en el suelo junto a lo que está de pie (a +X, a una
  décima del tamaño), sin contar planos ni fondos. Sin producto, el tamaño
  es el de pieza declarado: la primera en el origen (y entonces es el
  producto: fija el tamaño de pieza y la cámara la encuadra), las
  siguientes al lado. Todas llevan la instancia sin editar de *Blanco
  estudio* del catálogo, compartida.
- **Viva**: `scene/setPrimitive` regenera la malla con las medidas nuevas,
  una acción y, en un arrastre, una entrada de deshacer; la pieza conserva
  su apoyo (el centro de la base de su caja, en sus ejes, no se mueve), las
  copias enlazadas cambian con ella, los materiales por caras y las caras
  seleccionadas siguen a sus caras lógicas por nombre. `scene/convertPrimitive`
  (*Convertir en malla*) la congela; *Invertir normales*, *Suavizado* y
  *Separar* también la congelan, porque su malla ya no es la de sus medidas.
- **La malla de una primitiva se llama** `prim:<dueño>:<FORMA>:<medidas>`:
  nombra su contenido y su dueño (el nodo que la tuvo primero), así que
  las copias enlazadas la comparten y una copia independiente tiene la
  suya, aunque sus medidas coincidan.
- **El producto, no el decorado**: el pivote del montaje de luces, el
  encuadre de *Crear estudio*, el tamaño medido de la pieza (y el chequeo
  de escala del Doctor) y el mapa de sombras de la vista previa miden el
  producto (`productBounds`: las piezas que no son primitivas; si solo hay
  primitivas, todas), para que un fondo infinito seis veces mayor no mueva
  las luces ni cambie la escala. *Encuadrar todo* sigue siendo todo.

### 3.2 · Selección por niveles

`level ∈ {MODEL, GROUP, PART, FACES}`, excluyentes. Un clic en el visor
selecciona el ancestro del nivel elegido; `GROUP` sobre una pieza sin
grupo selecciona la pieza. `FACES` guarda `{part, indices[]}`: una sola
pieza y los índices de sus triángulos. La selección decide el objetivo
de materiales, de *Apoyar*, *Centrar*, *Ocultar*, y del inspector. La
selección es estado volátil: no se deshace y no marca el proyecto como
modificado.

**Combinar con la selección que había** (el mismo vocabulario en un
clic y en una caja): sustituir, **añadir**, **quitar**, y en un clic
también **alternar** (meter o sacar). En el visor: sin tecla sustituye,
`Shift` añade, `Ctrl/⌘` alterna, `Alt` quita; un clic en vacío limpia.

**Caras por continuidad.** Un clic a nivel `FACES` coge una cara entera,
no un triángulo (`src/core/faces.ts`):

- En una pieza que viene de STEP o IGES, la **cara CAD** que contiene el
  triángulo (`SceneNode.faceRanges`, rangos de triángulos): los rangos
  ganan siempre.
- En cualquier otra malla, la superficie que **continúa** desde el
  triángulo picado (el algoritmo de EZ Packshot, fase E2): adyacencia por
  **posición** de vértice (soldadura a `1e-5` de la diagonal de la malla,
  no por índice, porque los teseladores duplican vértices en las
  costuras); se cruza una arista si el diedro entre el triángulo que se
  deja y el que se entra es menor que el ángulo de arista viva (30°) **y**
  menor que 2,5 veces la curvatura propia de la cara (el menor diedro no
  plano entre las aristas **que se podrían cruzar** del triángulo
  picado; una cara plana no tiene, y se para en el primer redondeo; la
  pared de un cilindro tiene uno constante y se coge entera, hasta las
  tapas); las aristas que la malla marca como duras (`sharpEdges`) no se
  cruzan nunca. El triángulo suelto (`Shift`) se coge sin crecer.
- Límite conocido: un triángulo en el borde de una cara plana cuya única
  arista que gira es un redondeo suave (unos pocos grados por paso) se
  confunde con una faceta de cara curva y la cara sigue el redondeo; en
  el interior de la misma cara no pasa, y con rangos CAD tampoco.

**Selección por caja.** Un rectángulo arrastrado en pantalla coge, al
nivel vigente, lo que queda **entero dentro** (*ventana*, arrastrando de
izquierda a derecha) o lo que **toca** (*cruce*, de derecha a izquierda)
(`src/core/box-select.ts`, todo en píxeles de pantalla y puro):

- `MODEL`, `GROUP` y `PART`: cada nodo del nivel se prueba por la
  geometría proyectada de sus piezas, primero la caja envolvente y luego
  los triángulos recortados contra el plano cercano. Las piezas ocultas
  no cuentan, y **no se mira qué tapa a qué**: una pieza detrás de otra
  se coge también, como en cualquier CAD. Una ventana coge un grupo o un
  modelo cuando **todas** sus piezas caben; un cruce cuando **alguna**
  toca.
- `FACES`: caras enteras (cara CAD o por continuidad) de **una** pieza
  (la seleccionada o, si no hay, la que está en el centro de la caja) que
  se **ven** en el rectángulo; con *Rayos X* también las ocultas, por
  geometría. Una ventana coge una cara solo si todos sus triángulos
  caben.
- Se combina con la selección que había: sustituye, añade o quita. Un
  arrastre de pocos píxeles es un clic, no una caja.

### 3.3 · Materiales

Una **instancia** de material: `id`, `name`, `preset` (clave de origen o
`null` si es propio), `family`, `category`, `params` (los del catálogo,
todos editables), `wear` (los campos de desgaste), `textures` (color,
rugosidad, metal, normal, alfa; proyección caja/plana/cilíndrica/UV;
escala, rotación, desplazamiento), `bevelRadiusMm`.

Familias y lo que significan para el motor:

| Familia | Modelo | Parámetros propios |
| --- | --- | --- |
| `SIMPLE` | BSDF de principio físico: base, metal, rugosidad, barniz, anisotropía, subsuperficie, opacidad | — |
| `GLASS` | dieléctrico con transmisión, IOR, rugosidad, color de absorción: el color es lo que conserva la luz blanca tras `absorptionMm` milímetros dentro de la pieza (0: tinte de superficie); con `walls` `THIN`, pared fina sin interior (lámina, bombilla, visera modelada como una superficie), que deja pasar la luz recta | `ior`, `transmission`, `absorptionMm` (50), `walls` (`SOLID` · `THIN`) |
| `WOOD` | veta procedural: dos colores, densidad y variación de anillos, ruido axial, poro | `woodColor1/2`, `ringDensity`… |
| `FABRIC` | trama procedural: dos colores de hilo, tejido (tafetán, sarga, satén, punto, malla), hilos por cm, relieve, pelusa | `threadColor1/2`, `weave`, `threadCount`, `fuzz` |
| `EMISSIVE` | emisor: cuerpo negro a temperatura o color, potencia | `emitKind`, `temperature`, `emitPower` |

**Desgaste**: ocho tipos (aristas, arañazos, huellas, polvo, suciedad en
cavidades, pátina, micro-variación de rugosidad, abolladuras), cada uno
con cantidad y mandos propios, un mando maestro, escala en tamaños de
pieza, semilla y variación por pieza. Cada preset trae su física (el
cobre toma cardenillo, el oro no). Nueve básicos de un clic. Los tipos
que no tienen sentido en una familia no existen para ella.

**Miniaturas**: una esfera con el material, renderizada por el propio
producto y cacheada; nunca imágenes estáticas que mientan.

**Asignar, y arrastrar un material** (`material/assign`, una sola acción
y una entrada de deshacer, también cuando el destino son varias piezas):

- **Destino**: nodos a cualquier nivel (la acción llega a todas las
  piezas que cuelgan de ellos) o **caras** de una pieza (triángulos, a
  través de `faceMaterials`). Un clic en una miniatura asigna a la
  selección; soltarla sobre algo asigna a lo que **seleccionaría un clic
  ahí** al nivel vigente (pieza, ensamblaje, modelo o la cara entera bajo
  el cursor), o a la fila del árbol y todo lo que cuelga de ella
  (`src/core/material-drop.ts`).
- **Origen y qué se asigna**: un preset del catálogo o un elemento de
  *Míos* entra con la **instancia que la escena ya tiene** (se crea si no
  hay; la misma que da un clic, así que soltar y hacer clic dejan el
  mismo proyecto); una instancia (la esfera del material de la selección)
  **enlaza** el destino con esa instancia, que comparte con las piezas
  que ya la llevan; con **copia** (`Alt` al soltar), sea cual sea el
  origen, el destino recibe una instancia **propia**, que no comparte con
  ninguna pieza de fuera: editarla no cambia nada más.
- **Modo**: `REPLACE` sustituye lo que había y `KEEP` solo rellena donde
  no hay material; si el destino lleva materiales distintos, la interfaz
  pregunta antes (`UI.md` §4.1) y no se asigna hasta que se contesta.
- **Sin cambios no hay entrada**: asignar lo que el destino ya lleva
  devuelve el mismo estado (ninguna entrada de deshacer). Las instancias
  que quedan sin uso se podan como siempre.

### 3.4 · Luz

El **rig activo** es una lista de focos resueltos (`LightInstance`:
rol, tipo, forma, tamaño, acimut y elevación relativos a cámara,
distancia, dispersión, color, potencia, visible en reflejos, visible a
cámara, encendido). Sale de `studioRig(tipo)` o `setupRig(tipo, montaje)`
y se puede editar foco a foco; editarlo marca `modified`. Cambiar de
montaje o de tipo de producto lo reconstruye (tras confirmar si estaba
modificado).

**Normalización**: la irradiancia total de un montaje aplicado se iguala a
la del rig del tipo de producto. Cambiar de montaje no cambia la
exposición.

**Sets** (fase L6). Un montaje puede ser un **set**: luces más lo que el
producto refleja y donde se apoya. `LightSetup` gana campos opcionales
(los 72 montajes anteriores no tienen ninguno y resuelven exactamente al
mismo rig que antes): `backdrop` (`FLAT` color de fondo; `GRADIENT` dos
colores, arriba y abajo del encuadre, que el motor recibe como imagen de
fondo generada y estirada; `SWEEP` el fondo infinito de U9 en papel mate
del color, que recibe luz y sombra), `pool` (un foco direccional detrás
del producto que dibuja un charco de luz en el fondo: `az`, `el`, cono,
`share`, kelvin o color), `floor` (`CATCHER` el atrapasombras; `MATTE`
mate de un color; `GLOSSY` y `MIRROR` un material del catálogo bajo el
producto), `cards` (tarjetas: planos de *Tarjeta blanca*, *Tarjeta negra*
o aluminio cepillado como tarjeta plateada, con `az`, `el`, `dist`,
`size`, `sizeY` y giro, de cara al producto), `exposureEv` (desvío sobre
la exposición del tipo de producto), `envStrength` (la cúpula mientras el
set manda), `camera` (`el`, `focalMm`: sugerida, no se aplica sola),
`hero` (el objeto de su miniatura) y `why` (la razón fotográfica, dos
frases, en la ayuda de su miniatura). Los 16 sets son el estilo `SETS`,
el primero del catálogo.

- **Aplicar un set** (`studio/setSetup` con su clave) es una sola entrada
  de deshacer: sus focos (normalizados como los de cualquier montaje; el
  charco se lleva su `share` del nivel y las luces se reparten el resto),
  su aspecto (fondo, cúpula, exposición del tipo más el desvío; suelo y
  sombra encendidos) y su **decoración**: primero el barrido (si el fondo
  es `SWEEP`, o si es `FLAT` o `GRADIENT` con charco, que necesita una
  pared donde caer), ajustado a la cámara activa como el de U9; luego el
  suelo; luego las tarjetas; luego el charco.
- **El suelo.** Mate sobre un barrido es el propio barrido. Brillante o
  espejo sobre un barrido es la cara *suelo* del barrido en ese material
  (sin costura); si además hay charco, una lámina sobre el barrido que se
  para antes de donde cae el charco (el charco cae en papel y la lámina
  lo refleja). Sin barrido, un plano del tamaño del suelo que vería el
  barrido de esa cámara, con el fondo (color o degradado) detrás de su
  borde, a través del atrapasombras.
- **El charco** cae donde la cámara ve el fondo justo detrás del producto
  (su rayo por el pivote, sobre el barrido), así que es un halo detrás
  del producto a cualquier altura de cámara. El foco se pone detrás del
  producto en el `az` y `el` del set, a 0,75 tamaños de pieza del pivote,
  y apunta ahí; su cono se abre para que el charco mida lo que su cono
  daría a 2,5 tamaños de pieza (`POOL_THROW`) y su potencia hace que donde
  cae llegue su `share` del nivel medido a esa distancia. No se ve a
  cámara ni en reflejos.
- **Las tarjetas** miran al pivote, con el ancho paralelo al suelo; una
  que atravesaría el suelo se sube sin girarla hasta apoyarse en él. Por
  construcción quedan **fuera del encuadre**: un test lo comprueba para
  cada tarjeta con la focal de los 16 tipos de producto, tres formas de
  producto, tres proporciones de salida y la cámara del set.
- **Decoración del set.** Cada pieza lleva `setPiece` (`CARD`, `BACKDROP`,
  `FLOOR`; el charco, en su foco) y es decoración: no cuenta para el
  tamaño de pieza, el pivote del rig ni *Encuadrar* sin selección, y el
  Doctor no la mira. Aplicar otro montaje la sustituye (las piezas del
  usuario, primitivas incluidas, no se tocan); un montaje que no es un set
  la quita y devuelve el fondo, la cúpula y la exposición del tipo de
  producto; **Restablecer montaje** la quita y devuelve los focos del set
  como eran; *Crear estudio* con un set en vigor lo vuelve a poner,
  ajustado al nuevo encuadre. Elegir el set otra vez la devuelve.
- **Usar la cámara del set** (`studio/useSetCamera`): la elevación y la
  focal que sugiere, el producto encuadrado de nuevo y el barrido, el
  suelo y el charco ajustados a la nueva vista (las tarjetas no se
  mueven); una entrada de deshacer; no hace nada con la cámara bloqueada.
- **Rigs de tipo de producto.** Los 15 tipos de estudio toman los focos de
  un set (`PRESET_SETS`), al nivel de irradiancia que tenían (su
  exposición no cambia); *Mobiliario exterior* conserva su sol. Solo los
  focos: el fondo, el suelo y la cúpula del tipo siguen siendo los suyos.

**Luces propias, al estilo KeyShot** (fase L4). Además de los montajes, se
pueden **añadir focos** desde la pestaña *Luces* (*+ Añadir luz ▸*), desde
*Añadir ▸* del menú de la cabecera, desde el clic derecho del visor en vacío y
desde la paleta: **Área** (rectángulo, disco o esfera, con tamaño), **Punto**
(radio), **Foco direccional** (ángulo de cono y transición), **Sol** (ángulo
del disco) e **IES** (perfil de archivo; *próximamente*, fase L5). Claves
estables: `RECTANGLE`, `DISK`, `SPHERE`, `POINT`, `SPOT`, `SUN`
(`NEW_LIGHT_KINDS`). Un foco nuevo nace **delante y arriba de la pieza** tal
como la ve la cámara activa (25° a su derecha, 40° de elevación, 50° el sol,
a dos tamaños de pieza del pivote), encendido, **seleccionado** y con la
**irradiancia media** de los focos encendidos (un sol, π veces esa media: ver
*Unidades*), así que la imagen no salta. Es una sola entrada de deshacer.

- **Dónde vive.** Cada foco es un `LightInstance` de `studio.lights` (los del
  montaje y los propios en la misma lista, `own: true` en los propios), no
  un nodo del árbol: es la lista que ya leen la vista previa, el motor, la
  animación, el Doctor, los estudios y la biblioteca, así que un foco propio
  se anima, se guarda en un estudio y entra en *Guardar montaje como…* sin
  nada más. Su **transformación propia** es su posición alrededor del pivote
  del montaje (`az`, `el`, `dist` en tamaños de pieza, como un foco de
  receta), su **objetivo** `aim` (en tamaños de pieza desde el pivote;
  ausente, el pivote: donde apuntan todos los focos de los montajes) y su
  **giro** `roll` (grados alrededor de su eje; 0, los lados del panel
  paralelos al suelo). Todo en tamaños de pieza: el foco sigue al producto y
  vale para un anillo y para un sofá.
- **Se mueve y se apunta** con el *gizmo* de *Mover* (ver *Luces y cámaras
  en el visor*, abajo), con los campos del inspector (acimut, elevación y
  distancia; o X, Y, Z en mm, que lo mueven sin cambiar a dónde apunta), con
  **Apuntar a…** (el centro del producto, un punto picado, el centro de una
  pieza picada; y, desde el menú contextual de una pieza, *Apuntar un foco
  aquí ▸*), **por reflejo** o **sobre una superficie** (clic en una pieza: el
  foco queda sobre ese punto a lo largo de la normal, a la distancia a la
  que estaba de su objetivo, y apunta a él).
- **Propiedades**: nombre (por defecto, el rol si es del montaje o el tipo si
  es propio, numerado), tipo, forma, tamaño (ancho y alto; diámetro de la
  esfera; radio del punto y del foco), dispersión (área), ángulo de cono y
  transición en % del semiángulo (foco), disco del sol, giro, temperatura de
  color o color, **potencia en vatios** con su **equivalente en lúmenes** (o
  lux para el sol) en auxiliar, *visible en reflejos*, *visible a cámara*,
  ***proyecta sombra*** (sin ella el motor no traza sus rayos de sombra) y
  encendido. *Duplicar* (una copia propia, 15° al lado, seleccionada) y
  *Eliminar* valen para los focos del montaje y los propios.
- **Unidades.** Las de los montajes (vatios a tamaño de pieza 1, en el
  sentido de Cycles; W/m² para el sol). Para los tipos nuevos, que no tiene
  ninguna receta, **un punto o un foco de P W es tan brillante en su eje como
  un panel de P W de cara al producto a la misma distancia**: flujo
  isótropo `π · P · S²` para el motor (S, el tamaño de pieza en metros) e
  intensidad `P · S² / 4` (S en mm) para la vista previa; un foco
  direccional es el punto que sería sin su cono (su eje no cambia de brillo
  con el cono). Así la medida con que se normalizan los montajes
  (`specIrradiance`) es la misma fracción, 1/π, de lo que llega para paneles,
  puntos y focos, y un montaje que los mezcla conserva su equilibrio. Una
  esfera de área es un punto con tamaño. Los **lúmenes** son el flujo que se
  le da al motor (estrechado por la dispersión de un panel; la parte de su
  cono en un foco) por 683 lm/W y por la luminancia del color: la convención
  de los renderizadores en RGB, no la eficacia de una lámpara.
- **Guardar montaje como…** guarda los focos encendidos (con su tipo, forma,
  objetivo, giro, transición y sombra) en la biblioteca; aplicado a otro
  tipo de producto se normaliza como los del catálogo: la irradiancia total
  es la de ese tipo y cada foco conserva su parte. **Restablecer al montaje**
  quita los focos propios y devuelve los del montaje como eran.

Cualquier pieza con material emisor también ilumina.

**Luces y cámaras en el visor** (ampliación de L4). Las luces y las
**cámaras guardadas** (no la activa, que es la vista) se dibujan como
**glifos acromáticos** en la tinta del tema: el contorno del panel (rectángulo
o elipse, con una marca hacia donde ilumina), la esfera, el punto (con una
estrella pequeña), el cono del foco (con el cono interior donde empieza la
transición), la flecha del sol y la pirámide de la cámara (con un triángulo
que dice dónde está arriba). Se dibujan sobre todo, discontinuos, y el
seleccionado continuo; nunca salen en un render. El botón **Luces y cámaras**
de la barra de vista los muestra todos **mientras se trabaja con ellos**: con
la pestaña *Luces* o *Cámaras* abierta, con una luz o una cámara
seleccionada o mirando a través de una; si no (con *Piezas* y la pieza
seleccionada), ninguno, para que el contorno de un panel del montaje que
cruza el producto (el principal suele estar entre la cámara y la pieza) no
se lea como parte de él. Apagado, solo el del objeto seleccionado. Un **clic**
en un glifo (a 6 px de una de sus líneas) selecciona su luz o su cámara (una
a la vez; `Ctrl/⌘` o `Alt` la quita), por encima de la pieza que haya
detrás; un **doble clic** mira a través; el **clic derecho** abre *Mirar a
través*, *Duplicar*, *Apuntar a…* y *Eliminar* (o *Activar* en una cámara).
Con una luz o una cámara seleccionada, *Mover* pone sobre ella el *gizmo*
sin los cubos de escala: **mover** la lleva sin cambiar a dónde apunta,
**girar** gira alrededor de ella a dónde apunta (y el giro de un panel
alrededor de su eje), y el **asa de apuntar** (la línea a su objetivo) mueve
el objetivo de la luz o el de la cámara; en ejes globales o los suyos
(derecha, arriba, atrás), con los incrementos de `Shift`. Un arrastre es una
entrada de deshacer, y mover una cámara guardada no mueve la activa. Una
cámara bloqueada no tiene *gizmo*. La caja de selección (U7) y *Escalar*
(U9) no ven los glifos: la caja selecciona piezas al nivel vigente y el
tamaño de un foco se cambia en el inspector.

**Mirar a través** de la luz o la cámara seleccionada (botón de la barra de
vista y del inspector, `Ctrl/⌘ ⇧ L`, doble clic en su glifo): el visor mira
desde ella, en *Rápido* y en *Completo*. Una luz se ve desde su posición
hacia su objetivo, con la óptica de la cámara activa; un foco direccional
ajusta la focal para que su cono llene el lado corto del encuadre (lo que se
ve es lo que ilumina). **Orbitar, Desplazar y Zoom mueven ese objeto**: la
luz va a donde está la vista y apunta a donde mira, la cámara toma la vista;
el gesto entero es una entrada de deshacer y la cámara activa no se mueve.
**Respeta *Bloquear cámara***: una cámara bloqueada se ve pero no se mueve
(el aviso lo dice). `Esc` o el botón vuelven a la cámara activa, tal como
estaba.

**Colocar por reflejo**: dado un punto de la pieza y su normal, el foco
seleccionado se coloca en la dirección reflejada del rayo de cámara, a su
distancia actual. Es la forma natural de "quiero el brillo aquí".

**Entorno**: `STUDIO` (cúpula procedural: gris 0.12 en el suelo, 0.45 en
el horizonte, 0.85 en el cenit; ilumina y se refleja, no necesita ningún
archivo), `SKY` (sol y cielo procedurales a partir del foco de tipo sol),
`FLAT` (color liso), `HDRI` (archivo del usuario, con rotación e
intensidad). Lo que ilumina y lo que ve la cámara se separan: el fondo
puede ser el entorno, un color, un degradado de dos colores (L6),
transparente o una imagen, sin cambiar la luz.

`EnvironmentState` (E5) guarda además `hdri` y `backplate` (`ImageRef`:
id, nombre, ancho y alto; los bytes viven en el registro de imágenes,
como las mallas, y el proyecto los lleva dentro), `backplateFit`
(`FILL` · `FIT` · `STRETCH`: la imagen cubre el encuadre recortándose,
cabe entera con el color alrededor, o se estira), `skyTurbidity` (bruma
del cielo, 3 por defecto: 2 muy limpio, 6 brumoso) y `skySun` (`az`,
`el`: el sol del cielo cuando el montaje no tiene foco de sol, relativo a
la cámara como un foco; -55°, 55° por defecto). Con un foco de sol
encendido en el montaje, ese foco coloca el sol del cielo. `skyModel`
(E5c) elige el modelo: `PHYSICAL` (por defecto, también para los
proyectos guardados antes de que existiera), nuestro cielo físico: la
forma funcional de Hošek y Wilkie (2012) con coeficientes ajustados por
nosotros a nuestra propia simulación de la atmósfera; o `CLASSIC`, el de
Preetham (1999) de E5. Los dos se escalan para que una superficie
horizontal reciba la misma luz que con la cúpula de los mismos valores;
solo de día (el sol, a 0° como mínimo en el físico y a 1° en el clásico). Un `HDRI` sin archivo cargado ilumina con la
cúpula; una imagen de fondo sin archivo muestra el color. Un panel con `camera = true` se pinta como **campo claro en el
fondo** (disco suave centrado en el encuadre), nunca como un rectángulo
visible con bordes.

### 3.5 · Cámara

`CameraState`: nombre, posición y objetivo (o acimut, elevación y
distancia alrededor del objetivo), focal en mm sobre sensor de 36 mm,
diafragma, distancia de enfoque, perspectiva u ortográfica (con ancho
ortográfico), clipping, `locked`. Cámara de referencia: acimut −35°,
elevación 22° (tres cuartos), distancia derivada de la focal y el tamaño
de pieza para que encaje con un margen del 10 %.

**Encuadrar**: ajusta la distancia (o el ancho ortográfico) para que la
caja envolvente de la selección (o de todo) quepa con margen, sin mover
la orientación. Las **cámaras guardadas** se ven en el visor como pirámides,
se mueven con el *gizmo* (la posición sin cambiar su objetivo, el giro, el
asa de su objetivo) y se **mira a través** de ellas (§3.4, *Luces y cámaras
en el visor*). **Vistas**: tres cuartos, frontal, lateral, cenital,
trasera. **Enfocar con clic**: el punto picado fija la distancia de
enfoque.

### 3.6 · Imagen

Exposición en EV, transformada de vista (`STANDARD`, `FILMIC`, `AGX`),
halo (umbral, tamaño, mezcla), nitidez, saturación, contraste, viñeta.
Se aplican en este orden fijo sobre la imagen lineal: halo → nitidez →
color → viñeta → transformada. Con todo a cero, la imagen no cambia.

### 3.7 · Animación, al estilo KeyShot

El modelo sigue el de KeyShot, visto desde fuera: **no hay fotogramas
clave que editar a mano**; cada animación es una **barra** con un
objetivo, un tipo, unos parámetros, un inicio, una duración y una curva
de tiempo, y todas conviven en **una sola línea de tiempo** con una pista
por objetivo. Lo que en la primera versión eran "planos" es la **pista
de cámara**: cada tramo dice qué cámara está activa (un *cambio de
cámara* es un evento más de la pista).

**Tipos de animación** (`MOVE_KINDS`; las claves existentes se mantienen
y se añaden las que faltan), agrupados como los agrupa el asistente:

| Grupo | Tipo | Qué hace |
| --- | --- | --- |
| Piezas | **Plato giratorio** (`SPIN` sobre el modelo) | El modelo entero gira sobre su eje vertical |
| | **Rotación** (`SPIN`, `TUMBLE` y eje libre) | Una pieza o grupo gira sobre un eje (X, Y, Z o personalizado) alrededor de un pivote (su centro, un punto, otra pieza) |
| | **Traslación** (`MOVE`, `TRACK`) | Se desplaza una distancia en un eje, local o global |
| | **Escala** (`SCALE`) | Cambia de tamaño por un factor |
| | **Fundido** (`FADE`, nuevo) | Opacidad de 0 a 1 o de 1 a 0 |
| | **Despiece** (`EXPLODE`) | Las piezas marcadas se separan del centro |
| | **Visibilidad** (`VISIBILITY`) | Aparece o desaparece |
| Cámara | **Órbita** (`ORBIT`) | Gira alrededor del objetivo, grados |
| | **Inclinación** (`RISE`) | Sube o baja en arco, grados |
| | **Zoom** (`ZOOM`) | Cambia la focal, mm |
| | **Travelling** (`DOLLY`) | Se acerca o aleja, % de la distancia |
| | **Panorámica** (`PAN`, nuevo) | Gira sobre su propio eje, grados. **Aún no está implementado** (no existe en `MoveKind` ni en `evaluate`): hasta que lo esté, el *barrido rápido* de la biblioteca de movimientos (`camera-moves.json`, A6) es una órbita rápida con curva fuerte alrededor del producto, y una variante con `PAN` se añadirá junto a él |
| | **Enfoque** (`FOCUS`) | Cambia la distancia de enfoque |
| | **Cambio de cámara** (evento de la pista de cámara) | Pasa a otra cámara en ese instante, con corte o fundido |
| | **Recorrido** (`PATH`, fase posterior) | Sigue una curva por puntos |
| | **Paseo** (`WALK`) | La cámara camina por una trayectoria a altura de ojos, con o sin simulación de pasos (ver abajo) |
| Luz y entorno | **Barrido de luz** (`HDRI`) | Gira el entorno |
| | **Intensidad** (`INTENSITY`), **Color** (`TINT`) | De un foco |
| | **Arco solar** (`SUN_ARC`, con el cielo de E5) | El sol recorre el día |
| Materiales | **Color de material** (`MATERIAL_COLOR`, nuevo), **Fundido de material** (`FADE` sobre el material) | Transición de color u opacidad |

**Paseo (`WALK`)**, pensado para mobiliario e interiores: crea la
trayectoria de la cámara por ti. La trayectoria se traza en el visor con
la herramienta *Trazar paseo* (clic en el suelo para cada punto, `⏎`
para terminar; los puntos se arrastran después) o se genera con un clic:
*Paseo alrededor de la selección* (un arco a altura de ojos que rodea la
pieza a la distancia de encuadre) y, con la habitación de K2, *Recorrido
de la sala* (entra por la puerta y recorre el espacio libre). La curva es
suave (Catmull–Rom centrípeta) y se recorre a **velocidad constante**
(1,2 m/s por defecto, editable), con arranque y parada suaves. Parámetros:
**altura de ojos** (1,5 m de pie, 1,1 m sentado, o libre), **mirada**
(*hacia delante*, *hacia un objetivo* —una pieza o un punto—, o *por
puntos*, con giro suavizado), y el interruptor **Simular pasos**: añade
el movimiento de una persona que camina —cadencia (1,8 pasos/s), balanceo
vertical (2,5 cm), balanceo lateral (1 cm), leve inclinación (0,5°)—
sincronizado con la distancia recorrida, que se apaga al pararse. Sin
simulación, la cámara se desliza como en un *travelling* de cine. Todo es
una función determinista del tiempo, como el resto de animaciones.

**Una animación** (`MotionClip`): nombre, objetivo (pieza, grupo, modelo,
cámara, foco, entorno, material), tipo, parámetros del tipo (cantidad,
eje, pivote, local o global), inicio y duración en segundos, **curva de
tiempo** (`EASING_KINDS`: lineal, suave, entrada, salida, fuerte, y
*personalizada* con una curva de dos asas), **invertida** (sí/no) y
**repetir** (n veces). Su frase en lenguaje llano ("La cámara orbita 90°
durante 4 s, suave") es su nombre por defecto y su representación en la
interfaz; también aparece **bajo su objetivo en el árbol de la escena**,
como hace KeyShot.

**Evaluación**: `evaluate(state, t)` devuelve las transformaciones y
parámetros en el instante `t` aplicando cada animación activa con su
curva y componiendo por objetivo (las rotaciones se componen en el
orden de inicio); es una función pura que la vista previa usa para
reproducir y el motor para renderizar fotograma a fotograma. Dos
animaciones del mismo tipo sobre el mismo objetivo y tiempo se suman si
son traslaciones o rotaciones y se marcan en la interfaz si no pueden
convivir; nunca se silencian.

**Reproducción**: la línea de tiempo tiene cabezal, fps (24, 25, 30, 60),
duración total (la del último evento), reproducir, pausar, ir al
principio y al final, bucle, y **vista previa rápida** (la vista previa
rasterizada) o **previa renderizada** (el motor a pocas muestras por
fotograma, fase posterior).

**Fundidos** entre cámaras: corte, fundido a color (negro o blanco), o
cruzado (fase posterior, exige dos cámaras en el solape).

**Salida**: en la barra de render, el modo **Animación** añade rango de
fotogramas (todo, o de–a), fps, y salida como **vídeo** (WebM o MP4
codificado en el navegador) o como **secuencia de fotogramas** (PNG o
JPEG con numeración), con el presupuesto de muestras o tiempo **por
fotograma** y la estimación del total; el trabajo entra en la cola como
cualquier otro.

### 3.8 · Render

Se configura en la **ventana de render** (`UI.md` §2.7), al estilo de la
de KeyShot, y no en la barra inferior. Un **trabajo de render**
(`RenderJob`) guarda: modo (*imagen* o *animación*), nombre como
plantilla, carpeta de destino (en el navegador, *Descargas* o una
carpeta elegida con el acceso al sistema de archivos donde exista),
formato (PNG 8/16 bits, JPEG con calidad, EXR lineal), fondo
transparente, pases (fase posterior: alfa, profundidad, normales, id de
pieza), cámara (una o todas), tamaño en píxeles con su tamaño de
impresión y **ppp** (los píxeles mandan; los ppp se escriben en el
archivo), **terminar por** muestras o por tiempo (o lo que llegue antes,
en avanzado), ajustes avanzados del motor, en animación el rango, los fps
y la salida (vídeo MP4/WebM o secuencia de fotogramas), y el
**post-procesado IA** con sus ajustes (`AI-POST.md`). *Render* pone el
trabajo el primero de la **cola** y lo arranca; *+ Añadir a la cola* lo
pone al final. En el estado, `render` guarda los ajustes de la ventana
y la cola; cada trabajo lleva su copia de los ajustes, estado, progreso,
fechas de creación, inicio y fin, los ids de sus resultados, el error si
lo hubo y el fotograma en curso. *Todas las cámaras* se expande en un
trabajo por cámara al entrar en la cola; una animación es un solo
trabajo. Editar la cola es deshacible; el progreso no. La cola ejecuta en serie, con progreso, pausa, reordenar y
cancelación, **siempre con el motor completo**. Cada resultado guarda la
imagen del motor y, si hubo post-procesado, también la de la IA, para
compararlas con un divisor deslizable.

### 3.9 · Estudios, biblioteca propia y proyecto

Un **estudio** guarda una cámara, un montaje de luz y entorno, un set de
materiales por pieza y la visibilidad de piezas; restaurarlo es una sola
acción deshacible. Con un set de L6 (§3.4) en vigor, el estudio guarda sus
focos (el charco incluido) y su fondo; sus tarjetas, barrido y suelo son
piezas de la escena y se quedan en ella. Fondo `GRADIENT` (L6): el entorno
guarda sus dos colores (`gradient`), en el proyecto y en los estudios de la
biblioteca. El **proyecto** es el estado completo en un archivo
`.repack.json`, con las mallas dentro.

La **biblioteca propia** guarda lo que el usuario crea y quiere reutilizar
entre proyectos: materiales (*Guardar material como…*), montajes de luz
(*Guardar montaje como…*), tipos de producto (*Guardar como tipo de
producto*: el estudio actual como preset) y estudios. Aparece como pestaña
*Míos* en cada catálogo, con miniaturas renderizadas por el producto, se
persiste en el navegador y se exporta e importa como un archivo JSON para
llevarla a otra máquina. Los presets de fábrica no se editan: editar uno
crea una copia propia.

---

### 3.10 · Interiores y mobiliario

Un **tipo de escena** (*Producto · Interior · Estudio de catálogo*) que
solo cambia valores por defecto; una **habitación** paramétrica como nodo
(medidas, aberturas, material por superficie, pared frontal oculta,
ciclorama); **ventanas que iluminan solas** (portales automáticos, vidrio
fino, vista exterior en un plano con paralaje); **cámara de interiores**
(verticales rectas, altura de ojo, panorámica, alzados y planta,
exposición automática, recorrido); Doctor de interiores; grupos de luz
ajustables tras el render; entregables de mobiliario (silos con alfa y
cotas, variantes, 360). Las decisiones, las fuentes y las fases están en
`INTERIORS.md`.

## 4 · El Doctor

Catorce chequeos, cada uno con detección y arreglo (`DOCTOR_CHECKS` en
`src/data/doctor.ts`). Los de escena se evalúan sobre el modelo: escala
plausible para el tipo de producto (una joya de 3 m está mal), origen y
apoyo en el suelo, suavizado de normales, bisel de aristas (sin bisel, las
aristas de un CAD no reflejan nada y delatan el render), clipping de
cámara, luces visibles a cámara sin querer. Los de motor se evalúan sobre
el motor activo: dispositivo, denoise, transformada de vista, cáusticas
(fireflies), datos persistentes, formato de salida de vídeo. El Doctor no
cambia nada sin que se le pida y explica cada aviso en una frase.

---

## 5 · Importación: lo que entra y cómo

La importación es el tronco del producto: lo que no entra, no se
renderiza. Se comporta como en KeyShot: arrastrar o *Importar*, una hoja
de opciones con valores que funcionan, y la pieza aparece centrada,
apoyada y encuadrada.

**Formatos y origen.** Los programas de origen tienen formatos nativos
propietarios y sin documentación pública; en sala limpia no se leen (ni
se harán análisis de sus binarios, ver `README.md`). Lo que sí se lee es
lo que cada uno **exporta** con un clic, que es lo que hace cualquiera
que trabaja con KeyShot:

| Origen | Nativo | ¿Se lee? | Camino que funciona |
| --- | --- | --- | --- |
| Rhinoceros | `.3dm` | **Sí** (openNURBS es MIT): mallas de render guardadas en el archivo, capas, materiales básicos; los B-rep sin malla de render avisan de guardar con mallas | `.3dm` directo; o STEP / OBJ / FBX |
| KeyShot | `.bip`, `.ksp` | No (propietario, sin especificación) | *File ▸ Export* de KeyShot a glTF, FBX, OBJ, USD o STL |
| Maya | `.ma`, `.mb` | No | FBX, OBJ, USD, glTF |
| SolidWorks | `.sldprt`, `.sldasm` | No (propietario) | **STEP AP214** (lo que SolidWorks exporta por defecto), IGES, 3MF, STL |
| ZBrush | `.ztl`, `.zpr` | No | OBJ (con grupos de polígonos), FBX |
| Fusion 360 | `.f3d` | No | STEP, OBJ, FBX, 3MF, STL |
| Blender, Cinema 4D, 3ds Max, SketchUp… | varios | No | glTF, FBX, OBJ, USD |
| Universal | glTF / GLB, OBJ, STL, FBX, STEP, IGES, 3MF, PLY, DAE (Collada), USD / USDZ | **Sí** | directo |

STEP e IGES (CAD de verdad: superficies, no mallas) se teselan al
importar con calidad ajustable, conservando **cada cara CAD** como rango
de triángulos (lo que hace que *Caras* seleccione una cara entera) y los
**colores y nombres** del ensamblaje. FBX trae jerarquía, materiales,
texturas incrustadas y unidades. Los formatos de malla traen lo que
traen; el importador reconstruye normales y aristas vivas si faltan.

**Hoja de importación** (en línea, no modal), con los valores por defecto
ya puestos: **unidades** del archivo (mm, cm, m, pulgadas; detectadas
cuando el formato las declara), **eje arriba** (Y o Z; detectado), **centrar**,
**apoyar en el suelo**, **encuadrar la cámara**, **añadir a la escena** o
**escena nueva**, **agrupar por** (objeto, material, capa), **mantener
materiales y texturas** del archivo o aplicar el material por defecto,
**separar piezas** (por material, por cara CAD), **calidad de teselado**
(solo CAD: tolerancia de cuerda y ángulo), **importar capas ocultas**,
**invertir normales**. Un archivo arrastrado sobre una escena con piezas
pregunta *añadir o sustituir* en línea.

Las bibliotecas de lectura de formatos viven en la capa `io/` del lado
web y se cargan bajo demanda; el motor de render no las conoce
(`ARCHITECTURE.md` §1).

## 6 · Lo que distingue este producto

- **El visor es el render.** En modo *Completo* la imagen converge donde
  se trabaja y *Render* solo la guarda a tamaño completo; el modo *Rápido*
  existe para que editar luces y materiales responda al instante, y el
  conmutador está siempre a la vista en la cabecera.
- **Lenguaje de fotógrafo** en todos los controles y una **intención**
  escrita para cada preset.
- **Catálogos por el ojo**: montajes de luz y materiales se eligen por
  miniatura, con filtros por estilo y categoría.
- **Nada se rompe en silencio**: Doctor, inventario antes de sobrescribir,
  conflictos de animación visibles, medidor honesto.
- **Todo escala con la pieza**: una receta sirve para un anillo y un sofá.
- **Sin entorno que descargar**: la cúpula de estudio procedural ilumina
  y se refleja sin ningún HDRI.
- **Interfaz en blanco y negro**: el único color en pantalla es la imagen.
- **Modo estándar por defecto**: abre listo para importar y renderizar;
  los presets son atajos, y todo lo que hace un preset se puede hacer a
  mano y guardar como propio.
- **Importa lo que la gente exporta**: STEP, IGES, 3DM, FBX, OBJ, glTF,
  USD, 3MF, STL, PLY, DAE, con una hoja de opciones al estilo KeyShot.
- **Motor propio, en Rust y sin dependencias**, que corre en cualquier
  máquina: en el navegador por WebAssembly, en la línea de comandos y en
  el escritorio en nativo, con el mismo resultado píxel a píxel.
