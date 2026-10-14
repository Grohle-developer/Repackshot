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
   como… (`Ctrl/⌘ ⇧ S`), Importar modelo, **Añadir ▸** (fase U9: bajo el
   rótulo *Primitiva*, las doce formas del catálogo —*Caja*, *Plano*,
   *Disco*, *Cilindro*, *Pedestal*, *Esfera*, *Cono*, *Toro*, *Cápsula*,
   *Tubo*, *Escalones*, *Fondo infinito*—, cada una con su icono y un
   *tooltip* que dice dónde nace),
   Exportar imagen, separador, Idioma (Inglés / Español), Tema (Oscuro /
   Claro / Sistema), **Ajustes…** (`Ctrl/⌘ ,`), separador y **Ayuda ▸**
   (fase U10): *Recorrido guiado*, *Guía* (la de seis pasos de §4.6),
   *Atajos de teclado* y *Acerca de*.
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

Encima del árbol, un campo de **filtro** por nombre con un botón **`+`** a
su derecha (fase U9: abre el mismo *Añadir ▸ Primitiva* de la cabecera) y,
debajo, el **selector de nivel** de la selección (ver §4.1).

El **menú contextual** completo de una fila (fase U3, con las acciones de
`SPEC.md` §3.1): Encuadrar · Mover (activa el *gizmo*) · **Escalar…**
(fase U9: el panel en línea de §2.3, junto a la fila) · Apoyar en el
suelo · Centrar · Centrar y apoyar · Restablecer transformación ·
Establecer pivote ▸ (centro, base, origen, punto picado) · Fijar como
objetivo de cámara · separador · Ocultar · Aislar · Mostrar todo ·
Bloquear · separador · Duplicar · Duplicar enlazado · Patrón ▸ (lineal,
circular) · Agrupar · Desagrupar · Mover a grupo ▸ · separador ·
Material ▸ (Desenlazar, Enlazar con…, Copiar, Pegar, Seleccionar por
material) · Geometría ▸ (Invertir normales, Suavizado…, Separar por
caras CAD, Separar por material, **Convertir en malla**, fase U9: activo
solo si la selección tiene primitivas) · separador · Renombrar · Eliminar.
En U1 existen las que ya están en §2.2 y el resto se añade en U3 sin
cambiar la estructura del menú.

**Cámaras**: lista de cámaras guardadas con la activa marcada. Botones:
*Nueva desde la vista actual*, *Duplicar*, *Eliminar*. Clic activa la
cámara en el visor.

**Luces**: la lista de focos del montaje activo (Principal, Relleno,
Contra, Cenital…) más los **focos propios** (con la marca *propio*), con su
potencia relativa en una barra fina y un interruptor cada uno. Clic
selecciona el foco y el inspector lo edita. Botón **+ Añadir luz** con menú:
*Área · rectángulo*, *Área · disco*, *Área · esfera*, *Punto*, *Foco
direccional*, *Sol* e *IES* (*próximamente*, fase L5), cada una con su icono
y un *tooltip* de lo que da; el mismo menú está en *Añadir ▸* de la cabecera
(bajo las primitivas) y en el clic derecho del visor en vacío, y cada tipo
en la paleta (*Añadir luz: foco direccional*…). Un foco nuevo aparece
delante y arriba de la pieza, encendido y seleccionado (fase L4). Acciones
por fila, en la fila del foco seleccionado (al pasar el ratón se moverían
bajo el clic que selecciona la fila): **duplicar**, **apuntar a…** (el centro
del producto, un punto, una pieza) y **eliminar**. Como la selección es el
foco, *apuntar a la selección* está del otro lado: el menú contextual de una
pieza tiene **Apuntar un foco aquí ▸** con la lista de focos. Debajo,
**Guardar montaje como…** (nombre; va a la pestaña *Míos* del catálogo con
miniatura renderizada) y **Restablecer al montaje** cuando el rig está
modificado (quita los focos propios).

**Estudios**: combinaciones guardadas de cámara + montaje de luz + entorno
+ set de materiales, como en KeyShot pero sin pantalla aparte: *Guardar
como estudio* toma la escena actual; clic en un estudio la restaura.

### 2.3 · Visor (centro)

El visor **es** el render: no hay modo "vista previa" distinto del modo
"render". Lo que se ve es lo que saldrá, a menos muestras.

Capas sobre el visor, siempre con fondo semitransparente del tema y sin
tapar la pieza:

- **Arriba a la izquierda, barra de vista**: Seleccionar (`V`), Orbitar
  (`O`), **Luces y cámaras** (fase L4, a la izquierda de *Desplazar*: así
  *Escalar* sigue a su derecha), Desplazar (`P`), **Escalar (`S`)** (fase
  U9, junto a *Desplazar*), Zoom (`Z`), Mover (`M`), separador, Encuadrar
  todo (`F`), Vistas (menú: tres cuartos, frontal, lateral, cenital,
  trasera), Perspectiva / Ortográfica, separador, Bloquear cámara. Con
  *Mover* o *Escalar* aparece el conmutador de ejes *Global · Local*
  (`G`/`L`). Con *Seleccionar*, *Mover* o *Escalar* y el nivel *Caras*,
  junto a las herramientas aparece el botón de texto **Rayos X** (la caja
  de selección coge también las caras ocultas). Con una luz o una cámara
  guardada seleccionada aparece el botón de texto **Mirar a través**
  (`Ctrl/⌘ ⇧ L`), que mientras se mira dice *Volver a la cámara activa*.
- **Arriba a la derecha**: nombre de la cámara activa (clic: la lista de
  cámaras, con la activa marcada, la óptica de cada una en pequeño, *85 mm
  · f/5.6*, y un **lápiz** al final de cada fila que abre la ficha de esa
  cámara en el inspector: nombre, *Activar*, *Mirar a través*, óptica y
  posición; la pestaña *Cámaras* se abre con ella marcada; `→` desde la
  fila va al lápiz y `←` vuelve) y resolución de salida actual (clic:
  abre la barra de render).
- **Abajo a la izquierda, medidor de calidad**: modo y motor activos,
  muestras acumuladas, tiempo, y un pequeño indicador de progreso. En
  *Rápido* dice literalmente *Rápido · vista previa rasterizada*; en
  *Completo* dice *Completo · 128 muestras · 00:12* y, durante un gesto
  de cámara, *Completo · ¼ de resolución*. Una segunda línea dice *3
  workers · SIMD* en *Completo* (*Nativo · 16 hilos · AVX2* en
  escritorio) y *x ms por fotograma* en *Rápido*. Mientras corre un
  *Render*, el visor sigue vivo y lo dice con lo que usa: *Completo ·
  compartido con el render · 4 de 16 hilos* (o *1 de 3 workers*); si en
  *Ajustes* se eligió pausarlo, *Completo · en pausa mientras se
  renderiza*. Si el motor no contesta, rechaza la vista o el *watchdog*
  tuvo que volver a arrancarla, una nota bajo la barra lo dice (*Esperando
  al motor · 5 s*; *El motor rechazó la vista: <su motivo> · se vuelve a
  intentar en 2 s*; *La vista se había parado y se ha vuelto a arrancar*),
  con las palabras del motor en el *tooltip*: nunca «0 muestras» en
  silencio. **Nunca se inventa un número.** En *Completo* (E5b-1), una
  línea más dice lo que el motor dice de la imagen: *Ruido reducido*
  cuando lo que se ve es la imagen filtrada por el *denoise* (y entonces
  las muestras son las de esa imagen) y *Cáusticas · 16 384 fotones por
  muestra* cuando el motor las renderiza; y el botón **Reducir ruido**
  (pulsado o no) enciende o apaga el *denoise* del visor: cambia la parte
  del visor de *Avanzado ▸ Reducción de ruido* (*Los dos* ↔ *Render*,
  *Visor* ↔ *Apagada*), deshacible.
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
importa con los valores por defecto. Desde M2a la hoja tiene una sección
**Texturas**: *N imágenes guardadas · X MB*, una línea por cada imagen que
no se guarda con el porqué (*pesa más de 16 MB*, *no es PNG ni JPEG*, *no
estaba entre los archivos elegidos con el modelo*, *el proyecto ya lleva 64
MB de texturas*) y por cada mapa sin ranura (*mapa de oclusión ambiental,
sin ranura*), *El archivo no trae imágenes de textura* cuando no las hay, o
*Con el material predeterminado no se importa ninguna textura*, y una nota
con los límites. Un modelo se elige o se suelta **con sus archivos**
(imágenes, `.mtl`, `.bin`): no se importan solos, el lector del modelo
encuentra en ellos lo que nombra (*Importar modelo…* deja elegir varios).

**Herramienta de etiqueta** (fase M2a): tras *Añadir etiqueta…* el visor
dice *Pulsa en una pieza con Pintura donde va la etiqueta y arrastra su
ancho · Esc cancela*: la pulsación sobre una pieza que lleva el material
pone el centro de la etiqueta (plana desde la normal de la superficie,
derecha, con el arriba del modelo donde la superficie lo deja), el
arrastre fija su ancho (desde el centro, en su plano) y soltar termina; un
clic sin arrastre le da un cuarto del lado mayor de la pieza. Toda la
colocación es una entrada de deshacer (*Deshacer: Añadir la etiqueta
logo.png a Pintura*). Sobre una pieza que no lleva el material, un aviso
(*Esa pieza no lleva Pintura*). **Mover etiqueta**: arrastrar sobre la
pieza desliza la etiqueta por la superficie bajo el cursor, conservando
tamaño y giro (una entrada por arrastre), hasta `Esc` o el botón. Mientras
la herramienta está activa, la pulsación es suya: ni orbita, ni el
*gizmo*, ni selecciona.

**Herramienta de mover** (fase U3): con una selección y la herramienta
*Mover* (`M`) activa, un *gizmo* sobre el pivote con asas de traslación
(flechas por eje y planos), rotación (anillos) y escala (cubos), en ejes
locales o globales (`L`/`G` o el conmutador de la barra de vista),
incrementos con `Shift`, y los campos del inspector actualizándose en
vivo. Arrastrar es una sola entrada de deshacer. Las luces y las cámaras
guardadas se mueven y giran con el mismo *gizmo*, sin cubos de escala (fase
L4): sobre su posición, en ejes globales o los suyos (derecha, arriba,
atrás), con el **asa de apuntar** (una línea a su objetivo con un punto al
final): mover una luz no cambia a dónde apunta, girarla gira a dónde apunta
(y un panel alrededor de su eje), el asa mueve su objetivo; lo mismo una
cámara con el suyo (*Deshacer: Mover foco Foco*, *Mover cámara Cámara 2*).
Una cámara bloqueada no tiene *gizmo*.

**Luces y cámaras en el visor** (fase L4): glifos acromáticos en la tinta
del tema, sobre todo, discontinuos (el seleccionado, continuo): el contorno
del panel con una marca hacia donde ilumina, la esfera, el punto con una
estrella, el cono del foco (y su cono interior), la flecha del sol y la
pirámide de cada cámara guardada (no la activa). El botón *Luces y cámaras*
los muestra todos mientras se trabaja con ellos (la pestaña *Luces* o
*Cámaras* abierta, una luz o una cámara seleccionada, o mirando a través de
una); con *Piezas* y una pieza, ninguno, para que un panel del montaje que
cruza el producto no parezca parte de él. Apagado (se recuerda), solo el
seleccionado. Al pasar sobre un glifo, una etiqueta con su nombre y el
cursor de mano; un clic lo selecciona por delante de la pieza que tenga
detrás (`Ctrl/⌘` o `Alt` sobre el seleccionado lo quita), doble clic mira a
través, clic derecho: *Mirar a través*, *Duplicar*, *Apuntar a… ▸* y
*Eliminar* (en una cámara, *Activar* y *Eliminar*). La caja de selección no
los coge y *Escalar* no les pone *gizmo*.

**Mirar a través** (fase L4): el visor mira desde la luz o la cámara
seleccionada (desde una luz, hacia su objetivo, con la óptica de la cámara
activa; un foco direccional ajusta la focal a su cono), en *Rápido* y en
*Completo*, con un aviso bajo la barra: *Mirando a través de Foco ·
orbitar, desplazar y zoom la mueven · Esc vuelve* y el enlace *Volver a la
cámara activa*. Orbitar, Desplazar y Zoom (las herramientas, el ratón y la
rueda) mueven ese objeto (la luz apunta a donde mira el visor), en vivo y
en una entrada de deshacer por gesto (*Deshacer: Mover Foco desde su
vista*); la cámara activa no se mueve. Una cámara bloqueada no se mueve
(*… bloqueada: desbloquéala para moverla*). `Esc`, el botón o el enlace
vuelven a la cámara activa; borrar lo que se mira, también.

**Herramienta de escalar** (fase U9, `S`): el mismo *gizmo* sobre el
pivote, pero **solo con las asas de escala**: un eje fino por dirección con
un cubo más grande en su extremo (escala en ese eje; el eje entero se
puede coger, y llevar el puntero una longitud de cubo más allá duplica la
escala) y un punto en el centro (escala uniforme, hacia la derecha o arriba
crece). Sin flechas, anillos ni planos. Ejes locales o globales como
*Mover*, incrementos del 10 % con `Shift`, los campos de escala del
inspector en vivo, un arrastre es una entrada de deshacer (*Deshacer:
Escalar Caja*), un clic donde no hay asa selecciona y `Ctrl/⌘` + arrastrar
dibuja la caja de selección como con *Mover*; `Esc` vuelve a *Seleccionar*.
El *tooltip* del botón lo cuenta.

**Clic derecho ▸ Escalar…** (fase U9, en una pieza del visor o en una fila
del árbol): un **panel en línea** propio junto al punto o a la fila (nunca
un diálogo del navegador; `Esc` o un clic fuera lo cierran) con un
segmento *Uniforme · Por eje · A medida*: *Uniforme* un campo en %, *Por
eje* X, Y y Z en %, *A medida* el ancho, el fondo y el alto en mm (las
unidades de la interfaz) con un candado de **proporción**, cerrado por
defecto (cambiar uno arrastra los otros dos; un eje sin espesor, como el
alto de un plano, no se toca). Debajo, en auxiliar, el pivote y los ejes
con que actúa (*Alrededor del pivote (Centro) · ejes Global*), y los
botones **Aplicar** (una entrada de deshacer), **Restablecer escala** (cada
nodo vuelve a la escala con que entró en la escena, alrededor de su propio
pivote) y *Cancelar*. Actúa sobre la selección al nivel vigente (la pieza,
el grupo o el modelo sobre el que se abrió el menú), alrededor de su
pivote, en los ejes de *Mover* y *Escalar*.

**Menú contextual en vacío** (fase U9): un clic derecho sobre el visor
donde no hay pieza abre *Añadir ▸ (Primitiva)*, *Encuadrar selección o
todo* y *Mostrar todo*.

**Dónde nace una primitiva** (fase U9, `SPEC.md` §3.1): con un producto en
la escena, la *Caja* y el *Pedestal* nacen **como base**: bajo el
producto, apoyados en el suelo, con 1,4 veces su huella (los lados de la
caja; el radio del pedestal sobre el punto del producto más lejano a su
eje), y el producto sube a apoyarse encima, todo en una sola entrada de
deshacer (*Deshacer: Añadir Caja bajo Frasco de ejemplo*). El *Plano* y el
*Disco* se tienden en el suelo bajo el producto; el *Fondo infinito* se
**ajusta a la cámara activa**: girado en Z hacia ella, con la pared detrás
del producto a 1,75 veces su fondo (o más atrás, para que el contraluz y
los focos traseros del montaje queden entre el producto y el papel), tan ancho como 1,3 veces lo que abarca
el encuadre donde lo toca, más alto que lo más alto que el encuadre
alcanza en la pared, con el suelo hasta delante de lo que el encuadre ve
de él y una curva de 0,3 veces su alto (todo el encuadre de salida, con
la óptica y el formato de la cámara, cae sobre el fondo); y el resto
de formas se apoya en el suelo **junto** a lo que hay (a +X), a las
proporciones del catálogo respecto al producto. Sin producto, la primera
nace en el origen al tamaño de pieza declarado (200 mm en un proyecto
nuevo) y encuadrada; las siguientes, al lado. Llevan el material neutro
*Blanco estudio* del catálogo, compartido. Los planos y el fondo infinito
se quedan una milésima del tamaño por encima del suelo del estudio para no
parpadear contra él.

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
   HDRI*. Con *Archivo HDRI*, botón *Cargar HDRI…* (`.hdr`, `.exr`) y
   debajo el nombre y el tamaño del archivo, o *Sin HDRI cargado: ilumina
   la cúpula de estudio*; soltar un `.hdr` o `.exr` en la ventana hace lo
   mismo. Con *Cielo*, *Modelo* (*Físico · Clásico*, segmentado, con una
   ayuda en cada opción: *Físico* es el cielo propio de E5c, ajustado a
   nuestra simulación de la atmósfera, y el de por defecto; *Clásico*, el de
   Preetham de E5), *Bruma* (turbidez, de 1 a 10; el clásico la sujeta a 1,7
   como mínimo) y, si el montaje no tiene foco de sol, *Azimut del sol* y
   *Altura del sol*; si lo tiene, una nota dice que el sol del montaje
   coloca el del cielo. Intensidad, rotación (se
   oculta con *Cielo*: lo coloca su sol). Fondo: *El mismo entorno*,
   *Color* (muestra), *Transparente*, *Imagen de fondo*; con esta última,
   *Cargar imagen…* (PNG, JPEG, WebP), su nombre y tamaño, *Encaje*
   (*Llenar · Encajar · Estirar*, dentro del marco de salida) y el color,
   que se ve alrededor de la imagen encajada o en su lugar mientras no hay
   ninguna. Un archivo que no se puede leer se avisa en un *toast* que
   dice qué le pasa. Sombra en el suelo y reflejo en el suelo
   (intensidad).
4. **Cámara** — Edita la **cámara activa**, y lo dice: la cabecera lleva
   su nombre (*Cámara 1*) y un lápiz que abre la ficha de esa cámara
   (nombre, *Activar*, *Mirar a través*); una nota recuerda que cada
   cámara tiene su óptica y su posición. Preset de óptica (8
   `LENS_PRESETS`), focal en mm (campo arrastrable), diafragma (f/),
   distancia de enfoque + botón *Enfocar con clic*, interruptor
   Perspectiva / Ortográfica, *Encuadrar*, y *Guardar como cámara*.
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
   barniz, IOR, transmisión, opacidad, anisotropía, subsuperficie; vidrio
   (color, rugosidad, IOR, transmisión, *Distancia de absorción* en mm y
   *Paredes*: *Macizo · Pared fina*); madera
   (dos colores, densidad de anillos…); tela (dos colores de hilo, tipo de
   tejido, hilos por cm, pelusa); emisor (tipo, temperatura, potencia).
   Solo se pintan los que la familia usa. Un botón *Convertir en material
   propio* separa la instancia del preset cuando se edita (el nombre pasa
   a "Oro (editado)").
2. **Texturas** (fase M2a) — Una nota dice que *Rápido* muestra texturas y
   etiquetas y que el motor las pinta en *Completo* y en *Render*
   (*próximamente*, fase M2b). Una fila por **ranura**: *Color*,
   *Rugosidad*, *Metal*, *Normal*, *Alfa*, *Emisión*, cada una con la
   vista previa de su imagen (un cuadrado rayado sin imagen), su nombre y
   debajo el archivo y su tamaño en píxeles (o *Sin imagen*), **Cargar…**
   (*Cambiar…* con imagen; el diálogo del sistema en escritorio, el
   selector de archivos en el navegador; PNG o JPEG) y la papelera
   (*Quitar*). La ayuda de cada ranura dice qué hace la imagen (*multiplica
   el color base*…). Con imagen, lo suyo: *Canal* (*R · G · B · A · Lum*) e
   *Invertir* en rugosidad, metal y alfa (y en un mapa de alturas);
   *Mapa de alturas* e *Intensidad* (con mapa de alturas, en mm del
   blanco) en normal; *Como recorte* y su *Umbral* en alfa; *Tinte* e
   *Intensidad* en emisión. Una ranura con mapeado propio (del archivo) lo
   dice, con *Usar el común*. Con alguna imagen, el bloque **Mapeado**
   (el común): *Proyección* (*UV · Caja · Plana · Cilíndrica · Esférica*),
   *Eje* (plana, cilíndrica, esférica), *Juego UV* (*1 · 2*, en UV),
   *Tamaño* en las unidades de la interfaz con *Ajustar a la pieza* (no
   en UV ni en esférica; una nota dice qué es, y en la cilíndrica que es
   la circunferencia), *Giro*, *Desplazamiento* y *Repetición* (U y V),
   *Bordes* (*Repetir · Estirar el borde · Espejo*); si alguna pieza del
   material no tiene UV, con *UV* una nota lo dice y propone *Caja*.
   Después, **Etiquetas**: una fila por etiqueta, la de encima arriba, con
   su imagen, su nombre y su tamaño en mm, *Traer delante* y *Enviar
   atrás*, la papelera, **Mover etiqueta** (activa la herramienta del visor;
   pulsado mientras lo está) y, desplegable, *Ancho*, *Giro*, *Alcance*
   (con su nota), *Rugosidad*, *Barniz* y *Relieve del papel*; *Aún no hay
   etiquetas* si no hay; una nota cuando el material lo comparten varias
   piezas (*Sale en las 3 piezas que comparten este material*) y otra
   cuando hay más de las que dibuja *Rápido* (seis). Al pie,
   **Añadir etiqueta…**: elige la imagen y activa la herramienta. Todo es
   una acción del *store*: un arrastre de un campo, una entrada de
   deshacer (*Deshacer: Mapeado de Oro*, *Cargar tex.png en Color de
   Pintura*, *Añadir la etiqueta logo.png a Pintura*).
3. **Desgaste** — Tres botones rápidos (*Nuevo · Usado · Viejo*), los 9
   básicos de `WEAR_PRESETS` en una fila de chips, el mando maestro, y
   un deslizador por tipo (solo los de `WEAR_FAMILY_TYPES` para la familia
   actual) que despliega sus mandos al activarse. Escala, semilla, *variar
   por pieza*, y *Aplicar a toda la pieza*.
4. **Pieza** — Nombre, visible, bloqueada, posición / rotación / escala
   (tres campos por fila, arrastrables), *Apoyar en el suelo*, *Centrar*,
   radio de bisel de aristas (mm), suavizado.

**Con una primitiva seleccionada** (fase U9), antes de *Material*, la
sección **Primitiva**: *Forma* (el nombre, en texto), y un campo por
medida del catálogo, arrastrable, en mm (las unidades de la interfaz) o en
número entero: ancho, fondo, alto, radio, radio de bisel y sus segmentos,
segmentos, radio del tubo, radio interior, escalones; con las palabras de
cada forma donde las tiene (*Radio del anillo* del toro, *Radio exterior*
del tubo, *Alto total* de la cápsula, *Radio de la curva* y *Segmentos de
la curva* del fondo infinito). Cambiar una medida regenera la malla al
momento con una acción del *store*; un arrastre es una sola entrada de
deshacer (*Deshacer: Cambiar Alto de Caja*) y la pieza conserva su apoyo
(el centro de la base de su caja no se mueve: una base que crece, crece
hacia arriba). Las medidas fuera de lo que da una forma se acotan (un
bisel no pasa de la mitad del lado menor). Una nota dice que las medidas
van en los ejes de la pieza y que su escala las multiplica, otra cuántas
copias enlazadas cambian con ella, y el botón **Convertir en malla** la
congela (la sección desaparece; deshacer la devuelve). En el *Fondo
infinito*, además, **Ajustar a la cámara** lo vuelve a girar y dimensionar
para la cámara activa y el formato de salida de ahora, en una entrada de
deshacer (*Deshacer: Ajustar Fondo infinito a la cámara*).

**Con un foco seleccionado:** nombre (vacío: el de por defecto, en gris),
la nota *Foco propio* en los propios, rol (si viene de un montaje), tipo
(*Área · Punto · Foco · Sol*), forma (área: rectángulo, cuadrado, disco,
elipse, esfera), tamaño (ancho y alto; diámetro en la esfera) o radio
(punto y foco), **posición** (acimut y elevación relativos a cámara, y
distancia; y **Coordenadas** X, Y, Z en las unidades de la interfaz, que
mueven el foco sin cambiar a dónde apunta), **apuntar a** (botón con menú:
el centro del producto, un punto…, una pieza…; debajo, a qué apunta ahora),
giro (paneles no redondos), dispersión (área) o ángulo de cono y
**transición** en % (foco), disco del sol, temperatura o color, potencia en
vatios (W/m² en el sol) con el equivalente en lúmenes (lux en el sol) en
auxiliar y lo que significan los vatios, *visible en reflejos*, *visible a
cámara*, *proyecta sombra*, encendido; botones *Colocar por reflejo*,
*Colocar sobre superficie*, *Mirar a través*, *Duplicar*, *Eliminar* (fase
L4).

**Pestaña *Míos*** en cada catálogo (materiales, montajes de luz, tipos de
producto, estudios): lo guardado por el usuario, con miniatura, renombrar
y eliminar al pasar el ratón, y los botones *Exportar biblioteca* e
*Importar biblioteca* (JSON) al pie. Fase U4.

**Con una cámara seleccionada:** lo mismo que la sección Cámara de la
escena, más nombre, *Activar* y, si no es la activa, *Mirar a través* (fase
L4).

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
ajustes), *Duplicar*, *Quitar*; arriba *Vaciar terminados* y un botón
que sigue el estado de la cola: **Pausar** mientras corre (para el trabajo
en curso y libera el motor al momento; el trabajo vuelve a *En espera*),
**Reanudar** tras una pausa (sigue con lo pausado, y el trabajo pausado
vuelve a empezar: un render no se reanuda a medias) e **Iniciar cola** si
no, desactivado cuando no hay nada en espera. Un *Reanudar* pulsado
mientras el trabajo pausado aún se está parando no se pierde. Los
terminados quedan en la lista con su miniatura; clic abre el visor de
resultados.

### 2.6 · Barra de estado

24 px, texto auxiliar: a la izquierda el **Doctor** (un punto relleno y
"2 avisos", o un punto hueco y "Todo en orden"); clic abre su popover.
Luego: piezas · triángulos · motor y dispositivo · muestras y tiempo del
visor. A la derecha: idioma y versión.

**Nota del motor de ejecución** (fase U10, solo escritorio): si al
arrancar hay un modelo de IA instalado y el motor de ejecución no
(`AI-POST.md` §7.1: no está, la descarga está en pausa, no arranca, o en
Windows falta el entorno de Microsoft Visual C++), una línea discreta a
la derecha, **una sola vez por sesión** y nunca una ventana: *IA: el motor
de ejecución no está instalado* con *Instalar* (descarga la compilación que
elige la regla, o abre la página de Microsoft si lo que falta es Visual
C++), *Más tarde* (la quita hasta el próximo arranque) y, en el texto, un
enlace a *Ajustes ▸ Post-procesado IA ▸ Motor de ejecución*. Un motor que
ya se está descargando (lo marcó el instalador) no es un aviso. Es la
misma línea que la de las actualizaciones, en el mismo sitio.

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
- **Formato**: PNG (8 o 16 bits), JPEG (calidad), EXR, **TIFF** (8, 16
  o 32 bits flotante) y **RAW (DNG)** (U12); *Fondo transparente* cuando
  el formato lo admite (PNG, EXR y TIFF; JPEG y DNG no, y el interruptor
  dice por qué); *Pases* (alfa, profundidad, normales, id de pieza)
  cuando existan (N2), con *próximamente* hasta entonces. Cada formato
  que necesita explicación lleva **una línea de ayuda** bajo el
  selector, la misma que el texto emergente del botón: *EXR: lineal en
  coma flotante de 32 bits, para composición*; *TIFF: sin compresión, 8/16
  bits sRGB o 32 bits lineal*; *DNG lineal en coma flotante: se revela
  como un raw de cámara*. La profundidad de bits sale a la derecha del
  selector solo donde se elige: PNG ofrece *8 bits* y *16 bits*; TIFF,
  *8 bits*, *16 bits* y *32 bits flotante* (lineal, con la exposición del
  render y sin curva, como el EXR); RAW (DNG) no ofrece nada que elegir y
  dice *32 bits flotante*. TIFF lleva los DPI de la ventana como
  resolución; el TIFF de 8 y 16 bits y el DNG se leen como sRGB y como
  primarios sRGB lineales, sin perfil ICC. El nombre del archivo acaba en
  `.tif` o `.dng`. Al terminar, el visor de resultados y las miniaturas
  usan una **copia PNG de 8 bits** del mismo render (Chromium y Firefox no
  muestran TIFF ni DNG, como no muestran EXR), y *Guardar de nuevo* escribe
  el archivo, no la copia. El resumen del pie lo dice: *TIFF 32 bits
  flotante → Descargas*. Captura: `docs/ui/render-format-tiff.png`
  (`tools/render-format-check.mjs`). Una configuración antigua o ajena con un formato
  que esta versión no escribe se abre como PNG.
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
- **Cáusticas** (E5b-1): segmento **Automático · Encendidas · Apagadas**
  (por defecto *Automático*) con una nota de lo que hace cada uno:
  *Automático* las enciende cuando la escena tiene vidrio o metal pulido y
  una luz pequeña (un sol, un panel o disco pequeño, un filamento
  encendido; los puntos y focos direccionales todavía no mandan fotones);
  *Apagadas*, la sombra del vidrio macizo queda oscura. El visor *Completo* sigue el
  mismo interruptor.
- **Avanzado** (plegado): rebotes máximos, recorte de indirecta,
  semilla, **Calidad de cáusticas** (*Baja · Media · Alta*, con la nota de
  sus fotones por muestra y su radio inicial, y de que más fotones son una
  cáustica más fina y más tiempo por muestra, también en *Completo*),
  **Reducción de ruido** (*Apagada · Visor · Render · Los dos*, por
  defecto *Los dos*, con la nota de que es el filtro del motor guiado por
  albedo, normales, profundidad y pieza, que nunca mezcla dos piezas) y,
  cuando el render se filtra, **Guardar también sin reducción de ruido**
  (un segundo archivo con «-noisy» en el nombre).

**2 bis · Animación** (en lugar de *Tamaño*, con una fila *Tamaño del
fotograma* solo en píxeles, y encima de *Calidad*, cuando
el segmento está en *Animación*): **rango** (*Todo* o de–a en
fotogramas o segundos), **fps** (24, 25, 30, 60), duración resultante,
**salida** *Vídeo* (MP4 H.264 o WebM VP9, con calidad) o *Fotogramas*
(secuencia PNG o JPEG con numeración `0001`), *Terminar por* aplicado
**a cada fotograma**, y la estimación del total. La cámara es la pista de
cámara de la línea de tiempo.

**3 · Post-procesado IA** (X4; `AI-POST.md` §4): plegada y apagada por
defecto, en el cuerpo de la ventana (`ui/panels/ai-post.ts`).

- **Interruptor** con su línea auxiliar: el modelo en uso, con los datos
  del gestor de Ajustes (*Z-Image-Turbo · Q4 · Apache-2.0 · descargado*).
  Si no hay ningún modelo (o falta el motor de inferencia), activarlo
  abre *Ajustes ▸ Post-procesado IA ▸ Modelos*; si el servicio dice que no
  puede (`AiUnavailableReason`), queda deshabilitado con el motivo en una
  nota (sin WebGPU, poca memoria, modelo que el motor instalado no carga,
  *próximamente* mientras la versión no tenga tubería). En *Animación* queda
  deshabilitado (*para animaciones llega más adelante*). Gestionar modelos…
  y la intervención por defecto de Ajustes, debajo.
- **Aviso del motor de ejecución** (fase U10, `ui/panels/ai-runtime-notice.ts`):
  con un modelo instalado y sin motor de ejecución (o con la descarga en
  pausa, o sin que arranque, o sin Microsoft Visual C++ en Windows), un
  recuadro bajo el interruptor lo dice con su título y su frase y los
  botones que lo arreglan: **Instalar · 26 MB** (el mismo flujo que la fila
  del motor de Ajustes: el lanzador descarga la compilación que eligió la
  regla), *Reanudar*, *Pausar* mientras baja (con barra), **Instalar el
  entorno de Microsoft Visual C++…** y *Comprobar de nuevo*, y *Ajustes…*.
  Con la sección plegada, su título lleva la marca *Falta el motor* para
  que se vea. Todo lo muestra el lanzador (se pregunta cada pocos segundos,
  y cada 0,4 s mientras algo baja); si el lanzador rechaza un botón, lo dice
  en el recuadro. Sin modelo no se dice nada del motor (lo primero es
  elegir un modelo), y con un motor que arranca tampoco.
- **Configurador** (solo con el interruptor encendido), a la izquierda: seis
  controles de 0 a 100 con su frase —*Intervención*, *Luz*, *Rebotes*,
  *Desgaste y microdetalle*, la lista de *Estilo* (`AI_STYLES`) y *Fuerza del
  estilo*—, las **protecciones** como seis fichas fijas con candado (sin
  interruptor ni botón: *Geometría · Materiales · Resolución · Profundidad
  de campo · Encuadre · Texto y logotipos*) y **Otra variación**, que cambia
  la semilla. Cada cambio es una acción del *store*, deshacible; arrastrar un
  control es **un** paso de deshacer. En un trabajo de la cola que se edita,
  los controles cambian el borrador del trabajo.
- **Vista previa**, a la derecha (debajo en una ventana estrecha; queda a la
  vista mientras se recorren los controles): un fotograma del **modo Rápido**
  desde la cámara del trabajo a 384–512 px, con la IA aplicada y el **divisor
  deslizable** de U5 (*Antes · Después*). Se actualiza **al soltar** un
  control, nunca mientras se arrastra (los cambios de una tecla o de una
  lista esperan una pausa corta), y abandona la vista previa en curso si
  llega otro cambio. Debajo: el tamaño, **la línea del informe de la guarda**
  (la misma del visor), *≈ 0,4 s por cambio en este equipo* —**medido**
  alrededor de la llamada a la tubería, sin cifra hasta la primera vista
  previa—, la nota *La vista previa parte del modo Rápido; el resultado final
  parte del render completo* y la opción *Usar el motor completo para la
  vista previa (más lento)*, que parte del trazador con el presupuesto del
  trabajo. El fotograma y sus pases de `AI-POST.md` §7.4 (dibujados con
  three.js: ids de pieza y de material del propio RSB, profundidad, normales
  en el mundo con Z arriba, albedo, círculo de confusión de la lente fina) se
  calculan una vez y se reutilizan mientras cambian solo los controles.
- **De dónde sale** (X3c): en la aplicación de escritorio, de la tubería del
  lanzador (`src/io/ai-post.ts`): el interruptor puede encenderse cuando
  `/api/ai/runtime` dice que el motor de ejecución y el modelo activo están
  listos (si no, el motivo: sin motor, sin modelo, modelo que este motor no
  carga), y la vista previa manda su fotograma y sus pases al lanzador. En la
  web, hasta X3d, el interruptor dice *próximamente*; con `?ai=synthetic`
  corre el servicio sintético de `src/ai/synthetic.ts` (sin modelo,
  determinista) para capturas, demos y pruebas. Apagar el interruptor
  devuelve la memoria del modelo (si ningún trabajo lo usa). Capturas:
  `docs/ui/ai-section-dark.png` y `docs/ui/ai-section-light.png`.
- **Prompt propio** (X4b), bajo los seis controles y sobre las protecciones: un
  campo de varias líneas, vacío por defecto, de hasta 400 caracteres (contador
  *n / 400*), con la nota *Describe la luz o el ambiente; la geometría, los
  materiales y el enfoque siguen protegidos*. Es del trabajo: se guarda en el
  proyecto, cada trabajo de la cola lleva el suyo y se deshace **de una vez por
  visita al campo** (se guarda al dejar de escribir y al salir de él; todo lo de
  una visita es una entrada de deshacer, nunca una por tecla). Se añade al final
  del *prompt* que se genera de la escena, que va tras el *prompt del sistema*
  de Ajustes; el negativo fijo sigue aparte. Si el modelo que va a ejecutarse no
  admite un *prompt* de texto (`textPrompt` de `ai-models.json`, o el manifiesto
  de un importado), el campo se ve deshabilitado y la línea de debajo lo dice
  (*… no admite un prompt de texto: lo que se escriba aquí no se envía*). Con un
  modelo que lee pocos *tokens* (SD 1.5: 77) la línea dice cuántos usa
  (*≈ 64 de los 77 tokens que lee este modelo*) o qué se queda fuera
  (*Demasiado largo para este modelo (77 tokens); no entra: tu prompt, el final de
  la descripción de la escena*), con la estimación prudente de `AI-POST.md` §4.
- **Variantes** (X4b), junto a *Otra variación*: un número de 1 a 8, **1 por
  defecto**, deshacible (un arrastre, una entrada). Debajo, *Un render y después 4
  imágenes de IA con las semillas 12 a 15; la vista previa enseña la primera ·
  ≈ 2 min de IA en este equipo* (el tiempo es N × lo medido por píxel en el último
  trabajo con IA de este equipo; sin medida, *el tiempo de la IA se mide con el
  primer render con IA*). Cambiar el número no rehace la vista previa, que sigue
  siendo de una sola imagen. El resumen del pie dice *IA activada · 4 variantes*.
  Captura: `docs/ui/ai-section-prompt.png`.

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

**Con IA (X4).** Un trabajo de imagen con el post-procesado encendido guarda
primero la imagen del motor (siempre) y después la de la IA al lado
(`…_AI.png`, en el formato del trabajo); el resultado conserva las dos y el
**informe de la guarda**. El visor abre *Render* contra *IA* con el divisor
(etiquetas *Render · IA*, botones *Solo render · Solo IA · Dividir*) y una
línea propia bajo el título y la barra de botones, a todo lo ancho de la
cabecera: *Comprobado: geometría ✓ · materiales ✓ (ΔE máx 1,8) · resolución ✓ ·
enfoque ✓* (la geometría reúne bordes, píxeles fuera de las regiones
permitidas y detalle de banda alta; ΔE máx es el mayor ΔE₀₀ medio de un
material) y, en la misma línea, *La IA se limitó al 23 % para respetar las
protecciones* si la guarda tuvo que bajar la intervención. Es siempre una sola
línea: si no cabe acaba en puntos suspensivos y el aviso al pasar el ratón la
tiene entera, con lo que se ejecutó. La barra de botones comparte línea con el
título mientras caben los dos; si no, pasa debajo (y sus botones saltan de
línea), sin estrechar nunca el título; *Cerrar* se queda en la esquina (X3c;
`tools/ai-post-check.mjs` lo mide a 1600, 1280 y 960 px en los dos idiomas). Si la guarda la **rechaza**, el
resultado queda con la imagen del motor sin cambios, el informe dice qué
protección se rompió y no hay segunda imagen. Se guardan las dos por separado
(*Guardar el render de nuevo*, *Guardar la imagen IA*); *Comparar con…* pone
otro resultado en lugar de la IA. La cola y el historial muestran las **dos
miniaturas**. El historial guarda la imagen de la IA como segundo fichero del
resultado: IndexedDB en la web y `<datos>/results/<id>.ai.<ext>` en el
escritorio (`PUT/GET /api/store/results/<id>/ai` del lanzador). Capturas:
`docs/ui/ai-results-viewer.png`, `docs/ui/ai-results-light.png` y
`docs/ui/ai-queue.png`.

**En el escritorio (X3c).** El render final con IA deja su imagen lineal y sus
pases en el lanzador, que hace la IA sin que los píxeles vayan y vuelvan; la
imagen de la IA llega como luz lineal y se escribe **con la exposición y la curva
del propio render**, en el formato del trabajo (PNG de 8 o 16 bits, JPEG, EXR, TIFF o DNG),
así que con Intervención 0 es el mismo fichero byte a byte. Mientras la IA
trabaja, la fila de la cola dice dónde está —*IA · cargando el modelo*, *IA ·
mosaico 2 de 4*, *· intento 2* tras un reintento, *IA · comprobando*— y la barra
mide la tubería, no ya el render. *Detener* o *Pausar* en ese momento paran la
IA al instante y **la imagen del motor se queda en el historial** (aviso *Post-procesado
IA detenido: la imagen del motor se conserva en el historial*); con *Pausar*, el
trabajo vuelve a esperar y *Reanudar* lo hace entero. Los navegadores no
muestran EXR, TIFF ni DNG: la miniatura de la IA de un trabajo en uno de ellos
sale de una copia de 8 bits, pero el visor solo compara *Render | IA* cuando la
IA es PNG o JPEG (el historial guarda el archivo tal cual; una copia para la vista
de la imagen de la IA queda pendiente).

**Variantes (X4b).** Un trabajo con varias variantes hace un solo render y una
pasada de la IA por variante, con la semilla siguiente cada vez; se guardan como
`…_AI.png`, `…_AI_2.png`, `…_AI_3.png`…, cada una con su informe. Mientras tanto
la fila de la cola dice *IA · variante 2 de 4 · mosaico 3 de 4* y la barra mide las
variantes juntas; *Detener* a mitad conserva el render y las variantes terminadas
(*… el render y las 2 imágenes de IA terminadas se conservan en el historial*). Una
variante que la guarda rechaza queda con su informe y sin imagen (aviso propio), y
si una falla se conservan las anteriores. En el visor, **una tira de miniaturas**
—una línea propia entre la cabecera y la imagen, *Variantes* y una miniatura por
variante con su número, la elegida marcada, la rechazada sin imagen y deshabilitada—
elige la que el divisor compara con el render (etiquetas *Render · IA 3*), sin
perder el zum ni el divisor, y la línea del informe pasa a ser la suya (*Variante 3 ·
Comprobado: …*). Botones *Guardar el render de nuevo*, *Guardar esta variante* y
*Guardar todas* (cada una con su nombre). La cola y el historial ponen **×4** sobre
las miniaturas y la columna IA de la cola dice *IA × 4*. En el historial, en la web
van en el mismo registro de IndexedDB; en escritorio, `<datos>/results/<id>.ai.<n>.<ext>`
(`PUT/GET /api/store/results/<id>/ai/<n>`; el `<id>.ai.<ext>` de un resultado de
antes se lee como la variante 1). `tools/ai-post-check.mjs` (j) mide también la tira:
una línea propia, sin solapes, a 1600, 1280 y 960 px. Captura:
`docs/ui/ai-results-variants.png`.

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
| **Render** | **Motor de renderizado** | Motor (*Nativo, todos los hilos* en escritorio · *Navegador, WebAssembly*); hilos (*Automático* o un número; en el navegador, *workers*); SIMD (Automático · Desactivado); límite del visor en Completo (parar a las N muestras o a los N segundos, para no gastar batería); **mientras se renderiza** (*Mantener el visor vivo (compartido)*, por defecto: el render usa tres cuartos del motor y el visor sigue con el resto · *Pausar el visor (render más rápido)*); **Medir rendimiento** (renderiza la escena de ejemplo 10 s y muestra las muestras por segundo medidas, con hilos y SIMD; nunca un número inventado); datos del motor (versión, compilación, CPU, extensiones SIMD, hilos) |
| | **Post-procesado IA** | Tres apartados, en este orden: **Modelo activo**, **Modelos** y **Equipo** (detalle abajo); en escritorio, cuatro: **Motor de ejecución** entre *Modelos* y *Equipo*. Donde la tubería no existe (la web, hasta X3d; lo dice el servicio, `NOT_BUILT`), arriba una línea en auxiliar: *El post-procesado llega en una próxima versión; ya puedes descargar, importar y preparar modelos* |
| **Sistema** | **Almacenamiento** | Espacio usado por categoría (modelos, historial de resultados, biblioteca, caché) con barra y *Liberar* por fila; límite del historial (número y tamaño); pedir almacenamiento persistente al navegador; en escritorio, la carpeta de datos con *Abrir carpeta* |
| | **Escritorio** | Solo en la aplicación de escritorio: modo portable (sí o no y dónde están los datos), navegador que dibuja la ventana, carpeta de registros |
| | **Actualizaciones** | Encima de *Acerca de*, en web y escritorio: versión instalada; **Buscar actualizaciones** con el resultado en su fila (*Tienes la última versión* · *Repackshot X está disponible* con **Descargar**, el paquete de esta plataforma, y **Notas** · *No se pudo comprobar* con el motivo real); **Buscar al iniciar** (activado por defecto): al arrancar comprueba una vez en segundo plano y, si hay versión nueva, lo dice en una línea de la barra de estado con *Descargar · Notas · Más tarde*, nunca en una ventana; *Última comprobación*. La fuente son las releases de GitHub (`src/data/update-feed.ts`) |
| | **Acerca de** | Versión, licencia (PolyForm Noncommercial 1.0.0, resumen y texto completo), **licencias de terceros** con su texto (three.js, rhino3dm, occt-import-js con el enlace a su código fuente, stable-diffusion.cpp y ggml —MIT, el motor de ejecución de la IA de escritorio, X3c—, y los modelos de IA descargados con la suya), créditos (EZ Packshot) |

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

**Post-procesado IA ▸ Prompt del sistema** (X4b): unas palabras generales para
todas las imágenes (es un ajuste de la aplicación, no del proyecto: no se deshace
ni va en el `.repack.json`), en un campo de varias líneas con el predeterminado del
líder (*Photorealistic product photograph. Keep the image exactly as rendered…*, en
inglés: los codificadores de texto de los modelos rinden mejor en él), contador
*n / 2000*, **Restablecer el predeterminado** (deshabilitado mientras lo es) y la
línea auxiliar *Palabras generales para todas las imágenes; van antes de la
descripción de la escena y del prompt propio de cada trabajo. Las protecciones de la
guarda no dependen de ellas.* Se guarda al dejar de escribir o al salir del campo;
puede quedarse vacío (ninguno). Con un modelo activo que lee pocos *tokens*, una
línea dice qué recibe: *SD 1.5 ligero lee como mucho 77 tokens: recibe la versión
corta de este prompt* (mientras el texto sea el predeterminado; *La versión corta*
se despliega debajo), *≈ 40 de los 77 tokens que lee …* o *Demasiado largo para …:
el final de este prompt se queda fuera, después de la descripción de la escena y del
prompt del trabajo*. En escritorio va en `settings.json` de la carpeta de datos, como
todos los ajustes (P3e). Captura: `docs/ui/settings-ai-prompt.png`.

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
descargándose desde el primer arranque. **Primer arranque de un portable**
(fase U10): el selector (*Elige los modelos de IA que descargar*) ofrece
también **el motor de ejecución** que elige la regla para este equipo
(*Descargar también el motor de ejecución (Vulkan · 29 MB): es lo que
ejecuta los modelos*), marcado y desmarcable; con la casilla marcada baja
con el primer modelo cuyo botón *Descargar* se pulsa, como en el
instalador.

**Post-procesado IA ▸ aviso** (fase U10): arriba de la sección, el mismo
recuadro del motor de ejecución que la ventana de render (sin el botón
*Ajustes…*), antes del modelo activo.

**Post-procesado IA ▸ Motor de ejecución** (solo escritorio, X3b): la compilación de
stable-diffusion.cpp que toca (`src/data/ai-runtimes.json`) con su nombre y la marca *Aún sin
probar en un equipo real* mientras `verified` esté vacío; por qué es esa (*Vulkan, porque se ha
encontrado una tarjeta gráfica que usar* · *CPU, porque no…* · *como dice Ejecutar con*) y en qué
dispositivo se ejecuta, tal como lo dijo el propio motor (`--list-devices`); su estado (*No
descargado · 26 MB* · *Descargando 42 % · 11 MB de 26 MB* con barra · *En pausa* · *Comprobando el
sha256* · *Descomprimiendo* · *Instalado · stable-diffusion.cpp version unknown, commit d637cfb*,
y *cargado: <motor>/<modelo>* mientras el modelo está en memoria); licencia y versión de la
*release* y lo que necesita el equipo (en Windows, el entorno de Visual C++; en Linux, glibc 2.38);
acciones *Descargar*, *Pausar*, *Reanudar*, *Eliminar* (con confirmación) e *Instalar desde un
archivo…* (un zip descargado con el navegador, que solo se instala si su `sha256` es el fijado);
avisos en línea si el último intento falló, si no arranca en este equipo (con el motivo, p. ej. la
DLL que falta) o si no hay `curl` para descargar. Si una compilación de Windows no arranca porque
falta el entorno de **Microsoft Visual C++ 2015–2022** (X3c: lo comprueba el lanzador, sus DLL ni en
la carpeta del motor ni en `System32`), el aviso lo dice y salen **Instalar el entorno de Microsoft
Visual C++…**, que abre la página oficial de Microsoft en el navegador del sistema (no
redistribuimos sus DLL), y **Comprobar de nuevo**. Debajo, **Ejecutar con**: *Automático* (Vulkan
con tarjeta gráfica, la CPU sin ella) · *Vulkan (tarjeta gráfica)* · *CPU*. Nada de esta fila se
estima: todo lo dice el lanzador.

**Post-procesado IA ▸ Equipo**: lo detectado (GPU y su VRAM dedicada,
RAM, núcleos, WebGPU sí o no y el tamaño máximo de búfer) y la
recomendación que sale de la regla de `AI-POST.md` §2.4, con la fila de
la tabla que la decide. Si la detección falla, se dice y no se
recomienda nada. En escritorio, sin tarjetas en la lista, *Tarjeta
gráfica* y la fila *GPU* distinguen *No se ha encontrado ninguna tarjeta
gráfica* (el lanzador preguntó y no hay) de *No se han podido leer las
tarjetas gráficas: mira los registros* (ninguna fuente contestó,
`gpuDetection: failed`).

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
| `M` | Herramienta de mover |
| `S` | Herramienta de escalar (fase U9) |
| `L` / `G` | Ejes locales / globales de mover y escalar |
| `Ctrl/⌘ ⇧ L` | Mirar a través de la luz o la cámara seleccionada (fase L4); otra vez o `Esc`, volver |
| `H` / `⇧ H` / `Alt H` | Ocultar selección / Aislar / Mostrar todo |
| `1` `2` `3` `4` | Nivel de selección: Modelo · Grupo · Pieza · Caras |
| `Tab` | Plegar y desplegar los paneles laterales |
| `Esc` | Volver de *Mirar a través*; salir de *Mover* o *Escalar*; deseleccionar; cerrar paleta o menú |
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
- Con *Seleccionar* (o *Mover* o *Escalar*), un clic en el visor, a cualquier nivel:
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

### 4.7 · Recorrido guiado

Una capa propia —nunca ventanas del navegador— que recorre la pantalla
zona por zona (fase U10, `ui/tour.ts` y `ui/panels/tour.ts`). Sale **sola
en el primer arranque** y desde *Ayuda ▸ Recorrido guiado* (o la paleta:
*Recorrido guiado*), y **se puede saltar siempre**. Oscurece todo menos la
zona del paso, la rodea con un anillo (blanco por dentro, negro por fuera,
visible sobre cualquier contenido) y pone al lado una tarjeta con el
número del paso, un título, un texto corto, **puntos de progreso** (uno
por paso), **Saltar recorrido · Atrás · Siguiente** (*Hecho* en el último)
y la pista de teclas. Es modal: la capa se queda con el puntero y con todas
las teclas, de modo que nada de debajo cambia (ni `Supr` borra, ni `F`
encuadra): `→` y `Av Pág` avanzan, `←` y `Re Pág` retroceden, `Esc` salta,
`Intro` y `Espacio` pulsan el botón con el foco y `Tab` solo da vueltas por
los botones de la tarjeta. Acromática en los dos temas; `es` y `en`.

Los pasos, en este orden: **bienvenida**; **menú de la aplicación**;
**piezas** (el árbol) y **niveles de selección**; **herramientas de vista**
(Seleccionar con la caja de `Ctrl`, Mover, Escalar, Orbitar, Desplazar,
Zoom; en un proyecto vacío la barra se muestra igualmente mientras dura el
recorrido) y **Rápido y Completo**; el inspector: **producto y estudio**,
**luz y montajes**, **entorno y cielo**, **cámara y enfoque con clic**,
**materiales** (con el catálogo abierto y la primera pieza seleccionada; sin
pieza, el propio inspector); las pestañas **Luces**, **Cámaras** y
**Estudios**; **Añadir ▸ Primitiva**; **Render…**, la **ventana de render**,
la **cola** y el **post-procesado IA**; los **resultados** (el historial del
cajón *Cola*, donde se abre el visor) y **Ajustes** una sección por paso
(con el nombre y la descripción de la propia sección; *Escritorio* solo en
la aplicación de escritorio); y el cierre. 30 pasos en la web, 31 en el
escritorio. Las zonas se localizan por los `data-guide` del código (los de
la guía y los nuevos: `app-menu`, `parts-tab`, `levels`, `tools`,
`add-primitive`, `scene-panel`, `inspector`, `section-<id>` en cada sección
del inspector y de la ventana de render, `render-window`, `rw-actions`,
`history`, `settings-content`).

Un paso cuya zona no está a la vista **la pone**: abre la pestaña, el panel
lateral (en una ventana estrecha, solo el que hace falta), la ventana de
render o la de Ajustes en su sección, el cajón *Cola*, el catálogo de
materiales, y selecciona lo que el paso necesita (la selección no se
deshace ni toca el proyecto); y **al terminar lo deja todo como estaba**
(pestaña, paneles, cajón, ventanas, sección recordada de Ajustes,
catálogo y selección). Un paso cuya zona no aparece en 0,7 s se salta en la
dirección en que se iba (nunca se queda colgado). La tarjeta va **al lado
de la zona** sin taparla (a la derecha de lo que está en la mitad
izquierda, a la izquierda de lo que está en la derecha, debajo o encima de
una barra), **fuera de la ventana** de render o de Ajustes cuando hay sitio
y, si la zona es toda la ventana, **dentro de ella, donde no tape ningún
control** (botón, campo o interruptor), lo más cerca posible de su
esquina inferior derecha; si toda la sección es controles, en esa esquina.

Qué se recuerda: *Saltar*, *Hecho* y `Esc` cuentan como visto, y entonces
ya no sale solo (sí desde *Ayuda*). Se guarda en el documento de ajustes
(`layout.tourSeen`: la carpeta de datos en escritorio, nunca el
almacenamiento del navegador allí; el de la web en `localStorage` como lo
demás). No sale solo bajo automatización (`navigator.webdriver`: las
comprobaciones y capturas del navegador): `?tour=0` no lo lanza nunca,
`?tour=1` lo lanza ahora y `?tour=auto` hace lo del primer arranque aunque
haya automatización. En el primer arranque de un portable espera a que se
cierre el selector de modelos.

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
  opciones presentes pero marcadas *próximamente* en auxiliar (U1; desde
  E5 funcionan, con la imagen de fondo).
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
y texturas de imagen (fase M2a en la interfaz y la vista previa, M2b en el
motor), vista en sección. Todo está en `ROADMAP.md` con su
fase y su responsable. En la interfaz, cada uno de esos huecos se marca
con la palabra *próximamente* en texto auxiliar, nunca con un control que
parezca funcionar y no haga nada.
