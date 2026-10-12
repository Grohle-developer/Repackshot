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
   Abrir proyecto, Guardar proyecto (`.repack.json`), Importar modelo,
   Exportar imagen, separador, Idioma (Inglés / Español), Tema (Oscuro /
   Claro / Sistema), separador, Guía, Atajos de teclado, Acerca de.
2. **Nombre del proyecto**, editable al hacer clic (texto plano, sin caja
   hasta que se edita). Un punto delante cuando hay cambios sin guardar.
3. Centro: **Deshacer / Rehacer** con el nombre de la acción en el
   tooltip ("Deshacer: asignar Oro a Cuerpo").
4. Derecha: **Buscar o ejecutar…** (`Ctrl/⌘ K`), campo de 240 px que abre
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
nombre, en texto auxiliar, el material que lleva. Arrastrar una miniatura
de material del inspector sobre una fila la asigna. Menú contextual
(botón derecho): Aislar, Ocultar, Mostrar todo, Renombrar, Apoyar en el
suelo, Centrar, Eliminar.

Encima del árbol, un campo de **filtro** por nombre y, al lado, el
**selector de nivel** de la selección (ver §4.1).

**Cámaras**: lista de cámaras guardadas con la activa marcada. Botones:
*Nueva desde la vista actual*, *Duplicar*, *Eliminar*. Clic activa la
cámara en el visor.

**Luces**: la lista de focos del montaje activo (Principal, Relleno,
Contra, Cenital…), con su potencia relativa en una barra fina y un
interruptor cada uno. Clic selecciona el foco y el inspector lo edita.

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
  Perspectiva / Ortográfica, separador, Bloquear cámara.
- **Arriba a la derecha**: nombre de la cámara activa (clic: lista) y
  resolución de salida actual (clic: abre la barra de render).
- **Abajo a la izquierda, medidor de calidad**: motor activo,
  muestras acumuladas, tiempo, y un pequeño indicador de progreso. Con el
  motor de vista previa (fase U1) dice literalmente *Vista previa ·
  rasterizada*; con el trazador de caminos (fases posteriores) dice
  *128 muestras · 00:12*. **Nunca se inventa un número.**
- **Abajo a la derecha**: ejes de orientación (tres trazos finos X Y Z,
  monocromos) y el tamaño de la pieza en mm.
- **Al pasar por una pieza**: su contorno se ilumina (silueta de 1 px en
  tinta) y una etiqueta pequeña con su nombre sigue al cursor. Clic
  selecciona; `Esc` deselecciona.

**Estado vacío** (sin modelo): zona de arrastre con borde discontinuo y
dos botones: *Importar modelo* (GLB, glTF, OBJ, STL) y *Cargar pieza de
ejemplo*. Arrastrar un archivo sobre cualquier punto del visor también
importa.

**Arrastrar un material** del inspector sobre una pieza del visor la
asigna; mientras se arrastra, la pieza bajo el cursor se resalta.

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
   `STUDIO_PRESETS`, con su etiqueta y, debajo en auxiliar, focal y
   diafragma que trae). Tamaño de la pieza en mm (detectado al importar,
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
   selección al nivel elegido (§4.1); arrastrar también vale. Debajo, los
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

**Con un foco seleccionado:** rol, tipo (área / sol), forma, tamaño,
acimut y elevación (relativos a cámara), distancia, dispersión, temperatura
o color, potencia, *visible en reflejos*, *visible a cámara*.

**Con una cámara seleccionada:** lo mismo que la sección Cámara de la
escena, más nombre y *Activar*.

### 2.5 · Barra de render (abajo)

Siempre visible, 56 px. De izquierda a derecha:

- Pestañas de la barra desplegable: **Animación · Cola** (abren un cajón
  de 240 px sobre la barra).
- Calidad: segmento de tres posiciones **Borrador · Previa · Final**
  (`QUALITY_PRESETS`) y, al lado, *A medida* cuando se ha tocado algo.
- Resolución: desplegable con `RESOLUTION_PRESETS` y *Personalizada…*
  (ancho × alto en línea).
- Presupuesto: *hasta N muestras* **o** *hasta MM:SS*, lo que llegue
  antes; estimación de tiempo en texto auxiliar cuando el motor la dé.
- Formato de salida: PNG / JPEG / EXR, con *fondo transparente* como
  interruptor cuando el formato lo admite.
- **Render** (botón primario, el más grande de la pantalla) y a su lado
  **Añadir a la cola**. Durante un render el botón pasa a *Detener* y
  muestra el progreso como una barra fina en su borde inferior.

**Cajón Animación**: a la izquierda, los **planos** (lista de duraciones
en segundos, añadir, reordenar); en el centro, los **movimientos** como
tarjetas con la frase en lenguaje llano ("La cámara orbita 90° durante 4
s, suave") y, debajo, una **línea de tiempo de bloques** (un carril por
objetivo; los bloques se arrastran y se estiran); a la derecha, *Presets*
(`SEQUENCE_PRESETS`) y el botón *Añadir movimiento*, que abre el asistente
de tres preguntas en línea: ¿qué se mueve? (cámara, pieza, luz, entorno) ·
¿cómo? (`MOVE_KINDS` filtrados por objetivo) · ¿cuánto y cuánto tiempo?
(cantidad, inicio, duración, suavizado). Cabecera del cajón: reproducir /
pausar, cuadro actual, fps, duración total, y *Construir vídeo*.

**Cajón Cola**: lista de trabajos (nombre, cámara, resolución, calidad,
estado, progreso), *Iniciar cola*, *Vaciar*.

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
| `Ctrl/⌘ S` | Guardar proyecto |
| `Ctrl/⌘ ⏎` | Render |
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
- En *Caras*, en U1 basta con el modo y la mecánica de selección por clic
  sobre triángulos; la expansión a cara CAD entera es de una fase
  posterior y lo dice el tooltip.

### 4.2 · Lenguaje de fotógrafo

Los controles hablan de **focal, diafragma, softbox, tira, temperatura de
color, exposición**; nunca de nodos, muestras por píxel o rebotes salvo
en *A medida* de la barra de render. Cada catálogo muestra una frase de
**intención** ("Una sola fuente grande: una sombra, un brillo"), no una
lista de parámetros.

### 4.3 · Nada modal

Toda confirmación es **en línea**, en el sitio donde se pulsó, con dos o
tres botones y `Esc` para cancelar. Los únicos elementos flotantes son los
menús, la paleta y el popover del Doctor. No hay ventanas de render
separadas ni diálogos de ajustes.

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
- Animación: planos, movimientos con frase, presets, asistente, línea de
  tiempo de bloques; reproducir mueve la cámara y las piezas en el visor
  con `ease()`; *Construir vídeo* queda deshabilitado con tooltip
  "próximamente".
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

Trazador de caminos, importadores OBJ/STL/STEP, cara CAD entera, pelusa,
desgaste visible, campo claro por entorno, cielo procedural, HDRI de
archivo, colocación por reflejo exacta, vídeo, pases de render, etiquetas
y texturas de imagen, vista en sección. Todo está en `ROADMAP.md` con su
fase y su responsable. En la interfaz, cada uno de esos huecos se marca
con la palabra *próximamente* en texto auxiliar, nunca con un control que
parezca funcionar y no haga nada.
