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
   formato; *Render* o *Añadir a la cola*. El visor ya es el render: el
   botón solo lo lleva a resolución y calidad completas y lo guarda.
7. **Animación** (opcional). Planos y movimientos en lenguaje llano,
   presets, línea de tiempo de bloques, vídeo.

El **Doctor** vigila todo el rato y arregla con un clic lo que suele
estropear un render: escala absurda, pieza bajo el suelo, suavizado,
bisel de aristas, clipping de cámara, luces visibles, cáusticas, formato.

---

## 3 · Modelo de datos

### 3.1 · Escena

Un **árbol** de nodos. Tipos: `MODEL` (raíz de una importación), `GROUP`
(ensamblaje), `PART` (malla), `CAMERA`, `LIGHT`, `FLOOR`. Cada nodo:
`id`, `name`, `parent`, `children`, `transform` (posición, rotación en
grados, escala; local al padre), `visible`, `locked`. Una `PART` lleva
además `mesh` (id de geometría: posiciones, normales, índices, uv
opcional, y aristas vivas si el importador las trae), `material`
(instancia) y `faceMaterials` opcional (rangos de triángulos → instancia,
para el nivel *Caras*).

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

Todas son acciones del *store*, deshacibles, y las que tienen sentido en
masa aplican a toda la selección.

### 3.2 · Selección por niveles

`level ∈ {MODEL, GROUP, PART, FACES}`, excluyentes. Un clic en el visor
selecciona el ancestro del nivel elegido; `GROUP` sobre una pieza sin
grupo selecciona la pieza. `FACES` guarda `{part, triangles[]}`. La
selección decide el objetivo de materiales, de *Apoyar*, *Centrar*,
*Ocultar*, y del inspector.

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
| `GLASS` | dieléctrico con transmisión, IOR, rugosidad, color de absorción | `ior`, `transmission` |
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

**Luces propias, al estilo KeyShot.** Además de los montajes, se pueden
**añadir focos** desde la pestaña *Luces*: **Área** (rectángulo, disco o
esfera, con tamaño), **Punto** (radio), **Foco direccional** (ángulo de
cono y transición), **Sol** (ángulo del disco), y **IES** (perfil de
archivo; fase posterior). Cada foco es un nodo de la escena con
transformación propia: se mueve y apunta con el mismo *gizmo* que las
piezas, se **apunta a una pieza** (*Apuntar a…*), se **coloca por
reflejo** o **sobre una superficie** (clic: el foco queda a una distancia
dada a lo largo de la normal). Propiedades: potencia en vatios (y su
equivalente en lúmenes como ayuda), temperatura de color o color,
tamaño, dispersión, *visible en reflejos*, *visible a cámara*, *proyecta
sombra*, encendido. Cualquier pieza con material emisor también ilumina.
Un rig editado a mano se **guarda como montaje propio** (nombre, estilo
*Míos*, miniatura renderizada por el propio producto) en la biblioteca
del usuario, con la misma normalización de exposición que los del
catálogo cuando se aplica a otro tipo de producto.

**Colocar por reflejo**: dado un punto de la pieza y su normal, el foco
seleccionado se coloca en la dirección reflejada del rayo de cámara, a su
distancia actual. Es la forma natural de "quiero el brillo aquí".

**Entorno**: `STUDIO` (cúpula procedural: gris 0.12 en el suelo, 0.45 en
el horizonte, 0.85 en el cenit; ilumina y se refleja, no necesita ningún
archivo), `SKY` (sol y cielo procedurales a partir del foco de tipo sol),
`FLAT` (color liso), `HDRI` (archivo del usuario, con rotación e
intensidad). Lo que ilumina y lo que ve la cámara se separan: el fondo
puede ser el entorno, un color, transparente o una imagen, sin cambiar la
luz. Un panel con `camera = true` se pinta como **campo claro en el
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
la orientación. **Vistas**: tres cuartos, frontal, lateral, cenital,
trasera. **Enfocar con clic**: el punto picado fija la distancia de
enfoque.

### 3.6 · Imagen

Exposición en EV, transformada de vista (`STANDARD`, `FILMIC`, `AGX`),
halo (umbral, tamaño, mezcla), nitidez, saturación, contraste, viñeta.
Se aplican en este orden fijo sobre la imagen lineal: halo → nitidez →
color → viñeta → transformada. Con todo a cero, la imagen no cambia.

### 3.7 · Animación

**Planos**: lista de duraciones en segundos; el tiempo total es su suma.
**Movimientos** (`MotionClip`): objetivo (cámara, pieza o grupo, foco,
entorno), tipo (`MOVE_KINDS`: orbitar, subir, acercar, travelling,
trasladar, girar, volcar, escalar, zoom óptico, enfoque, intensidad,
color, barrido de luz, despiece, visibilidad), plano de referencia para
la cámara, inicio, duración, cantidad y suavizado (`EASING_KINDS`). Cada
movimiento se puede escribir como una frase ("La cámara orbita 90° durante
4 s, suave"), y esa frase es su representación en la interfaz.

**Evaluación**: `evaluate(state, t)` devuelve las transformaciones y
parámetros en el instante `t` aplicando cada movimiento activo con
`ease()` y componiendo por objetivo; es una función pura que usa la vista
previa para reproducir y el motor para renderizar fotograma a fotograma.
Conflicto: dos movimientos del mismo tipo sobre el mismo objetivo y
tiempo se marcan en la interfaz, no se silencian.

**Fundido** entre planos: a color (negro o blanco) con curva; el fundido
cruzado es una fase posterior.

### 3.8 · Render

`quality` (borrador 64 muestras, previa 256, final 1024; o a medida),
resolución, presupuesto (`maxSamples`, `maxSeconds`: lo que llegue
antes), formato (PNG 8/16 bits, JPEG con calidad, EXR lineal), fondo
transparente, pases (fase posterior: alfa, profundidad, normales, id de
pieza). La **cola** acumula trabajos (cámara, estudio, resolución,
calidad) y los ejecuta en serie con progreso y cancelación.

### 3.9 · Estudios, biblioteca propia y proyecto

Un **estudio** guarda una cámara, un montaje de luz y entorno, un set de
materiales por pieza y la visibilidad de piezas; restaurarlo es una sola
acción deshacible. El **proyecto** es el estado completo en un archivo
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

- **El visor es el render.** No hay dos modos: la imagen converge donde se
  trabaja y *Render* solo la guarda a tamaño completo.
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
