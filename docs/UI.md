# Interfaz — especificación para quien la construye

Este documento describe la interfaz de Repackshot con el detalle suficiente
para construirla leyendo solo esto, `ARCHITECTURE.md` y los catálogos de
`src/data/`. Es la entrega de la fase **U1** del roadmap, asignada a
**Opus**. Las decisiones de diseño están tomadas; lo que queda abierto se
dice explícitamente.

Lo que persigue: la **misma potencia que un renderizador de producto
comercial, con la mitad de interfaz**. Una sola idea organiza todo:

> **A la izquierda, lo que hay en la escena. En el centro, la imagen. A la
> derecha, lo que estás editando.** Y abajo, el único botón que de verdad
> importa: *Render*.

---

## 1 · Estética: blanco y negro, sobria, minimalista

**Regla absoluta: el cromo de la interfaz es acromático.** Ningún elemento
de la interfaz lleva color: ni acentos azules, ni semáforos verde/rojo, ni
iconos de colores. Solo blanco, negro y grises neutros (`hue = 0`,
`saturation = 0`). El único color en pantalla es el **contenido**: el
render del visor y las miniaturas de materiales y montajes de luz. Esa
asimetría es a propósito: con el cromo mudo, el ojo juzga el color de la
imagen sin interferencias, que es lo que se hace en un estudio de
fotografía.

Dónde otros usan color, aquí se usa **contraste, peso y espacio**:

| Necesidad | Solución acromática |
| --- | --- |
| Botón primario (*Render*, *Crear estudio*) | Relleno invertido: negro sobre blanco en tema claro, blanco sobre negro en tema oscuro |
| Selección (pieza, miniatura, pestaña) | Borde de 1.5 px en el color de tinta + fondo invertido suave |
| Error / aviso del Doctor | Punto relleno + texto en peso 600; nunca rojo |
| Estado "activo" de un toggle | Relleno invertido del propio toggle |
| Enlace o acción secundaria | Subrayado fino a 1 px, sin color |
| Hover | Fondo un escalón más claro (oscuro) o más oscuro (claro) |

**Dos temas, los dos acromáticos.** Por defecto **oscuro**: el visor es el
protagonista y una imagen se juzga mejor con un entorno oscuro y neutro.
Tema **claro** como alternativa, respetando `prefers-color-scheme` al
arrancar y con conmutador manual en el menú de la cabecera. Los dos se
definen como *tokens* en `:root` y `:root[data-theme]`; ningún color se
escribe en un componente.

```css
:root {                       /* tema claro */
  --bg-0: #ffffff;  --bg-1: #f4f4f4;  --bg-2: #e9e9e9;  --bg-3: #d9d9d9;
  --ink-0: #000000; --ink-1: #333333; --ink-2: #6b6b6b; --ink-3: #9a9a9a;
  --line: #d0d0d0;  --line-strong: #000000;
  --viewport-bg: #8c8c8c;     /* gris neutro 18 % de reflectancia perceptual */
}
:root[data-theme="dark"] {
  --bg-0: #0e0e0e;  --bg-1: #161616;  --bg-2: #1f1f1f;  --bg-3: #2a2a2a;
  --ink-0: #ffffff; --ink-1: #d6d6d6; --ink-2: #9a9a9a; --ink-3: #6b6b6b;
  --line: #2e2e2e;  --line-strong: #ffffff;
  --viewport-bg: #262626;
}
```

(Los valores son el punto de partida; se pueden afinar, pero siempre con
`saturation = 0`. Un test de la suite comprueba que ningún color del CSS
tiene saturación.)

**Tipografía.** Una sola familia: `Inter, system-ui, -apple-system, "Segoe
UI", Roboto, sans-serif`, sin cargar fuentes de red (la aplicación tiene
que funcionar sin conexión). Tamaños: 13 px cuerpo, 12 px etiquetas de
campo, 11 px texto auxiliar en mayúsculas espaciadas (`letter-spacing:
0.06em`), 15 px títulos de sección. **Numerales tabulares**
(`font-variant-numeric: tabular-nums`) en todo campo numérico, para que las
cifras no bailen al cambiar.

**Iconos.** SVG en línea, monocromos, trazo de 1.5 px, caja de 16 px (20 px
en la barra del visor). Nada de fuentes de iconos ni emojis. Cada icono va
con `aria-label`. Si un concepto no tiene un icono claro, se usa texto: un
botón con la palabra *Render* se entiende mejor que cualquier glifo.

**Espaciado.** Rejilla de 4 px. Paneles con 12 px de margen interior;
secciones separadas por una línea de 1 px (`--line`), no por cajas.
Esquinas de 4 px en controles, 0 en paneles. Sin sombras paralelas salvo
en menús flotantes y la paleta de comandos (una sombra neutra suave).

**Movimiento.** Transiciones de 120 ms en hover y despliegues, ninguna en
cambios de valor. `prefers-reduced-motion` las apaga todas.

---

## 2 · Disposición

Escritorio, mínimo 1280 px de ancho. Cinco regiones fijas:

```
┌──────────────────────────────────────────────────────────────────────┐
│ CABECERA  44 px                                                      │
├──────────┬──────────────────────────────────────────┬────────────────┤
│ ESCENA   │ VISOR                                     │ INSPECTOR      │
│ 260 px   │ (ocupa todo lo que queda)                 │ 340 px         │
│          │                                           │                │
├──────────┴──────────────────────────────────────────┴────────────────┤
│ BARRA DE RENDER  56 px (desplegable: Animación · Cola)               │
├──────────────────────────────────────────────────────────────────────┤
│ ESTADO  24 px                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

- Los paneles laterales se pueden **plegar** (botón en su cabecera y
  tecla `Tab` pliega los dos a la vez: *modo imagen*). Plegados, dejan un
  carril de 36 px con sus iconos para volver a abrirlos.
- Los anchos laterales se pueden arrastrar entre 220 y 480 px; se
  recuerdan en `localStorage` (envuelto en `try/catch`).
- Por debajo de 1100 px los laterales pasan a ser cajones superpuestos al
  visor; nunca hay desplazamiento horizontal de página. El móvil no es
  objetivo, pero nada debe romperse.

### 2.1 · Cabecera

De izquierda a derecha:

1. **Menú de aplicación** (icono de tres líneas + "Repackshot"): Nuevo,
   Abrir proyecto (`Ctrl/⌘ O`), Guardar proyecto (`.repack.json`,
   `Ctrl/⌘ S`, en el mismo archivo si ya se guardó), Guardar proyecto
   como… (`Ctrl/⌘ ⇧ S`), Importar modelo,
   Exportar imagen, separador, Idioma (Inglés / Español), Tema (Oscuro /
   Claro / Sistema), **Ajustes…** (`Ctrl/⌘ ,`), separador, Guía, Atajos
   de teclado, Acerca de.
2. **Nombre del proyecto**, editable al hacer clic (texto plano, sin caja
   hasta que se edita). Un punto delante cuando hay cambios sin guardar.
3. Centro: **Deshacer / Rehacer** con el nombre de la acción en el
   tooltip ("Deshacer: asignar Oro a Cuerpo").
4. A la derecha del centro: el **modo del visor**, un segmento de dos
   posiciones **Rápido · Completo** (atajo `Ctrl/⌘ ⇧ R`). *Rápido* es la
   vista previa rasterizada: responde al instante y sirve para colocar
   luces, pintar materiales y encuadrar. *Completo* es el motor de verdad
   simulándolo todo en el propio visor, también mientras se mueve la
   cámara (baja la resolución durante el gesto y vuelve a converger al
   soltar). El tooltip lo dice en una frase. Mientras el motor no está
   cargado (sin `rt.wasm`), *Completo* se ve deshabilitado con el motivo
   en auxiliar (*Completo: el motor no está construido*), y *Render* lo
   dice también y no renderiza: la vista previa nunca se hace pasar por
   un render. **Render usa siempre el motor completo**, esté el visor
   en el modo que esté: el conmutador solo decide qué se ve mientras se
   trabaja.
5. Derecha: **Buscar o ejecutar…** (`Ctrl/⌘ K`), campo de 240 px que abre
   la paleta de comandos; icono de **Guía**; icono de **Tema**.

Nada más. Ni cinta de iconos ni pestañas de espacio de trabajo.

### 2.2 · Escena (izquierda)

Pestañas en la cabecera del panel, con icono y texto corto: **Piezas ·
Cámaras · Luces · Estudios**.

**Piezas**: árbol del modelo. Cada fila: triángulo de despliegue, icono
de nivel (modelo / grupo / pieza), nombre, y a la derecha, al pasar el
ratón, tres acciones en icono: ojo (ocultar), diana (encuadrar), candado
(bloquear). Clic selecciona; `Ctrl` clic añade; `Shift` clic extiende;
doble clic encuadra la pieza en el visor. Cada pieza muestra bajo su
nombre, en texto auxiliar, el material que lleva. Arrastrar un material
(una miniatura del catálogo o de *Míos*, o la esfera de la tarjeta del
material, §2.4) sobre una fila lo asigna a esa fila y a todo lo que
cuelga de ella (una pieza, un grupo, el modelo): la fila se marca con un
borde discontinuo y el visor contornea lo que alcanzaría la suelta. Es una
sola entrada de deshacer (*Deshacer: asignar Oro a Cuerpo*), `Alt` al
soltar da una copia propia del material, `Esc` cancela y, si el destino
lleva materiales distintos, antes se pregunta en línea (§4.1). Menú contextual
(botón derecho): Aislar, Ocultar, Mostrar todo, Renombrar, Apoyar en el
suelo, Centrar, Eliminar.

Encima del árbol, un campo de **filtro** por nombre y, al lado, el
**selector de nivel** de la selección (ver §4.1).

El **menú contextual** completo de una fila (fase U3, con las acciones de
`SPEC.md` §3.1): Encuadrar · Mover (activa el *gizmo*) · Apoyar en el
suelo · Centrar · Centrar y apoyar · Restablecer transformación ·
Establecer pivote ▸ (centro, base, origen, punto picado) · Fijar como
objetivo de cámara · separador · Ocultar · Aislar · Mostrar todo ·
Bloquear · separador · Duplicar · Duplicar enlazado · Patrón ▸ (lineal,
circular) · Agrupar · Desagrupar · Mover a grupo ▸ · separador ·
Material ▸ (Desenlazar, Enlazar con…, Copiar, Pegar, Seleccionar por
material) · Geometría ▸ (Invertir normales, Suavizado…, Separar por
caras CAD, Separar por material) · separador · Renombrar · Eliminar.
En U1 existen las que ya están en §2.2 y el resto se añade en U3 sin
cambiar la estructura del menú.

**Cámaras**: lista de cámaras guardadas con la activa marcada. Botones:
*Nueva desde la vista actual*, *Duplicar*, *Eliminar*. Clic activa la
cámara en el visor.

**Luces**: la lista de focos del montaje activo (Principal, Relleno,
Contra, Cenital…) más los **focos propios**, con su potencia relativa en
una barra fina y un interruptor cada uno. Clic selecciona el foco y el
inspector lo edita. Botón **+ Añadir luz** con menú: Área (rectángulo,
disco, esfera), Punto, Foco direccional, Sol, IES (*próximamente*). Un
foco nuevo aparece delante y arriba de la pieza, encendido y seleccionado.
Acciones por fila: duplicar, apuntar a la selección, eliminar. Debajo,
**Guardar montaje como…** (nombre; va a la pestaña *Míos* del catálogo
con miniatura renderizada) y **Restablecer al montaje** cuando el rig
está modificado.

**Estudios**: combinaciones guardadas de cámara + montaje de luz + entorno
+ set de materiales, como en KeyShot pero sin pantalla aparte: *Guardar
como estudio* toma la escena actual; clic en un estudio la restaura.

### 2.3 · Visor (centro)

El visor **es** el render: no hay modo "vista previa" distinto del modo
"render". Lo que se ve es lo que saldrá, a menos muestras.

Capas sobre el visor, siempre con fondo semitransparente del tema y sin
tapar la pieza:

- **Arriba a la izquierda, barra de vista**: Seleccionar (`V`), Orbitar
  (`O`), Desplazar (`P`), Zoom (`Z`), separador, Encuadrar todo (`F`),
  Vistas (menú: tres cuartos, frontal, lateral, cenital, trasera),
  Perspectiva / Ortográfica, separador, Bloquear cámara. Con *Seleccionar*
  o *Mover* y el nivel *Caras*, junto a las herramientas aparece el botón
  de texto **Rayos X** (la caja de selección coge también las caras
  ocultas).
- **Arriba a la derecha**: nombre de la cámara activa (clic: lista) y
  resolución de salida actual (clic: abre la barra de render).
- **Abajo a la izquierda, medidor de calidad**: modo y motor activos,
  muestras acumuladas, tiempo, y un pequeño indicador de progreso. En
  *Rápido* dice literalmente *Rápido · vista previa rasterizada*; en
  *Completo* dice *Completo · 128 muestras · 00:12* y, durante un gesto
  de cámara, *Completo · ¼ de resolución*. Una segunda línea dice *3
  workers · SIMD* en *Completo* y *x ms por fotograma* en *Rápido*.
  **Nunca se inventa un número.**
- **Abajo a la derecha**: ejes de orientación (tres trazos finos X Y Z,
  monocromos) y el tamaño de la pieza en mm.
- **Al pasar por una pieza**: su contorno se ilumina (silueta de 1 px en
  tinta) y una etiqueta pequeña con su nombre sigue al cursor. Clic
  selecciona; `Esc` deselecciona.

**Estado vacío** (sin modelo): zona de arrastre con borde discontinuo y
dos botones: *Importar modelo* (glTF, OBJ, STL, FBX, 3DM, STEP, IGES, 3MF,
PLY, DAE, USD; en U1 solo glTF funciona y el resto dice *próximamente*) y
*Cargar pieza de ejemplo*. Arrastrar un archivo sobre cualquier punto del
visor también importa. El estudio *Estándar* ya está construido detrás:
la pieza aparece iluminada, apoyada y encuadrada sin tocar nada.

**Hoja de importación** (fase I3): al soltar o elegir un archivo, el
inspector muestra una hoja en línea con las opciones de `SPEC.md` §5
(unidades, eje arriba, centrar, apoyar, encuadrar, añadir o sustituir,
agrupar por, mantener materiales, separar piezas, calidad de teselado) con
los valores detectados ya puestos y un botón primario *Importar*. `Enter`
importa con los valores por defecto.

**Herramienta de mover** (fase U3): con una selección y la herramienta
*Mover* (`M`) activa, un *gizmo* sobre el pivote con asas de traslación
(flechas por eje y planos), rotación (anillos) y escala (cubos), en ejes
locales o globales (`L`/`G` o el conmutador de la barra de vista),
incrementos con `Shift`, y los campos del inspector actualizándose en
vivo. Arrastrar es una sola entrada de deshacer. Las luces se mueven y
apuntan con el mismo *gizmo* (la asa de apuntar es una línea al objetivo).

**Arrastrar un material** (la misma fuente que en §2.2) sobre una pieza
del visor lo asigna **al nivel de selección vigente**, igual que lo
seleccionaría un clic en ese punto: con *Pieza*, la pieza; con *Grupo*,
su ensamblaje (la pieza si no tiene); con *Modelo*, el modelo entero; con
*Caras*, la cara entera bajo el cursor (la cara CAD, o la superficie que
continúa, §4.1). Mientras se arrastra, una miniatura fantasma, arriba y a
la derecha del puntero, lleva el nombre del material y dice *Copia* si se
pulsa `Alt`; lo que alcanzaría la suelta se resalta (contorno en las
piezas, tinte en las caras; se ve aunque *Contorno al pasar* esté
apagado) y el cursor dice si se puede soltar. Soltar asigna con **una sola
acción** y una entrada de deshacer; `Esc`, soltar fuera o salir de la
ventana cancelan, y un clic sin mover en la miniatura sigue asignando a la
selección. Un preset del catálogo o un elemento de *Míos* entra con la
instancia que la escena ya tiene (la misma que un clic); la esfera de la
selección **enlaza** el destino con su instancia (las piezas que la llevan
comparten los cambios); con `Alt`, cualquiera de las tres da una **copia
propia**. Si el destino lleva materiales distintos, se pregunta en línea
antes de sobrescribir (§4.1). Un dedo no arrastra; el lápiz hace lo que el
ratón.

**Selección por caja** (herramientas *Seleccionar* y *Mover*, esta
última donde no hay un asa del *gizmo* bajo el puntero): **`Ctrl/⌘` +
arrastrar** con el botón izquierdo dibuja un rectángulo que **sustituye**
la selección; con `Shift` además (`Ctrl/⌘ ⇧` + arrastrar) **añade**, y con
`Alt` (`Ctrl/⌘ Alt` + arrastrar) **quita**. De izquierda a derecha es una
**ventana** (coge lo que queda entero dentro; contorno continuo), de
derecha a izquierda es un **cruce** (coge lo que toca; contorno
discontinuo); los dos en tinta, sin color. Actúa al nivel vigente (§4.1):
*Modelo*, *Grupo* y *Pieza* prueban la geometría proyectada de cada
nodo (las piezas ocultas no cuentan, y no se mira qué tapa a qué: una
pieza detrás de otra también se coge); *Caras* coge las caras enteras de **una pieza** (la seleccionada o,
si no hay, la que está en el centro de la caja) que **se ven** dentro del
rectángulo, y el botón **Rayos X** de la barra de vista (solo a ese nivel)
las coge también aunque otras las tapen. Un arrastre de pocos píxeles es
un clic (con sus teclas), `Esc` cancela, la caja solo dibuja el
rectángulo (la selección cambia al soltar) y, como toda selección, no deja
entrada de deshacer. La cámara no pierde nada: sin tecla, el botón
izquierdo sigue orbitando, y `Shift` o `Alt` + arrastrar sin `Ctrl/⌘`
son de la cámara como siempre; con *Seleccionar* y *Mover*, `Ctrl/⌘` +
arrastrar ya no desplaza (quedan el botón derecho, la rueda y la
herramienta *Desplazar*). Con el esquema *Alt + botón izquierdo orbita*
o *Botón central orbita* (§2.9) el botón izquierdo está libre y **un
arrastre sin más** dibuja la caja: `Shift` añade, con el central `Alt`
quita y con *Alt + izquierdo* quitar es `Ctrl/⌘ Alt`. El lápiz es un
ratón; un dedo sigue orbitando. El tooltip de *Seleccionar* lo cuenta, y
funciona igual en *Rápido* y en *Completo*. Los **clics** no cambian: sin
tecla sustituye, `Shift` añade, `Ctrl/⌘` mete o saca, `Alt` quita (salvo
con *Alt + botón izquierdo orbita*, donde `Alt` es de la cámara), y un
clic en vacío limpia.

### 2.4 · Inspector (derecha)

Es **contextual**: edita lo que está seleccionado, y cuando no hay nada
seleccionado edita la escena. Cabecera con una **miga de pan** que dice
qué se está editando (*Escena* · *Cuerpo* · *3 piezas* · *Principal*) y,
con una pieza seleccionada, el **selector de nivel** (§4.1).

El contenido se organiza en **secciones desplegables** con título en
mayúsculas espaciadas, una línea separadora y el estado de despliegue
recordado. Cada control aplica **al instante**; no hay botones *Aplicar*
salvo los dos que construyen cosas: *Crear estudio* y *Render*.

**Con la escena seleccionada (nada seleccionado):**

1. **Producto** — Tipo de producto (desplegable con los 16
   `STUDIO_PRESETS`, *Estándar* el primero y activo por defecto, con su
   etiqueta y, debajo en auxiliar, focal y diafragma que trae; más los
   tipos propios de la pestaña *Míos* y *Guardar como tipo de producto*). Tamaño de la pieza en mm (detectado al importar,
   editable). Interruptores *Suelo* y *Sombra de contacto*. Botón
   primario **Crear estudio**: monta luces, suelo, cámara y ajustes de
   motor del preset. Si ya hay estudio, pide confirmación en línea (no
   modal): "Sustituir el estudio actual · Sí / No".
2. **Luz** — El **catálogo de montajes**: fila de pestañas de estilo
   (*Todos* + los 8 `LIGHT_STYLES`), rejilla de miniaturas de 3 columnas
   (`icons/thumb_<clave>.png`, 160×120, con la etiqueta debajo), la
   activa con borde de selección. Debajo, la **intención** del montaje
   activo en una frase. Flechas *anterior / siguiente* dentro del estilo.
   Desplegable secundario **Afinar focos**: lista de focos con potencia
   (en % del total), tamaño, temperatura en K y ángulo; cambiar algo
   aquí no cambia de montaje, lo marca como *modificado*. Botón
   **Colocar por reflejo**: el cursor cambia y el siguiente clic sobre
   la pieza coloca el foco seleccionado de modo que su reflejo caiga ahí
   (en U1 basta con el modo y la mecánica; el cálculo exacto es de la
   fase del motor).
3. **Entorno** — Tipo: *Cúpula de estudio* (procedural, por defecto),
   *Cielo* (sol y cielo procedurales), *Plano* (color liso), *Archivo
   HDRI*. Intensidad, rotación. Fondo: *El mismo entorno*, *Color*
   (muestra), *Transparente*, *Imagen de fondo*. Sombra en el suelo y
   reflejo en el suelo (intensidad).
4. **Cámara** — Preset de óptica (8 `LENS_PRESETS`), focal en mm (campo
   arrastrable), diafragma (f/), distancia de enfoque + botón *Enfocar
   con clic*, interruptor Perspectiva / Ortográfica, *Encuadrar*, y
   *Guardar como cámara*.
5. **Imagen** — Exposición (EV), transformada de vista (Estándar /
   Fílmica / AgX), halo, nitidez, saturación, contraste, viñeta. Todo con
   deslizador y valor.

**Con una o varias piezas seleccionadas:**

1. **Material** — Tarjeta del material actual: miniatura esférica,
   nombre, categoría, y botón *Cambiar…* que despliega el **catálogo**:
   pestañas de categoría (`MATERIAL_CATEGORIES`), rejilla de esferas de
   4 columnas con el nombre debajo, filtro por texto. Clic asigna a la
   selección al nivel elegido (§4.1); **arrastrar también vale**: la
   miniatura se suelta sobre una pieza del visor (§2.3) o una fila del
   árbol (§2.2), y `Alt` al soltar da una copia propia. La esfera de la
   tarjeta del material se arrastra igual (salvo la del material neutro
   por defecto, que no es nada que repartir) y **enlaza** el destino con
   esa instancia. A nivel *Caras* el catálogo aparece cuando hay una cara
   seleccionada (mientras no, el inspector dice *Haz clic en una cara…*) y
   la suelta cae en la cara bajo el cursor. Debajo, los
   **parámetros** de la familia del material: color, metal, rugosidad,
   barniz, IOR, transmisión, opacidad, anisotropía, subsuperficie; madera
   (dos colores, densidad de anillos…); tela (dos colores de hilo, tipo de
   tejido, hilos por cm, pelusa); emisor (tipo, temperatura, potencia).
   Solo se pintan los que la familia usa. Un botón *Convertir en material
   propio* separa la instancia del preset cuando se edita (el nombre pasa
   a "Oro (editado)").
2. **Desgaste** — Tres botones rápidos (*Nuevo · Usado · Viejo*), los 9
   básicos de `WEAR_PRESETS` en una fila de chips, el mando maestro, y
   un deslizador por tipo (solo los de `WEAR_FAMILY_TYPES` para la familia
   actual) que despliega sus mandos al activarse. Escala, semilla, *variar
   por pieza*, y *Aplicar a toda la pieza*.
3. **Pieza** — Nombre, visible, bloqueada, posición / rotación / escala
   (tres campos por fila, arrastrables), *Apoyar en el suelo*, *Centrar*,
   radio de bisel de aristas (mm), suavizado.

**Con un foco seleccionado:** nombre, rol (si viene de un montaje), tipo
(área / punto / foco direccional / sol), forma, tamaño, **posición**
(acimut y elevación relativos a cámara, y distancia; o XYZ en el
desplegable *Coordenadas*), **apuntar a** (origen, pieza, punto),
dispersión o ángulo de cono, temperatura o color, potencia en vatios
(con el equivalente en lúmenes en auxiliar), *visible en reflejos*,
*visible a cámara*, *proyecta sombra*, encendido; botones *Colocar por
reflejo*, *Colocar sobre superficie*, *Duplicar*, *Eliminar*.

**Pestaña *Míos*** en cada catálogo (materiales, montajes de luz, tipos de
producto, estudios): lo guardado por el usuario, con miniatura, renombrar
y eliminar al pasar el ratón, y los botones *Exportar biblioteca* e
*Importar biblioteca* (JSON) al pie. Fase U4.

**Con una cámara seleccionada:** lo mismo que la sección Cámara de la
escena, más nombre y *Activar*.

### 2.5 · Barra inferior: Animación · Cola · Render

Siempre visible, 48 px. La configuración del render **no vive aquí**:
vive en la **ventana de render** (§2.7), que se abre con el botón
*Render…*. La barra queda con tres cosas:

- A la izquierda, los cajones **Animación** y **Cola** (abren un cajón de
  240 px sobre la barra). *Cola* lleva un contador de trabajos pendientes
  y, mientras hay uno en marcha, una barra de progreso fina en su borde
  inferior con el nombre del trabajo y el tiempo restante en el tooltip.
- En el centro, en texto auxiliar, el último resultado (*Joyería_Cámara 1
  · 1920 × 1080 · hace 2 min*); clic lo abre en el visor de resultados
  (§2.8).
- A la derecha, **Render…** (botón primario, el más grande de la
  pantalla; `Ctrl/⌘ ⏎`), que abre la ventana de render. `Ctrl/⌘ ⇧ ⏎`
  renderiza directamente con los últimos ajustes, sin abrir la ventana.

**Cajón Animación**, al estilo de la línea de tiempo de KeyShot (la
versión de U1 con planos y tarjetas se sustituye en N1 por esto):

- **Cabecera del cajón**: ir al principio, reproducir / pausar, ir al
  final, bucle; cabezal en `s` y en fotograma; fps; duración total;
  conmutador *Vista previa rápida / Previa renderizada*; zoom de la línea
  de tiempo; **+ Añadir animación** (abre el asistente) y *Presets*
  (`SEQUENCE_PRESETS`, que añaden varias barras de golpe).
- **Pistas**: una fila por objetivo con animaciones (cámara arriba,
  después piezas y grupos, luces, entorno, materiales), con nombre y
  triángulo para plegar; la **pista de cámara** muestra los tramos de
  cámara activa y los eventos de cambio de cámara como marcas verticales
  (corte o fundido). Cada animación es una **barra** con su frase; se
  arrastra para mover el inicio y se estira por los extremos para cambiar
  la duración (ajuste a fotograma con `Shift` libre); clic la selecciona
  y el inspector pasa a editarla; doble clic renombra; menú contextual:
  Duplicar, Invertir, Repetir…, Eliminar. Regla superior en segundos y
  fotogramas; el cabezal se arrastra y, al soltarlo, el visor muestra ese
  instante.
- **Asistente de animación** (en línea, en el inspector, tres pasos con
  *Atrás / Siguiente / Terminar*): 1) **Tipo**, en una rejilla de tarjetas
  monocromas agrupadas como en `SPEC.md` §3.7 (Piezas · Cámara · Luz y
  entorno · Materiales), cada una con un icono y una frase; 2)
  **Objetivo**, la selección actual ya marcada y la posibilidad de
  cambiarla en el árbol; 3) **Parámetros** del tipo (cantidad con unidad,
  eje, pivote, local o global, inicio, duración, curva de tiempo,
  invertida, repetir) con la frase resultante actualizándose en vivo.
  *Terminar* añade la barra y la selecciona.
- **Inspector de una animación**: nombre, objetivo (cambiable), tipo,
  parámetros, inicio y fin (o duración), curva de tiempo con un pequeño
  gráfico y, en *personalizada*, dos asas arrastrables, invertida,
  repetir, y los botones *Duplicar*, *Invertir*, *Eliminar*. La frase en
  lenguaje llano arriba, siempre.
- En el **árbol de la escena**, cada objetivo con animaciones muestra un
  desplegable *Animaciones* con una fila por barra (icono del tipo +
  frase); seleccionarla selecciona la barra y viceversa.
- El vídeo se renderiza desde la **ventana de render** en modo
  *Animación* (§2.7), con los mismos botones *Render* y *+ Añadir a la
  cola* que una imagen.

**Cajón Cola**: lista de trabajos en orden (miniatura, nombre, cámara,
tamaño, *Terminar por*, IA sí o no, estado y progreso), arrastrables para
reordenar; por trabajo: *Editar* (reabre la ventana de render con sus
ajustes), *Duplicar*, *Quitar*; arriba *Iniciar cola* / *Pausar* y
*Vaciar terminados*. Los terminados quedan en la lista con su miniatura;
clic abre el visor de resultados.

### 2.6 · Barra de estado

24 px, texto auxiliar: a la izquierda el **Doctor** (un punto relleno y
"2 avisos", o un punto hueco y "Todo en orden"); clic abre su popover.
Luego: piezas · triángulos · motor y dispositivo · muestras y tiempo del
visor. A la derecha: idioma y versión.

**Popover del Doctor**: la lista de `DOCTOR_CHECKS` con estado, una frase
de qué pasa y un botón *Arreglar* por fila, más *Arreglar todo* arriba. Es
la traducción del panel Doctor de EZ Packshot. En U1 los chequeos que
dependen del motor pueden estar en estado *no disponible aún*; los de
escena (escala, origen, suavizado, bisel, clipping) se implementan sobre
el modelo de datos.

---

### 2.7 · Ventana de render, al estilo de KeyShot

Se abre con **Render…** o `Ctrl/⌘ ⏎`. Es una ventana flotante de unos
760 × 640 px centrada sobre la aplicación, con el visor visible detrás
(atenuado un 40 %), que se mueve arrastrando su barra de título y se
cierra con `Esc` o con la ×, conservando los ajustes. Los ajustes son
del proyecto (`state.render`) y se recuerdan. Toda la ventana es
acromática, como el resto del cromo.

**Barra de título**: *Render* y un segmento **Imagen · Animación** que
decide qué se va a renderizar. Debajo, tres secciones desplegables.

**1 · Salida**

- **Nombre**: plantilla con fichas insertables (`{proyecto}`,
  `{cámara}`, `{estudio}`, `{fecha}`, `{n}`) y la vista previa del nombre
  resultante en auxiliar (*Botella_Cámara 1_0001.png*).
- **Carpeta al terminar**: dónde se guarda. En el navegador, *Descargas*
  por defecto o **Elegir carpeta…** (con el acceso al sistema de
  archivos del navegador donde exista; el permiso se recuerda y la
  carpeta se muestra por su nombre); donde no exista, el selector dice
  *Este navegador solo permite descargar* y se usa *Descargas*. En el
  escritorio (P2), una ruta normal. Interruptor *Mostrar al terminar*.
- **Formato**: PNG (8 o 16 bits), JPEG (calidad), EXR; *Fondo
  transparente* cuando el formato lo admite; *Pases* (alfa, profundidad,
  normales, id de pieza) cuando existan (N2), con *próximamente* hasta
  entonces.
- **Cámara**: desplegable con *La activa*, cada cámara guardada y
  **Todas las cámaras** (un trabajo por cámara).
- **Tamaño**: desplegable de presets (`RESOLUTION_PRESETS` y
  *Personalizado*), **ancho × alto en píxeles** con candado de
  proporción, y **tamaño de impresión** en mm, cm o pulgadas con su
  **resolución en ppp (DPI)**. Los píxeles mandan: cambiar el tamaño de
  impresión recalcula los píxeles a los ppp actuales, cambiar los ppp
  recalcula el tamaño de impresión. Los ppp se escriben en el archivo
  (PNG y JPEG) para que la imprenta lea el tamaño correcto. Presets de
  impresión: A4, A3, carta, 10 × 15 cm a 300 ppp.
- **Región** (*próximamente*): un recuadro dibujado en el visor.

**2 · Calidad**

- **Terminar por**: segmento **Muestras · Tiempo**. *Muestras*: campo con
  atajos *Borrador 64 · Previa 256 · Final 1024* y valor libre. *Tiempo*:
  campo `hh:mm:ss`. En *Avanzado*, la opción *Lo que llegue antes* con
  los dos campos.
- **Estimación** en auxiliar, a partir de las muestras por segundo que
  mide el motor en el visor (*≈ 4 min en este equipo*); si el motor no
  ha medido todavía, dice *Estimación al cabo de unos segundos en modo
  Completo*. Nunca un número inventado.
- **Avanzado** (plegado): rebotes máximos, recorte de indirecta,
  semilla, cáusticas, *denoise* cuando exista.

**2 bis · Animación** (en lugar de *Tamaño*, con una fila *Tamaño del
fotograma* solo en píxeles, y encima de *Calidad*, cuando
el segmento está en *Animación*): **rango** (*Todo* o de–a en
fotogramas o segundos), **fps** (24, 25, 30, 60), duración resultante,
**salida** *Vídeo* (MP4 H.264 o WebM VP9, con calidad) o *Fotogramas*
(secuencia PNG o JPEG con numeración `0001`), *Terminar por* aplicado
**a cada fotograma**, y la estimación del total. La cámara es la pista de
cámara de la línea de tiempo.

**3 · Post-procesado IA**: el interruptor, su configurador y su vista
previa, descritos en `AI-POST.md` §4. Plegado y apagado por defecto.

**Pie de la ventana**: a la izquierda, el resumen en una línea
(*1920 × 1080 · 300 ppp · 256 muestras · PNG → Descargas · IA
apagada*); a la derecha **+ Añadir a la cola** (secundario) y
**Render** (primario). *Render* mete el trabajo en la cola **en primera
posición y lo arranca ya**, cierra la ventana y deja ver el progreso en
el botón *Cola*; es "renderizar solo esta". *+ Añadir a la cola* lo pone
al final sin arrancar, deja la ventana abierta para añadir más (aviso
*Añadido a la cola · 3 trabajos*) y es la forma de preparar lotes. En la
ventana, `⏎` es *Render* y `⇧ ⏎` es *+ Añadir a la cola*.

### 2.8 · Visor de resultados

Al terminar un trabajo, su imagen se abre en una capa sobre el visor
(no en otra ventana) con: la imagen a su tamaño o ajustada, zoom y
desplazamiento, el nombre y los datos (tamaño, muestras, tiempo,
cámara), y los botones *Guardar de nuevo*, *Abrir carpeta* (donde
exista) y *Cerrar*. Si el trabajo llevaba post-procesado IA, se
conservan **las dos imágenes** (la del motor y la de la IA) y el visor
muestra un **divisor deslizable** vertical: a la izquierda el render del
motor, a la derecha el de la IA, con una asa que se arrastra (y las
teclas ← →), etiquetas *Render* · *IA* en las esquinas y los botones
*Solo render*, *Solo IA*, *Dividir*; se pueden guardar las dos. Los
resultados quedan en el historial del proyecto (cajón *Cola*,
terminados) y en el almacenamiento del navegador hasta que se borran.

### 2.9 · Ventana de Ajustes

Se abre con **Ajustes…** del menú de aplicación o `Ctrl/⌘ ,`. Es la
segunda y última ventana de la aplicación (§4.3): flotante, unos
**960 × 680 px** centrada, el resto atenuado un 40 %, se mueve por su
barra de título y se cierra con `Esc` o la ×. Acromática como todo el
cromo. Se recuerda la última sección abierta.

**Los cambios se aplican al momento.** No hay *Aceptar* ni *Cancelar*:
el pie dice *Los cambios se guardan al momento*. Los ajustes son de la
aplicación en este equipo (no del proyecto) y no entran en deshacer; los
valores por defecto de proyecto que se fijan aquí (render, importación)
se aplican a los proyectos **nuevos**, nunca cambian el abierto.

**Columna izquierda** (232 px): arriba un campo **Buscar ajustes**
(`Ctrl/⌘ F` dentro de la ventana) que filtra por nombre y palabras clave
en los dos idiomas y muestra los resultados con su ruta
(*Motor de renderizado ▸ Hilos*); debajo las secciones agrupadas, con el
título del grupo en versalitas auxiliares:

| Grupo | Sección | Qué hay |
| --- | --- | --- |
| **Aplicación** | **General** | Idioma; tema (Oscuro · Claro · Sistema); al arrancar (*Modo estándar con el ejemplo* · *Proyecto vacío* · *Último proyecto*); unidades de la interfaz (mm, cm, m, pulgadas); recuperación automática (copia cada N minutos en el almacenamiento, *próximamente* hasta U2); confirmar al cerrar con cambios sin guardar |
| | **Preferencias** | *Visor y navegación*: modo del visor al arrancar (Rápido · Completo · El último), esquema del ratón (*Botón izquierdo orbita* · *Alt + botón izquierdo orbita* · *Botón central orbita*; la línea auxiliar cuenta también cómo se dibuja la caja de selección en cada uno), invertir zoom, velocidad de órbita y de zoom, resolución durante los gestos en Completo (Automática · ½ · ¼), rejilla del suelo, tamaño del *gizmo*. *Selección*: nivel por defecto, contorno al pasar. *Importación por defecto*: unidades si el archivo no las dice, eje arriba, calidad de teselado CAD, abrir la hoja de importación (*Siempre* · *Solo si hay dudas*). *Render por defecto* para proyectos nuevos: plantilla de nombre, carpeta, formato, ppp, *Terminar por* |
| | **Accesibilidad** | Tamaño de la interfaz (90–150 %), tamaño del texto, **contraste alto** (bordes y texto auxiliar más fuertes, sigue acromático), **reducir movimiento** (Sistema · Sí · No), foco siempre visible, retardo de los tooltips, anunciar el progreso del render a los lectores de pantalla, subrayar la letra de acceso en los menús |
| | **Atajos de teclado** | La lista completa de §3, agrupada y con buscador; cambiar un atajo: *próximamente* |
| **Render** | **Motor de renderizado** | Motor (*Nativo, todos los hilos* en escritorio · *Navegador, WebAssembly*); hilos (*Automático* o un número; en el navegador, *workers*); SIMD (Automático · Desactivado); límite del visor en Completo (parar a las N muestras o a los N segundos, para no gastar batería); **Medir rendimiento** (renderiza la escena de ejemplo 10 s y muestra las muestras por segundo medidas, con hilos y SIMD; nunca un número inventado); datos del motor (versión, compilación, CPU, extensiones SIMD, hilos) |
| | **Post-procesado IA** | Tres apartados, en este orden: **Modelo activo**, **Modelos** y **Equipo** (detalle abajo). Mientras la tubería de X3 no exista, arriba una línea en auxiliar: *El post-procesado llega en una próxima versión; ya puedes descargar, importar y preparar modelos* |
| **Sistema** | **Almacenamiento** | Espacio usado por categoría (modelos, historial de resultados, biblioteca, caché) con barra y *Liberar* por fila; límite del historial (número y tamaño); pedir almacenamiento persistente al navegador; en escritorio, la carpeta de datos con *Abrir carpeta* |
| | **Escritorio** | Solo en la aplicación de escritorio: modo portable (sí o no y dónde están los datos), navegador que dibuja la ventana, carpeta de registros, *Buscar actualizaciones* (*próximamente*) |
| | **Acerca de** | Versión, licencia (PolyForm Noncommercial 1.0.0, resumen y texto completo), **licencias de terceros** con su texto (three.js, rhino3dm, occt-import-js con el enlace a su código fuente, y los modelos de IA descargados con la suya), créditos (EZ Packshot) |

**Columna derecha**: título de la sección, una frase de qué se ajusta
ahí y las filas en bloques con un subtítulo y una línea fina entre
bloques. Cada fila: nombre, una línea auxiliar si hace falta, y el
control a la derecha (segmento, interruptor, campo numérico de §4.4,
desplegable). Una fila con un valor distinto del de fábrica lleva un
punto y, al pasar, *Restablecer* en línea; al pie de cada sección,
*Restablecer esta sección*. Lo que no existe todavía se ve,
deshabilitado, con *próximamente*.

**Ratón y caja de selección.** La fila *Ratón* (Preferencias ▸ Visor y
navegación) dice en su línea auxiliar qué botón orbita (el derecho
desplaza y la rueda hace zoom) y cómo se dibuja la caja de selección
(§2.3): *con la herramienta Seleccionar, `Ctrl/⌘` + arrastrar dibuja una
caja de selección en cualquier caso (añade `Shift` para añadir, `Alt` para
quitar); donde el botón izquierdo está libre, un arrastre sin más
también*. La frase ocupa tres o cuatro líneas auxiliares según el
idioma, sin desbordar la fila, y el tooltip de *Seleccionar* cabe en sus
280 px.

**Post-procesado IA ▸ Modelo activo**: el modelo en uso (nombre,
cuantización, licencia, tamaño) y su configuración: dispositivo
(*GPU* · *CPU*, y en escritorio qué GPU), precisión cuando haya varias,
resolución de trabajo (lado largo 1024, 1536 o 2048, en mosaicos por
encima), pasos, **intervención por defecto** (0–100, la de la ventana de
render), semilla (*fija* o *nueva cada vez*), descargar el codificador de
texto a RAM, y en *Avanzado* las tolerancias de la guarda
(`AI-POST.md` §3.2; las de fábrica las fija X1). Un aviso en línea si el
modelo no cabe en la memoria detectada.

**Post-procesado IA ▸ Modelos**: la lista de `src/data/ai-models.json`
(los mismos modelos que ofrece el instalador) y los importados. Por fila:
nombre, arquitectura, cuantización, licencia (con *no apto para uso
comercial* si lo es), tamaño, *Recomendado para tu equipo* cuando toca,
estado (*No descargado* · *Descargando 42 % · 1,2 GB de 6,4 GB · 3 min*
· *En pausa* · *Comprobando* · *Listo* · *En uso* · *Dañado*) y acciones
*Descargar*, *Pausar* / *Reanudar*, *Cancelar*, *Usar*, *Eliminar*.
La licencia del modelo se muestra y se acepta **antes** de la primera
descarga. Las descargas se reanudan donde se quedaron (también tras
cerrar la aplicación) y cada fichero se comprueba con su `sha256` antes
de marcarse *Listo*. **Importar modelo…** como describe `AI-POST.md` §5.
Si el instalador dejó modelos elegidos para descargar, aparecen aquí
descargándose desde el primer arranque.

**Post-procesado IA ▸ Equipo**: lo detectado (GPU y su VRAM dedicada,
RAM, núcleos, WebGPU sí o no y el tamaño máximo de búfer) y la
recomendación que sale de la regla de `AI-POST.md` §2.4, con la fila de
la tabla que la decide. Si la detección falla, se dice y no se
recomienda nada.

**Último proyecto** (*General ▸ Al arrancar*): el encabezado pregunta
*¿Abrir el último proyecto, «X»?* con *Abrir* y *Ahora no*; si el archivo
se movió o falta el permiso, un aviso lo dice. En *Equipo* hay también el
procesador y *Detectar de nuevo*. En escritorio, *Hilos* y *SIMD* dicen
que el motor nativo usa los hilos con que arrancó el lanzador. En los
portables, el selector de modelos aparece arriba de *Modelos* la primera
vez (captura `docs/ui/settings-desktop.png`).

**Enlaces directos**: cualquier parte de la interfaz puede abrir los
Ajustes en una sección (*Gestionar modelos…* en la ventana de render,
el medidor del visor cuando el motor no está), y `?settings=<sección>`
en la URL lo hace para las capturas.

## 3 · Paleta de comandos y teclado

`Ctrl/⌘ K` abre la **paleta**: un campo centrado con lista debajo.
Busca a la vez acciones ("Crear estudio", "Apoyar en el suelo"),
materiales ("oro", "roble"), montajes de luz ("rembrandt"), cámaras y
estudios guardados, y tipos de producto. Cada resultado dice su categoría
en auxiliar y, si tiene atajo, lo muestra a la derecha. Enter ejecuta;
flechas navegan; `Esc` cierra. Es la forma más rápida de hacer cualquier
cosa y la red de seguridad cuando no se encuentra un control.

Atajos iniciales (todos visibles en el tooltip del control y en *Atajos
de teclado* del menú):

| Tecla | Acción |
| --- | --- |
| `Ctrl/⌘ K` | Paleta de comandos |
| `Ctrl/⌘ Z` / `Ctrl/⌘ ⇧ Z` | Deshacer / Rehacer |
| `Ctrl/⌘ I` | Importar modelo |
| `Ctrl/⌘ O` | Abrir proyecto |
| `Ctrl/⌘ S` | Guardar proyecto (en el mismo archivo) |
| `Ctrl/⌘ ⇧ S` | Guardar proyecto como… |
| `Ctrl/⌘ ⏎` | Ventana de render |
| `Ctrl/⌘ ⇧ ⏎` | Render con los últimos ajustes, sin abrir la ventana |
| `F` | Encuadrar selección (o todo) |
| `V` `O` `P` `Z` | Herramientas de vista |
| `H` / `⇧ H` / `Alt H` | Ocultar selección / Aislar / Mostrar todo |
| `1` `2` `3` `4` | Nivel de selección: Modelo · Grupo · Pieza · Caras |
| `Tab` | Plegar y desplegar los paneles laterales |
| `Esc` | Deseleccionar; cerrar paleta o menú |
| `Supr` | Eliminar la selección |

---

## 4 · Comportamientos que hacen la diferencia

### 4.1 · Selección por niveles

Tomado de EZ Packshot y es la pieza central de la asignación de
materiales. Cuatro niveles, **excluyentes**: **Modelo** (todo lo
importado como una unidad), **Grupo** (un ensamblaje: nodo con hijos),
**Pieza** (una malla) y **Caras** (una selección de caras dentro de una
pieza). El selector aparece en la cabecera del inspector y encima del
árbol, como un segmento de cuatro posiciones con atajos `1`–`4`.

- Al hacer clic en el visor, el nivel decide qué se selecciona: con
  *Grupo*, clic en una tuerca selecciona el ensamblaje entero.
- Al asignar un material, se aplica a todo lo que abarca el nivel.
- Si el objetivo ya contiene materiales **distintos** entre sí, antes de
  sobrescribir se pregunta en línea, con inventario: "Cuerpo contiene 3
  materiales (Oro, Vidrio, Goma). · Sustituir todos · Mantener los
  existentes y aplicar solo donde no hay · Cancelar".
- En *Caras* un clic coge **la cara entera** bajo el cursor: la cara CAD
  si la pieza viene de STEP o IGES y, si no, la superficie que continúa
  (crece desde el triángulo picado por continuidad, `SPEC.md` §3.2). Clic
  sin más sustituye la selección de caras; `Ctrl/⌘` clic mete o saca la
  cara entera; `Alt` clic la quita; `Shift` vuelve **suelto** el
  triángulo picado: `Shift` clic lo añade, `Ctrl/⌘ ⇧` clic lo mete o saca
  y `Alt ⇧` clic lo quita. El tooltip del nivel lo dice. *Separar por caras CAD* (menú de pieza) parte
  la pieza en una nueva por cara CAD.
- Con *Seleccionar* (o *Mover*), un clic en el visor, a cualquier nivel:
  sin tecla sustituye la selección, `Shift` añade, `Ctrl/⌘` mete o saca,
  `Alt` quita; un clic en vacío la limpia.
- **Caja** (§2.3): `Ctrl/⌘` + arrastrar (con `Shift` añade, con `Alt`
  quita), de izquierda a derecha una ventana y de derecha a izquierda un
  cruce, al nivel vigente: modelos, grupos o piezas por su geometría
  proyectada; caras enteras de una pieza, las que se ven (o todas con
  *Rayos X*).
- Soltar un material sobre algo (§2.2, §2.3) alcanza lo mismo que
  alcanzaría un clic al nivel vigente, y la regla de los materiales
  distintos de arriba vale igual: se pregunta en línea antes de
  sobrescribir.

### 4.2 · Lenguaje de fotógrafo

Los controles hablan de **focal, diafragma, softbox, tira, temperatura de
color, exposición**; nunca de nodos, muestras por píxel o rebotes salvo
en *A medida* de la barra de render. Cada catálogo muestra una frase de
**intención** ("Una sola fuente grande: una sombra, un brillo"), no una
lista de parámetros.

### 4.3 · Casi nada modal

Toda confirmación es **en línea**, en el sitio donde se pulsó, con dos o
tres botones y `Esc` para cancelar. Los elementos flotantes son los
menús, la paleta, el popover del Doctor y **dos ventanas**, abiertas solo
a petición: la **ventana de render** (§2.7), porque un render es una
decisión con muchos parámetros que se toma de una vez, como en KeyShot,
y la ventana de **Ajustes** (§2.9: secciones agrupadas en una columna a
la izquierda, cambios al momento). Ninguna otra ventana; nada se abre
solo.

### 4.4 · Campos numéricos

Un único componente `NumberField`: valor con unidad (mm, °, K, f/, EV, s),
**arrastrable** en horizontal para cambiarlo (con `Shift` fino, `Ctrl`
grueso), flechas ↑↓ ±1 paso, doble clic para escribir, Enter confirma,
`Esc` restaura. Deslizadores siempre acompañados del campo. Ningún valor
se aplica a medias: un arrastre genera una sola entrada de deshacer.

### 4.5 · Deshacer todo

Cada cambio de estado pasa por el *store* y es deshacible, incluidos los
cambios de cámara hechos orbitando (agrupados por gesto). El tooltip de
Deshacer dice qué deshace.

### 4.6 · Guía que no tapa

La *Guía* (menú o icono de cabecera) añade una tira de 3 líneas encima
del inspector con el paso actual y botones *Siguiente / Cerrar*, y dibuja
una **flecha** apuntando al control del que habla, sin ocultar ni mover
nada. Seis pasos: importar o cargar el ejemplo → elegir tipo de producto y
crear estudio → asignar un material → elegir un montaje de luz → encuadrar
y enfocar → render. Tomado del tutorial con flechas de EZ Packshot.

---

## 5 · Qué construye la fase U1, exactamente

**Entrega**: la interfaz completa descrita arriba, funcional sobre un
**modelo de datos en memoria** (`src/core/store.ts`, ver
`ARCHITECTURE.md` §4) y un **visor de vista previa** con three.js
(`src/render/preview.ts`). Sin trazador de caminos, sin importadores
reales (el ejemplo procedural basta), sin guardar a disco más allá de
descargar el `.repack.json` y la captura PNG del visor.

Lo que **sí** debe funcionar de verdad en U1:

- Árbol de piezas con la pieza de ejemplo (varias piezas: cuerpo, tapón,
  base, etiqueta… generadas por procedimiento, agrupadas en un ensamblaje
  para que *Grupo* tenga sentido), selección sincronizada entre árbol,
  visor e inspector, niveles de selección, ocultar / aislar / encuadrar.
- Tipo de producto + *Crear estudio*: aplica focal, diafragma, exposición,
  fondo, suelo y sombra del preset, y monta el rig con `studioRig()`.
- Catálogo de montajes de luz con sus 72 miniaturas, filtro por estilo,
  intención, anterior / siguiente; al elegir uno, el rig del visor cambia
  (`setupRig()`): se tienen que ver moverse las luces y cambiar su color.
- Catálogo de materiales con sus 77 presets y sus esferas (ver §6),
  asignación por nivel con inventario de confirmación, parámetros por
  familia que se reflejan en el visor (color, metal, rugosidad, barniz,
  transmisión, emisión; madera y tela como aproximación de color plano
  en U1), desgaste como estado (los deslizadores existen y se guardan;
  el visor aún no lo pinta y el panel lo dice en una línea auxiliar).
- Cámara: óptica, focal, diafragma, perspectiva / ortográfica, vistas,
  encuadrar, cámaras guardadas.
- Entorno: cúpula procedural (gradiente suelo → horizonte → cenit con los
  valores de `src/data/environment.ts`), color plano, transparente;
  intensidad y rotación. *Cielo* y *Archivo HDRI* pueden quedar como
  opciones presentes pero marcadas *próximamente* en auxiliar.
- Imagen: exposición y transformada de vista aplicadas al visor; el resto
  guardado en el estado.
- Animación: en U1, planos, movimientos con frase, presets, asistente y
  línea de tiempo de bloques; reproducir mueve la cámara y las piezas en
  el visor con `ease()`; *Construir vídeo* deshabilitado con tooltip
  "próximamente". N1 la sustituye por la línea de tiempo de pistas al
  estilo KeyShot descrita en §2.5.
- Barra de render: todo el estado; **Render** produce de verdad una
  captura del visor a la resolución elegida (render a un canvas fuera de
  pantalla) y la descarga como PNG o JPEG; la cola acumula trabajos y los
  ejecuta en serie con ese mismo mecanismo.
- Doctor: los chequeos de escena implementados sobre el modelo (escala
  plausible según el tipo de producto, origen y apoyo en el suelo,
  suavizado, bisel, clipping de cámara, luces visibles); los de motor,
  en *no disponible aún*.
- Paleta de comandos, atajos, deshacer / rehacer, temas, idioma (todas
  las cadenas en `src/ui/strings.ts` en `es` y `en`, inglés por defecto),
  plegado de paneles, estado vacío con arrastre de archivo (el arrastre
  puede, en U1, cargar solo GLB/glTF con `GLTFLoader` de three; OBJ y STL
  se listan y avisan *próximamente*).
- Guía de seis pasos con flechas.

**Visor de vista previa** (`src/render/preview.ts`): three.js con
`WebGLRenderer` (antialias, `outputColorSpace` sRGB, tone mapping ACES
con exposición ligada al estado), `MeshPhysicalMaterial` para los
materiales, `RectAreaLight` (con `RectAreaLightUniformsLib`) para los
focos de área colocados con `polar(toWorldAzimuth(az), el, dist ·
tamaño)` y apuntados al origen, color de `specColor`, intensidad
proporcional a la energía resuelta dividida por el área; un
`DirectionalLight` para los de tipo sol; entorno y fondo desde una textura
equirrectangular generada en un canvas con el gradiente de la cúpula
(`PMREMGenerator` para el entorno); suelo con `ShadowMaterial` o material
del color de fondo; sombras suaves; `OrbitControls` con el objetivo en el
centro de la pieza. Expone la interfaz `RenderEngine` de
`ARCHITECTURE.md` §5 y reporta su estado real al medidor del visor. El
rendimiento importa: 60 fps con la pieza de ejemplo en un portátil.

---

## 6 · Miniaturas

- **Montajes de luz**: copiar las 72 `thumb_<clave>.png` (160 × 120) y las
  72 `setup_<clave>.png` (64 × 64) de `/home/user/EZPackshot/icons/` a
  `public/thumbs/setups/`. Son del mismo autor; se generan con un script
  propio en una fase posterior.
- **Materiales**: no hay PNG upstream (se renderizan dentro de Blender).
  En U1 se generan **en el navegador** con el propio visor: una esfera
  con el material sobre el fondo del tema, renderizada a 96 × 96 en un
  canvas al abrir cada categoría y cacheada en memoria (y en
  `localStorage` como data URL, envuelto en `try/catch`). Es lo que hacía
  EZ Packshot con `ensure_material_preview`, pero sin Blender.
- **Tipo de producto**: sin miniatura; etiqueta e intención bastan.

---

## 7 · Criterios de aceptación de U1

Lo que revisa quien reciba el PR, en este orden:

1. `npm run qa` en verde (tipos, tests, build) y `npm run screenshot` deja
   una captura del estado con la pieza de ejemplo y el estudio creado.
2. **Ningún color en el cromo**: el test `tests/ui-achromatic.test.ts`
   recorre `src/ui/**/*.css` y falla si algún color (`#rgb`, `#rrggbb`,
   `rgb()`, `hsl()`) tiene saturación distinta de cero. Las miniaturas y
   el visor quedan fuera porque son contenido.
3. Las 72 miniaturas de montaje y las 77 esferas de material se ven y se
   eligen; cambiar montaje mueve las luces del visor; cambiar material
   cambia la pieza.
4. Flujo completo sin ratón salvo en el visor: `Ctrl K` → "ejemplo" →
   `Ctrl K` → "joyería" → `Ctrl K` → "crear estudio" → `Ctrl K` → "oro" →
   `Ctrl ⏎`. Descarga un PNG.
5. El inventario de confirmación aparece al asignar un material a un
   grupo con materiales distintos, y no aparece cuando son iguales.
6. Deshacer revierte, en orden, todo lo anterior; Rehacer lo repite.
7. Los dos temas y los dos idiomas se cambian en caliente sin recargar y
   sin que ninguna cadena quede en un solo idioma (test
   `tests/strings.test.ts`: mismas claves en `es` y `en`).
8. Con los paneles plegados (`Tab`) el visor ocupa todo el ancho y los
   carriles permiten volver.
9. Sin modelo, el estado vacío acepta un `.glb` arrastrado.
10. Ningún nombre de archivo contiene "keyshot" en ninguna combinación de
    mayúsculas (el `.gitignore` lo ignoraría en silencio).

---

## 8 · Lo que no es de U1

Trazador de caminos, importadores más allá de glTF (OBJ, STL, FBX, 3DM,
STEP, IGES, 3MF, PLY, DAE, USD y la hoja de importación), *gizmo* de
mover y el menú contextual completo de piezas (U3), focos propios y
guardar montajes (L4), biblioteca *Míos* (U4), cara CAD entera, pelusa,
desgaste visible, campo claro por entorno, cielo procedural, HDRI de
archivo, colocación por reflejo exacta, vídeo, pases de render, etiquetas
y texturas de imagen, vista en sección. Todo está en `ROADMAP.md` con su
fase y su responsable. En la interfaz, cada uno de esos huecos se marca
con la palabra *próximamente* en texto auxiliar, nunca con un control que
parezca funcionar y no haga nada.
