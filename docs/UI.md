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
   Abrir proyecto (`Ctrl/⌘ O`), Guardar proyecto (`.repack`,
   `Ctrl/⌘ S`, en el mismo archivo si ya se guardó; Abrir también lee los
   `.repack.json` de antes de v0.1.6), Guardar proyecto
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

   A su derecha, en la misma zona (la que rodea el paso *Rápido y
   Completo* del recorrido guiado), el interruptor **Reducir ruido**
   (fase U11, atajo `D`): un botón de una posición, en negativo cuando
   está encendido, que reduce el ruido del visor *Completo* **en
   directo**, mientras se acumulan las muestras. Es el mismo estado que
   el botón *Reducir ruido* del medidor y que la parte *Visor* de
   *Avanzado ▸ Reducción de ruido* (*Los dos* ↔ *Render*, *Visor* ↔
   *Apagada*): una sola verdad, la del proyecto, deshacible (*Deshacer:
   Dejar de reducir el ruido del visor*) y guardada con él, también
   cuando la ventana de render está editando un trabajo de la cola. El
   *tooltip* lo dice en una frase. En *Rápido* se ve deshabilitado con
   la ayuda *Se aplica al modo Completo*, y `D` no hace más que decirlo.
   Encenderlo reduce el ruido de lo acumulado en ese momento (también con
   el visor ya convergido) y apagarlo enseña en el fotograma siguiente
   la imagen ruidosa; ninguna de las dos cosas vuelve a empezar la
   imagen. Mientras se acumula, la imagen limpia se refresca tan a
   menudo como cuesta un *denoise* (§2.3, medidor) y los gestos de
   cámara siguen a resolución reducida, sin *denoise*.
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
suelo · Centrar · Centrar y apoyar · **Dejar caer** (fase S2) ·
Restablecer transformación ·
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

**Dejar caer** (fase S2; el mismo menú en el visor, el botón de la
sección *Físicas* y de la sección *Pieza* del inspector, y la paleta,
*Dejar caer la selección*) simula la selección al momento: lo
seleccionado pasa a *Dinámico* y cae sobre el suelo y lo que tenga debajo
(el resto de la escena, quieto), se abre el cajón **Físicas** (§2.5) y la
simulación se para sola cuando todo está quieto. Un grupo o un modelo cae
como un cuerpo salvo que tenga *Como piezas*. Está desactivado con la
selección bloqueada. Toda la caída es **una** entrada de deshacer
(*Deshacer: Dejar caer 3 piezas*). No hay un menú *Pieza* en la cabecera
en esta versión: su sitio es este menú contextual.

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
  fila va al lápiz y `←` vuelve) y la proporción de la cámara activa con
  la resolución de salida actual (*16:9 · 1920 × 1080*; clic: abre la
  barra de render). En la lista, la proporción de cada cámara sigue a su
  óptica (*85 mm · f/5.6 · 4:3*).
- **El marco del visor** (la imagen que se renderiza, con lo de fuera
  atenuado) es **de la cámara que se está viendo**: la activa, o la que se
  mira a través (*Mirar a través*), con **su** proporción (U13). Cambiar la
  proporción de la cámara activa cambia el marco al instante; cada cámara
  guardada se dibuja en el visor con la pirámide de su propia proporción.
  Con una animación en marcha el marco sigue siendo el de la cámara
  activa: la salida tiene un solo tamaño y el Doctor avisa si un plano
  usa una cámara con otra proporción.
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
  muestra* cuando el motor las renderiza, y **Adaptativo · 16–512 muestras**
  (E10) cuando el visor muestrea adaptativamente (*Terminar por Ruido*):
  las muestras del píxel que menos y del que más tiene en lo acumulado, las
  del motor (la primera línea sigue diciendo las de la imagen que se ve: con
  *Ruido reducido*, las de la imagen filtrada, que va una pasada o más por
  detrás); y el botón **Reducir ruido**
  (pulsado o no) enciende o apaga el *denoise* del visor: el mismo
  interruptor que *Reducir ruido* de la barra superior (§2.1, atajo `D`),
  la parte del visor de *Avanzado ▸ Reducción de ruido* (*Los dos* ↔
  *Render*, *Visor* ↔ *Apagada*), deshacible. Desde U11 el *denoise* es
  **en directo**: un carril aparte (un hilo del lanzador, que toma uno de
  los hilos del visor mientras trabaja; en la web, los *workers* del
  visor por bandas entre sus baldosas) reduce el ruido de la última
  pasada con el ajuste ligero del visor, la imagen limpia sale en cuanto
  está y el siguiente arranca entonces sobre la pasada más nueva: el
  visor la refresca al menos cada `max(2 × lo que cuesta un denoise,
  0,5 s)` y nunca enseña una limpia de hace más de un *denoise*. Las
  muestras del medidor son las de la imagen limpia que se ve. Para las
  comprobaciones de navegador el medidor lleva además, en atributos
  `data-*`, cuántas imágenes limpias ha enseñado, cuándo la última, lo
  que costó el último *denoise* (en la web) y las muestras de la pasada
  más nueva.
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
   motor del preset y, si el tipo es un set (L6: 15 de los 16), su
   decoración y su aspecto (fondo, tarjetas, suelo, charco de luz); el
   ejemplo y un modelo importado llegan ya vestidos con el set en vigor. Si ya hay estudio, pide confirmación en línea (no
   modal): "Sustituir el estudio actual · Sí / No".
2. **Luz** — El **catálogo de montajes**: fila de pestañas de estilo
   (*Todos* + los 9 `LIGHT_STYLES`, **Sets** el primero, L6), rejilla de
   miniaturas (`public/thumbs/setups/thumb_<clave>.png`, 256 × 256,
   renderizadas por el motor: §6) con la etiqueta debajo, la activa con
   borde de selección. Los **sets** van primero y en grande: dos columnas
   y cuadradas (el doble de alto que las demás); los demás montajes, en
   tres columnas y 4:3, como estaban; en *Todos*, la rejilla de los sets y
   debajo la del resto. La **ayuda** de la miniatura de un set dice su
   intención y su **razón fotográfica** (`why`, dos frases); la de un
   montaje, su intención. Debajo, la **intención** del montaje activo en
   una frase. Flechas *anterior / siguiente* dentro del estilo.
   Con un **set** en vigor, debajo: **Usar la cámara del set** (solo si
   sugiere una; la ayuda dice cuál, «8° de altura, 85 mm»; desactivado con
   la cámara bloqueada; una entrada de deshacer) y **En el set**: una fila
   por pieza de su decoración (cada tarjeta, el fondo del set, el suelo
   del set) con su nombre y un interruptor que la oculta o la muestra
   (`scene/setVisible`, deshacible); un fondo de color o degradado sin
   barrido es una fila que pone el fondo del set o devuelve el del tipo de
   producto (`env/set`). Un fondo que el set hace barrido (`SWEEP`, o
   cualquier fondo con charco de luz) es una pieza, nunca esa fila: tras
   *Restablecer montaje* no queda nada que encender (`setBackground`). El
   charco de luz es un foco: aparece en *Afinar focos* con su nombre.
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
   *Color* (muestra), *Degradado* (L6: *Arriba* y *Abajo*, dos muestras;
   lo ponen los sets de fondo degradado), *Transparente*, *Imagen de
   fondo*; con esta última,
   *Cargar imagen…* (PNG, JPEG, WebP), su nombre y tamaño, *Encaje*
   (*Llenar · Encajar · Estirar*, dentro del marco de salida) y el color,
   que se ve alrededor de la imagen encajada o en su lugar mientras no hay
   ninguna. Un archivo que no se puede leer se avisa en un *toast* que
   dice qué le pasa. Sombra en el suelo y reflejo en el suelo
   (intensidad).
4. **Ambiente** (fase S4a) — Los efectos de partículas del aire. En la
   cabecera, **Añadir**, que abre una **galería de tarjetas** en la propia
   sección (nombre e intención de cada preset: *Motas de polvo*, *Polen*,
   *Lluvia*, *Nieve*, *Polvareda*, *Ceniza*, *Burbujas que suben*,
   *Confeti que cae*; *Calima*, *Haces de luz* y *Niebla baja* atenuadas y
   deshabilitadas, *próximamente*, y *Cancelar*). Debajo, la **lista** de
   efectos (vacía: una frase que invita a añadir uno): nombre, partículas
   que pide (o *Pide N partículas; el motor evalúa M* si pasa del tope),
   ojo para encender/apagar y papelera; un clic edita ese efecto, y el
   visor dibuja la caja de su región. El efecto editado: **Efecto**
   (desplegable de presets; cambiarlo es una entrada de deshacer) y
   **Nombre**, una línea con sus partículas, y los **ocho mandos de
   fotógrafo**, siempre visibles: *Cantidad* (partículas/m³ o cuenta),
   *Tamaño* (mm), *Energía* (m/s), *Caos* (%), *Viento* (m/s) y
   *Dirección del viento* (°), *Gravedad* (× g), *Variación* (%) y
   *Semilla* con *Barajar*. **Avanzado**, plegado: región (*Alrededor de
   la escena* con margen en mm, o *Caja propia* con centro y tamaño),
   banda de alturas, *Cantidad por* (*Densidad · Cuenta*), forma (*Punto ·
   Copo · Estela*), variación de tamaño, velocidad de caída ± variación, giro
   (copo), largo de estela (estela), viento como vector, turbulencia
   (escala y velocidad), nube (centro, radio, suavidad), material (*El
   propio del efecto* o uno del catálogo), variación de tinte y tintes (hasta
   4), *Congelar en* (s), *Visible a cámara*, *Visible en reflejos* y *Proyecta
   sombra*, y el tope propio (*El del motor (N)* por defecto). Una nota
   recuerda que *Rápido* dibuja hasta 50 000 partículas por efecto y
   *Completo* y *Render* todas, iluminadas como el producto. Desde S4b, en
   *Completo* y *Render* el polvo, el polen y la polvareda se encienden a
   contraluz (su lóbulo hacia delante, sin mando propio: lo trae el
   material del preset) y la lluvia y las burbujas no dejan cáusticas; los
   puntos de *Rápido* no cambian.
5. **Sección** (fase Q1) — La vista en sección (`SPEC.md` §3.1): un plano
   que quita un lado de la pieza y tapa el corte. Va **plegada** por defecto,
   con el **interruptor en la cabecera** (el primer encendido hace un plano
   por el centro del producto, de cara a la cámara; *Sección activada*
   es una entrada de deshacer). Dentro: **Cortar según**, segmentado *X · Y ·
   Z · Superficie*; dos botones que arman el siguiente clic del visor,
   **Clic en la pieza** (el plano pasa por el punto y es perpendicular al
   eje elegido, o a la normal de la superficie; se quita el lado que mira
   al espectador) y **Dos puntos** (dos clics: el plano contiene la línea
   y la dirección de la vista, y se quita lo que queda a la izquierda de la
   línea del primero al segundo); mientras uno está armado el visor lo dice
   en la franja de arriba (*Sección: haz clic en la pieza para cortar según
   Z · Esc cancela*), pulsar otra vez el botón o `Esc` lo baja, un clic que
   no hace plano se avisa y se espera otro, y el clic que hace el plano deja
   **una** entrada (*Colocar el plano de sección*; el primero de los dos
   puntos solo se recuerda y no deja ninguna). Con plano hay **Punto**
   y **Normal** en números (la normal se normaliza y una que no sea nada no
   se toma), **Tapar el corte**, **Cambiar de lado** y **Quitar el plano**;
   sin plano, una frase dice cómo hacer uno. Una nota enumera las piezas
   cortadas que son mallas abiertas (el corte enseña su interior, sin
   tapa), otra dice cómo animarlo (un movimiento *Sección* sobre el
   Entorno en la línea de tiempo, §2.5) y otra que *Rápido* dibuja la tapa
   de un vidrio como vidrio transparente y *Completo* y *Render*
   refractan a su través. El fondo, el suelo y las tarjetas de un set no se
   cortan. **Por qué aquí y no en la barra del visor**: es un objeto de la
   escena, que se guarda con el proyecto, se anima y se ve en Completo y en
   Render, como el entorno y el ambiente; las herramientas de la barra son
   de navegación y transformación y no dejan nada en el proyecto. El
   recorrido guiado (§4.7) no lista *Ambiente* ni *Sección*, y no gana paso.
   La paleta (§3) tiene *Vista en sección: activar o desactivar* y *Vista en
   sección: cambiar de lado*. Capturas: `docs/ui/section-fast.png` y
   `docs/ui/section-full.png`; la comprobación en el navegador es
   `tools/section-check.mjs` (orden de las secciones, cada camino de
   ponerla, `Esc`, deshacer y rehacer, guardar y abrir, *Completo*, y el
   cromo acromático en los dos temas).
6. **Cámara** — Edita la **cámara activa**, y lo dice: la cabecera lleva
   su nombre (*Cámara 1*) y un lápiz que abre la ficha de esa cámara
   (nombre, *Activar*, *Mirar a través*); una nota recuerda que cada
   cámara tiene su óptica y su posición. Preset de óptica (8
   `LENS_PRESETS`), focal en mm (campo arrastrable), diafragma (f/),
   distancia de enfoque + botón *Enfocar con clic*, interruptor
   Perspectiva / Ortográfica, **Proporción** (U13), *Encuadrar*, y
   *Guardar como cámara*. **Proporción** es una lista (*3:2 · Foto 35 mm*,
   *4:3*, *16:9 · Vídeo*, *1:1 · Cuadrado*, *5:4*, *4:5 · Retrato*,
   *9:16 · Vertical*, *21:9 · Ultra ancho*, *2:1*, *65:24 · Panorámica* y
   *Propia*) y, debajo, los campos `w : h`, que se pueden editar con
   *Propia* (con un preset enseñan sus términos, apagados; elegir *Propia*
   parte de la proporción que había). Cada cambio es una entrada de
   deshacer (*Cámara: Proporción*; arrastrar un término es un solo
   gesto). Cambiarla no recoloca la cámara: *Encuadrar* la ajusta a la
   nueva imagen.
   Debajo (O1, `src/ui/panels/insp-lens.ts`), los desplegables de la óptica:
   - **Lente** (abierto; O2, `src/ui/panels/insp-traced.ts`): *Modelo de
     lente* (*Lente fina · Lente trazada*). Con la lente fina, una nota dice
     lo que es (una lente ideal). Con una trazada: *Carácter*, una fila de
     chips (*Clínica · Suave · Remolino · Vintage · Anamórfica · Macro · Gran
     angular · Tele · Míos*) que filtra la lista *Lente* (las lentes del
     catálogo de ese carácter, por su nombre genérico); *Míos* enseña las
     lentes propias en filas con *Renombrar* y *Eliminar*, y elegir una la
     pone en la cámara. La lista *Lente* es la propia de la interfaz (O2b:
     un botón con la flecha de un desplegable que abre el menú de la
     interfaz, con la lente puesta marcada; flechas, Intro y Esc; no un
     `select` del navegador, que no dice a la página sobre qué entrada está
     el puntero). Debajo, la **fuente** de la lente (la patente o el
     libro, el año y lo que se ha comprobado), y lo suyo: *Objetivo detrás*
     (solo el adaptador anamórfico: la lente sobre la que va), *Tratamiento*
     (*El de la lente · Sin tratar · Monocapa · Multicapa*), el hueco
     variable de la lente blanda con *Normal*, *Láminas* (el mismo mando que
     en *Óptica avanzada*) y el recorrido de su diafragma (*Su diafragma: f/2
     a f/22*). **Lo que calcula el motor**: el **corte** de la lente en SVG
     (el vidrio en gris, el diafragma en su sitio, el sensor a la derecha;
     escalada a la focal y enfocada, como se traza) y los números del motor
     para esa cámara: *Focal* (a infinito y al foco), *Tiraje*,
     *Diafragma* (el f/ en uso y el T-stop), *Elementos · grupos*,
     *Longitud*, *Pupila de entrada* y, en un anamórfico, *Compresión al
     foco*; y dos curvas pequeñas, *Distorsión* y *Luz hacia la esquina*, con
     su valor en la esquina. Mientras el motor contesta dice *Preguntando al
     motor…*; sin motor, *El motor no está disponible aquí*; si no forma
     imagen, lo dice. **Avanzado** (plegado), bajo **NO FÍSICO**:
     *Distorsión*, *Viñeteo*, *Carácter de la esférica*, *Respiración*,
     *Aberración cromática* y *Remolino*. **Guardar lente como…** pide un
     nombre en el sitio y la guarda en *Míos*. Dos notas: el modo Rápido
     dibuja la distorsión y el viñeteo como aproximación (y el medidor añade
     *Lente trazada: distorsión y viñeteo aproximados, el render la traza*;
     el contorno, el *gizmo* y los glifos van con ella, y los clics, la caja
     y el *gizmo* cogen lo que se ve bajo el cursor),
     y con una lente trazada el perfil, el ojo de gato, la compresión
     anamórfica y la inclinación de la lente fina no se aplican (en *Óptica
     avanzada* salen apagados con esa nota). Cada cambio es una entrada de
     deshacer (*Cámara: Modelo de lente*, *Cámara: Lente*, *Cámara:
     Tratamiento*…).
     ![editor de lente](lens-editor.png)
     ![lo que calcula el motor](lens-section.png)

     **Ventana de los elementos** (O2b, `src/ui/components/lens-peek.ts`,
     la lógica en `src/ui/lens-peek.ts`): al dejar el puntero un momento
     (300 ms: cruzar la lista no abre nada) sobre una lente de la lista
     abierta, o al llegar a ella con el teclado, se abre a un lado de la
     lista y a la altura de la entrada una ventana con el **corte** de esa
     lente (el mismo dibujo, `components/lens-section.ts`, que la sección
     *Lo que calcula el motor*), su **nombre**, su **fuente** (la patente o
     el libro, el año, lo comprobado) y los números que **el motor** da
     para ella con la focal, el diafragma, el foco y el encuadre de la
     cámara: *Focal*, *Diafragma* (f/ y T-stop), *Elementos · grupos*,
     *Longitud* y, en el adaptador anamórfico, *Compresión al foco*. Sobre
     un chip de **carácter** abre la ventana de las lentes de ese carácter
     (hasta cuatro, en dos columnas, con el nombre del carácter arriba);
     *Míos* no abre ventana. Al motor se le pregunta por la lente señalada
     (`rt.wasm` de la página, o `/api/lens/info` en el escritorio), sin
     bloquear nada: mientras contesta la tarjeta dice *Preguntando al
     motor…*; sin motor (la versión web sin `rt.wasm`) dice *El motor no
     está cargado: sin corte ni números para esta lente* y deja solo el
     nombre y la fuente (regla 10: ningún número que no sea del motor); si
     no forma imagen con esa lente y esos ajustes, lo dice. Cada lente se
     pregunta una sola vez por cada focal, foco, diafragma y encuadre de la
     cámara, así que volver a pasar no vuelve a preguntar; la lente puesta
     se dibuja con lo que ya preguntó la sección. La ventana se cierra al
     sacar el puntero o el foco, con Esc (que no hace nada más) y al
     elegir la lente o pulsar el chip; no toma el foco ni el puntero (se
     pulsa a través de ella), se vincula a la entrada con `aria-describedby`
     y no sale de la ventana del navegador (en una pantalla baja se
     recorta).
     ![ventana de una lente de la lista](lens-hover.png)
     ![ventana de las lentes de un carácter](lens-hover-chip.png)
   - **Bokeh** (abierto): rejilla de 4 columnas con los 20 tipos de
     `src/data/bokeh.json`, cada uno con su **miniatura renderizada por
     el propio motor** (`public/thumbs/bokeh/`, `tools/bokeh-thumbs.mjs`:
     doce puntos de luz desenfocados sobre negro) y el nombre debajo; la
     descripción del tipo va en el *tooltip* y, del elegido, en una nota.
     Los tres de la lente trazada (O2: cometa de coma, respiración de
     foco, aberración esférica variable) tienen su miniatura renderizada
     con su lente y la ponen en la cámara (lo dice el *tooltip*); el de
     difracción sale apagado con *Próximamente* (*Necesita óptica de
     ondas*). Un tipo
     con variantes (polígono recto o curvo, obstrucción pequeña o
     grande, polvo, rayas o malla, las estrellas y el corazón, 7 o 19
     agujeros) muestra *Variante* y su miniatura en la casilla. Mover un
     mando a mano desmarca el tipo y la nota dice *A medida*. *Disco
     sencillo* quita toda la óptica (la lente fina de siempre). Cada
     elección es una entrada de deshacer (*Cámara: Tipo de bokeh*).
     ![bokeh](camera-bokeh.png)
   - **Óptica avanzada** (cerrado): *Láminas* (0 es *Diafragma redondo*,
     de 3 a 18), *Redondez*, *Giro*, *Perfil* y su *Intensidad*,
     *Obstrucción*, *Ojo de gato* (oscurece las esquinas como los bordes
     de una lente real; lo dice el *tooltip*), *Anamórfico* (*No · 1,33× ·
     2×*; la imagen sale ya desestirada, y el *tooltip* avisa de que el
     bokeh ovalado concentra más luz al mismo diafragma), *Inclinación* y *Eje de la
     inclinación* (Scheimpflug; a 0° el plano de enfoque se inclina hacia
     el suelo), *Desplazamiento* H y V en mm (mueve el encuadre sin
     cambiar la perspectiva; el modo Rápido lo muestra), y bajo la marca
     **NO FÍSICO** *Aberración cromática* y *Remolino*. Una nota recuerda
     que todo esto se ve en el modo Completo y en el render.
     ![óptica avanzada](camera-optics.png)
   - **Filtros** (cerrado si la cámara no tiene ninguno; O3a): la pila de
     filtros de efecto delante del objetivo, hasta tres, en orden. Sin
     ninguno dice *Sin filtros*. **Añadir filtro** pone una *Difusión
     negra* de grado 1/2 (o una *Estrella* si ya hay una difusión negra);
     con tres, el botón se apaga y dice *Tres filtros como máximo*. Por
     filtro: *Filtro* (lista con los ocho tipos) con la frase de lo que
     hace fotográficamente debajo, una **×** para quitarlo, *Grado*
     (*1/8 · 1/4 · 1/2 · 1 · 2*) y, según el tipo, *Tinte* (muestra de
     color y *Tinte propio* para volver al del tipo), *Puntas* (*4 · 6 ·
     8*) y *Ángulo*. Cada cambio es una entrada de deshacer (*Cámara:
     Añadir filtro*, *Cámara: Grado*…). Una nota dice que el modo
     Completo y el render los trazan y que el Rápido dibuja una
     aproximación; con filtros, el medidor del modo Rápido añade
     *Filtros: aproximación, el render lo hace el motor*.
     ![filtros](lens-filters.png)
7. **Imagen** — Exposición (EV), transformada de vista (Estándar /
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
   (color, rugosidad, IOR, transmisión, *Distancia de absorción* en mm,
   *Paredes*: *Macizo · Pared fina*, y bajo ellos, E9, *Dispersión
   interna* en mm —lo que recorre la luz dentro entre dos rebotes; 0,
   transparente—, *Color de dispersión* —lo que conserva cada rebote de
   cada color— y *Dirección*, de −0,9 a 0,9, con la ayuda «hacia delante /
   hacia atrás»; la ayuda de *Dispersión interna* dice que el modo Rápido
   la aproxima; y, E9c, *Número de Abbe*, de 0 a 100 —la dispersión
   cromática del vidrio macizo: cuanto menor, más separa los colores; 0,
   ninguna—, cuya ayuda dice también que Rápido la aproxima); madera
   (dos colores, densidad de anillos por 100 mm, *Escala*, *Contraste de
   anillos*, variación, ruidos, *Poros*: lo pintan el modo Completo y los
   renders, y su punto «·» y su ayuda lo dicen; la vista Rápida muestra el
   color medio; *Nudos*, *Tamaño de los nudos* en mm, *Variación de
   tamaño* y *Oscuridad de los nudos*, que la vista Rápida ya enseña
   oscureciendo donde caen; en el bambú, el MDF y el ébano están
   desactivados y su ayuda dice por qué); tela (dos colores de hilo, tipo de
   tejido, *Hilos por cm* (2–200, físicos), relieve, pelusa: el tejido, su
   densidad y su relieve los pintan el modo Completo y los renders, y la
   vista Rápida muestra su color medio); emisor (tipo, temperatura,
   potencia).
   Solo se pintan los que la familia usa. Un botón *Convertir en material
   propio* separa la instancia del preset cuando se edita (el nombre pasa
   a "Oro (editado)").
   Sobre los parámetros, una fila **Simple · Nodos** y el botón **Nodos…**
   (fase M3a). *Nodos* convierte el material en su grafo mínimo (una
   entrada de deshacer); *Nodos…* hace lo mismo si hace falta y abre el
   **editor de material** (§2.10). En modo *Nodos* los parámetros dejan
   sitio a unas líneas que dicen cuántos nodos tiene el grafo, cómo lo
   dibuja *Rápido* y qué aproxima, y qué hacen *Completo* y *Render* (el
   motor ejecuta el grafo en cada punto; uno anterior, el valor medio de
   cada salida; fase M3b). Volver a
   *Simple* desde un grafo que no es el mínimo pregunta en línea (§4.3):
   *¿Volver a Simple? Simple guarda solo los valores propios de la salida:
   se van N nodos y sus conexiones (Deshacer los recupera)* · **Volver a
   Simple** · *Cancelar*. El menú contextual de la pieza tiene en
   *Material ▸* la entrada **Editar con nodos…**, y la paleta de comandos
   *Abrir el editor de material*.
2. **Texturas** (fase M2a) — Una nota dice que *Rápido*, *Completo* y
   *Render* dibujan las texturas y las etiquetas en el mismo sitio (el motor
   las pinta desde M2b). Una fila por **ranura**: *Color*,
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
   *Dejar caer* (fase S2), radio de bisel de aristas (mm), suavizado. El
   bisel es del material (lo dice la nota bajo el campo: *Es del material.
   El modo Completo redondea las aristas vivas en el sombreado, como un
   redondeo de este radio; la vista Rápida las muestra vivas*): lo dibuja el
   motor desde E6 (`ARCHITECTURE.md` §5.2 septies); three.js no puede hacerlo
   barato y la vista *Rápida* no lo intenta.
5. **Físicas** (fase S2; `SPEC.md` §3.1) — **Papel**, segmentado:
   *Estático · Dinámico · Tela · Líquido*, con *Tela* y *Líquido*
   desactivados y un *tooltip* que dice *próximamente*; con varios nodos de
   papeles distintos, ninguno marcado. Si la pieza cae con un grupo
   dinámico que no cae *como piezas*, una nota lo dice (*Cae con Tapón,
   como un cuerpo*). **Densidad** en kg/m³, arrastrable; debajo, en
   auxiliar, de dónde sale (*Del material (Metal): 7 800 kg/m³*, *Sin
   material: 1 000 kg/m³ (agua)* o *Densidad propia*, con el botón *Usar
   la del material*). **Rozamiento** (0–2) y **Rebote** (0–1),
   arrastrables. Con un grupo o un modelo, el interruptor **Como piezas**
   y su nota. Una nota dice que la masa es la densidad por el volumen de
   la envolvente convexa, y el botón **Dejar caer**. Cada cambio es una
   acción del *store* y un arrastre una sola entrada de deshacer
   (*Deshacer: Físicas de Cuerpo*). En el nivel *Caras*, la sección edita
   la pieza de la cara.

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
escena, con su **Proporción** (la de *esa* cámara: editarla no toca el
tamaño de la ventana de render mientras no sea la activa), más nombre,
*Activar* y, si no es la activa, *Mirar a través* (fase L4).

### 2.5 · Barra inferior: Animación · Físicas · Cola · Render

Siempre visible, 48 px. La configuración del render **no vive aquí**:
vive en la **ventana de render** (§2.7), que se abre con el botón
*Render…*. La barra queda con tres cosas:

- A la izquierda, los cajones **Animación**, **Físicas** (fase S2) y
  **Cola** (abren un cajón de 240 px sobre la barra; el de *Físicas*, solo
  lo que ocupa). *Físicas* lleva, mientras una simulación corre, cuántos
  cuerpos siguen despiertos. *Cola* lleva un contador de trabajos pendientes
  y, mientras hay uno en marcha, una barra de progreso fina en su borde
  inferior con el nombre del trabajo y el tiempo restante en el tooltip.
- En el centro, en texto auxiliar, el último resultado (*Joyería_Cámara 1
  · 1920 × 1080 · hace 2 min*); clic lo abre en el visor de resultados
  (§2.8).
- A la derecha, **Render…** (botón primario, el más grande de la
  pantalla; `Ctrl/⌘ ⏎`), que abre la ventana de render. `Ctrl/⌘ ⇧ ⏎`
  renderiza directamente con los últimos ajustes, sin abrir la ventana.

**Cajón Animación** (N6): una línea de tiempo de **tres zonas**, como el
espacio de animación de KeyShot y las tiras de Blender o After Effects
(sin copiar nada), para que quede claro **qué** se anima (izquierda),
**cuándo** (centro) y **cómo** (derecha). Mide al menos 300 px de alto;
la versión de U1 con planos y tarjetas queda sustituida.

- **Cabecera** (transporte): *Reproducir / Pausar* (`Espacio`), *Ir al
  principio* (`Inicio`), *Ir al final* (`Fin`), **Bucle** (encendido, al
  acabar vuelve a empezar; apagado, se para al final); el cabezal en `s`
  y su total (*2 s / 7 s*), el fotograma (*Fotograma 48*); los **fps**
  (campo numérico); el **zoom** de la línea de tiempo (*Alejar*, *Ver
  toda la animación*, *Acercar*: con zoom las pistas se desplazan en
  horizontal bajo el árbol, que no se mueve); a la derecha **+ Animar…**
  (botón primario, contextual: *Animar Tapón…* con una pieza elegida en
  la escena, *Animar…* sin nada), **Presets ▾** (`SEQUENCE_PRESETS`, que
  sustituyen la animación de una vez; deshacer la recupera),
  *Renderizar animación…* (la ventana de render en modo *Animación*) y
  cerrar.
- **Izquierda, el árbol de lo animado** (*qué*). Una fila por objetivo,
  en este orden: la **pista de cámara** (siempre, aunque no haya planos),
  el modelo, sus grupos y piezas en el orden del árbol de la escena, los
  focos y el entorno; cada una con su icono, su nombre, cuántas
  animaciones lleva, un triángulo para plegarla y un **+** al pasar por
  encima (*Animar Tapón…*). Debajo, sus animaciones, cada una con el icono
  de su tipo y su **frase corta** (*orbita 90° · 4 s · suave*; *se
  despieza desde su centro 1,5 × tamaño · 3 s · suave*; la frase entera,
  en la ayuda). **Clic en una animación** la elige (`Ctrl/⌘` la añade o la
  quita, `Mayús` la añade): el visor **resalta su objetivo** con el
  contorno de la pieza bajo el puntero y dibuja su **pista**. **Clic en un
  objetivo** lo elige en la escena (la pieza, el grupo, el modelo, el
  foco) junto con todas sus animaciones. Al revés, **elegir una pieza en
  la escena** pone en negrita las filas de lo que la mueve (sus
  animaciones, las de sus grupos y las del modelo; no las de un despiece
  del que es excepción). **Menú contextual** de una animación:
  *Duplicar* (`Ctrl/⌘ D`), *Invertir*, *Partir en el cabezal* (solo una
  animación que se reproduce una vez y hacia delante, con el cabezal
  dentro, de un tipo que suma —giros, distancias, despiece a la vez— o
  multiplica —escala, acercamiento—: las dos mitades siguen una de otra),
  *Fijar la selección en este despiece* (en un despiece) y *Eliminar*
  (`Supr`). De un objetivo: *Animar…*, *Seleccionar*, *Plegar /
  Desplegar* y *Borrar sus animaciones*. Sin nada animado, una nota dice
  cómo empezar.
- **Centro, la línea de tiempo** (*cuándo*). Arriba la **regla**: los
  segundos con su número de fotograma debajo, con marcas intermedias;
  clic o arrastre en ella mueven el **cabezal** (fotograma a fotograma),
  una línea con su triángulo que cruza todas las pistas, y el visor
  enseña ese instante. Cada fila del árbol tiene su pista a la misma
  altura: la **pista de cámara** con sus **tramos** (*Plano 1 · Cámara 1*;
  sin planos, uno discontinuo, *Cámara activa*), cuyo borde derecho se
  arrastra para cambiar la duración del plano y cuyo menú contextual
  elige la cámara del plano o lo quita, con **+** al final para añadir
  otro; la de un objetivo, una franja tenue de su primera a su última
  animación (plegado, las barras de todas, finas); la de una animación,
  su **barra** con la frase corta (las repeticiones, con marcas
  discontinuas; invertida, con una flecha a la izquierda). Una barra se
  **arrastra para moverla** (todas las elegidas a la vez) y se **estira
  por cualquiera de sus extremos**; el **imán** la lleva a los bordes de
  las otras barras, al cabezal, a los cortes de plano y a los segundos
  enteros cuando está a menos de 6 px (una línea discontinua enseña dónde
  ha pegado), y si no, a fotogramas enteros; con `Mayús`, sin imán. Un
  arrastre es una sola entrada de deshacer. Elegida, la barra se invierte
  (fondo de tinta); con un choque (dos del mismo tipo sobre el mismo
  objetivo a la vez), borde discontinuo y una marca en el árbol; si la
  mueve la pieza elegida en la escena, borde fuerte. Clic en el vacío de
  una pista quita la selección de animaciones.
- **Derecha, las propiedades** (*cómo*) de la animación elegida. Arriba
  la **cabecera** de una línea —*objetivo · tipo · cantidad ·
  inicio–fin*: «Tapón · Despiece esférico · 1,5 × tamaño · 0–3 s»— y la
  frase entera. Después, en secciones plegables:
  - **Movimiento**: los mandos del tipo (la cantidad con su unidad, el
    plano de una animación de cámara). En un **despiece**: *Qué se
    despieza* (el modelo o un grupo), **Tipo** (*Lineal · Radial ·
    Esférica*), en lineal **Cómo** (*Separar · Apilar*), en lineal y
    radial el **Eje** o la **Dirección** (*X · Y · Z · Propio*, con sus
    tres componentes), **Jerarquía** (*Piezas · Un nivel · Todos*),
    **Distancia** con su unidad (*× tamaño · mm*; cambiar de unidad
    conserva la longitud), **Reparto** (*Igual · Por distancia*; no en
    apilar), **Proporcional al tamaño de la pieza**, **Centro** (*Del
    conjunto · Una pieza · Pivote · Un punto*, con la pieza o el punto),
    **Orden** (*A la vez · Por distancia · Por profundidad*) con su
    **Solape** en % y **Conservar la orientación**.
  - **Excepciones** (en un despiece): las piezas fijas, cada una con su
    × para soltarla, y **Fijar la selección** (las piezas elegidas en la
    escena); sin ninguna, *se mueven todas*.
  - **Tiempo**: *Inicio*, *Duración*, *Fin* (cambiarlo cambia la
    duración), *Repetir* (× n) e **Invertir** (en un despiece, *Invertir:
    montar*).
  - **Curva**: la **curva de tiempo** (`EASING_KINDS`) o, en un despiece,
    la **Suavidad** (0 % lineal, 50 % suave, 100 % muy suave), con una
    **vista previa** de la curva que sigue a cada cambio.
  - *Duplicar* y *Eliminar*.

  Con varias elegidas, cuántas y *Duplicar · Invertir · Eliminar*. Sin
  ninguna, qué hacer y los **presets** en su lista. **+ Animar…** abre
  aquí el **asistente** (tres pasos en línea: *¿Qué se mueve?* con el
  objetivo ya puesto; *¿Cómo?*, el tipo —*Despiece* solo para el modelo o
  un grupo con dos piezas o más—; *¿Cuánto y cuánto tiempo?*), y
  *Añadir* deja la animación nueva elegida.
- **Visor**: con una animación elegida se resalta su objetivo y se dibuja
  su pista en la tinta del tema, sobre todo lo demás: el **arco** de una
  órbita (un anillo alrededor del objetivo con el ángulo que barre y un
  punto donde está la cámara), el de una elevación, la **flecha** de un
  desplazamiento, un **vector por pieza** de un despiece (de donde está a
  donde llega, con un punto donde está en el cabezal), el **eje** y el
  giro de un *giro propio* o un *vuelco*; un tipo que no conoce, solo su
  objetivo resaltado. El cabezal mueve la previa.
- **Teclado**, con el foco en el cajón (un clic en el árbol o en las
  pistas lo pone ahí): `Espacio` reproduce o pausa, `Inicio` / `Fin`,
  `←` / `→` un fotograma (`Mayús`: diez), `Supr` borra las animaciones
  elegidas y `Ctrl/⌘ D` las duplica. En un campo, el campo se queda sus
  teclas.
- En el **menú contextual de una pieza** (árbol de la escena y visor):
  **Animar Tapón…** (el asistente con ella de objetivo) y **Fijar en el
  despiece** / **Soltar del despiece** (en los despieces que la
  contienen; desactivado si no hay ninguno).
- El vídeo se renderiza desde la **ventana de render** en modo
  *Animación* (§2.7), con los mismos botones *Render* y *+ Añadir a la
  cola* que una imagen.

**Cajón Físicas, la barra de físicas** (fase S2; `SPEC.md` §3.1 y §3.7):
**▶ Iniciar** (simula las piezas cuyo papel es *Dinámico*) · **⏸ Pausar**,
que pasa a **▶ Reanudar** mientras está en pausa · **■ Parar** · **↺
Reiniciar**; después, lo que el simulador dice —**tiempo simulado**
(*Simulado 0,42 s*) y **cuerpos despiertos** (*2 de 3 despiertos*)— y el
**estado**: *Parado* por defecto, *Arrancando…*, *En marcha*, *En pausa*,
y al acabar cómo acabó (*Se paró sola: todo está quieto*, *Parada donde
estaba*, *Parada tras 30 s simulados*, *El simulador necesita el motor*).
Nada corre hasta que se inicia o se deja caer algo. Antes de que el
simulador diga nada, ni tiempo ni cuerpos: no se inventan. Debajo, una
nota: cómo empezar, y mientras corre, que el visor la enseña en *Rápido*
(el modo *Completo* espera a que pare).

- **Pausar** congela la simulación donde el visor la enseña (lo que el
  simulador mande mientras tanto espera a *Reanudar*); **Parar** confirma
  la pose que se ve; dormirse todos los cuerpos, o 30 s simulados, la
  paran y confirman el último fotograma.
- **Toda simulación se graba**: al empezar, cada cuerpo tiene un clip
  **Simulación** en la línea de tiempo (cajón *Animación*) que crece
  fotograma a fotograma a los fps del proyecto mientras corre, con el
  cabezal detrás; se queda donde se para. En la línea de tiempo (N6) su
  fila del árbol dice *cae según la simulación · 0,83 s*; la barra se
  mueve en el tiempo y se estira para ralentizarla, y sus propiedades son
  las de tiempo (inicio, duración, fin, repetir, invertir) y una nota:
  ni cantidad ni curva. *Animar…* no lo ofrece y no se parte: solo lo
  crea una simulación. No hay botón de grabar.
- **Reiniciar** quita los clips de la última simulación y devuelve las
  piezas a donde estaban, como otra entrada de deshacer (*Deshacer:
  Reiniciar la simulación*); está activo mientras esos clips sigan en el
  proyecto. Deshacer mientras corre la abandona sin confirmar nada.
- Una simulación nueva mientras otra corre para la primera (que confirma
  su pose) y arranca desde ahí.

Capturas (`tools/physics-check.mjs`): `docs/ui/physics-bar.png` (la barra
en pausa, en mitad de una caída), `docs/ui/physics-drop.png` (tres
primitivas antes y después de *Dejar caer*) y
`docs/ui/physics-drop-strip.png` (seis instantes del clip grabado).

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

**Vista en vivo** (U14, petición del usuario: «al irme a queue quiero poder
ver un preview en tiempo real de un render seleccionado»). Clic (o `⏎`) en la
fila de un trabajo que **se renderiza** abre su imagen **mientras se hace**: el
visor de resultados en modo *en curso* (§2.8), sobre el visor, con el cajón
abierto debajo; la fila elegida se marca (fondo de pasar el ratón y una barra
de tinta a la izquierda) y su texto emergente dice *Ver cómo se renderiza*.
Clic en uno **en espera** abre lo mismo con una línea en lugar de la imagen:
*Este trabajo aún no ha empezado: su imagen aparecerá aquí en cuanto se
renderice*; cuando la cola llega a él, la imagen aparece sola. Un **terminado**
sigue abriendo su resultado, y un trabajo que acaba con la vista en vivo
abierta sobre él **pasa a ser su resultado** en el visor (como *Mostrar al
terminar*). Uno detenido o que falló lo dice (*Este trabajo se detuvo antes de
terminar*, *El render falló: <motivo>*); uno que se quita de la cola se lleva
su vista. Se ve como mucho **una imagen nueva cada medio segundo** (en el
escritorio, una por pasada del lanzador: más espaciadas en un render grande), y
solo mientras la vista está abierta sobre ese trabajo y la pestaña se ve:
cerrarla (*Cerrar*, `Esc`) o elegir otro trabajo hace que el motor deje de
hacerlas.
Captura (`tools/queue-live-check.mjs`): `docs/ui/queue-live.png` y
`docs/ui/queue-live-dark.png`.

### 2.6 · Barra de estado

24 px, texto auxiliar: a la izquierda el **Doctor** (un punto relleno y
"2 avisos", o un punto hueco y "Todo en orden"); clic abre su popover.
Luego: piezas · triángulos · motor y dispositivo · muestras y tiempo del
visor y, en *Rápido* con algún efecto de *Ambiente* (S4a), *Partículas N
de M* (las que dibuja de las que el motor evalúa) o, sin `rt.wasm`,
*Partículas: solo las regiones (el motor no está compilado)*. A la
derecha: idioma y versión.

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
el modelo de datos. Una comprobación nuestra, la última de la lista
(U13), es **Proporción de la animación**: avisa de los planos cuya cámara
tiene otra proporción que el tamaño de salida (*Planos con otra
proporción que la animación (1920 × 1080): 1. El primero usa Cámara 2
(4:3).*) y su arreglo pone a las cámaras de esos planos la proporción del
tamaño de salida.

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

  **La proporción es de la cámara** (U13). En una imagen, el tamaño sigue a
  la proporción de la **cámara activa**: el ancho se conserva y el alto sale
  de ella (con 4:3, 1920 de ancho dan 1440 de alto). Con el candado
  cerrado, teclear un lado hace que el otro siga esa proporción; con el
  candado abierto, un tamaño que la rompe la **reescribe en la cámara**
  (*Propia*, con esos píxeles como `w : h`, o el preset de la lista si el
  tamaño es exactamente uno), y teclear los dos lados a la vez, o elegir un
  preset de tamaño con otra proporción, hace lo mismo con el candado que
  sea. Una línea discreta bajo los píxeles dice cuál manda (*El alto sigue
  la proporción de Cámara 1, 4:3*; con el candado abierto, *Un tamaño
  tecleado pasa a ser la proporción de Cámara 1*) y, justo después de
  cambiarla, qué ha pasado (*La proporción de Cámara 1 pasa a 4:3*). Todo
  es una sola entrada de deshacer, la de la ventana (*Ajustes de render*),
  que devuelve cámara y tamaño. Un trabajo para otra cámara con otra
  proporción (*Cámara: una concreta*, o *Todas las cámaras*) sale con el
  ancho de la ventana y el alto de **esa** cámara. Al editar un trabajo
  de la cola la ventana enseña su tamaño tal cual y no toca ninguna
  cámara.
- **Región** (*próximamente*): un recuadro dibujado en el visor.

**2 · Calidad**

- **Terminar por**: segmento **Muestras · Tiempo · Ruido**. *Muestras*: campo con
  atajos *Borrador 64 · Previa 256 · Final 1024* y valor libre. *Tiempo*:
  campo `hh:mm:ss`. En *Avanzado*, la opción *Lo que llegue antes* con
  los dos campos. **Ruido** (E10): el campo *Ruido* (0,5–5 %, por defecto
  1 %, en décimas: *1,5 %*), con la nota *Cada píxel termina por debajo de este ruido
  (el error relativo de su media): las muestras van a las partes ruidosas,
  nunca más que Muestras*, y el campo de *Muestras* debajo, a la vista, como tope; el
  motor muestrea adaptativamente (`RNDR.adaptive`, `RNDR.noise_threshold`) y
  el render acaba cuando ningún bloque de 8 × 8 pasa del umbral (o todos llegan
  al tope). El visor *Completo* que sigue las muestras de la salida muestrea
  igual (y vuelve a empezar al cambiar el umbral).
- **Estimación** en auxiliar, a partir de las muestras por segundo que
  mide el motor en el visor (*≈ 4 min en este equipo*); si el motor no
  ha medido todavía, dice *Estimación al cabo de unos segundos en modo
  Completo*. Nunca un número inventado. Por *Ruido* (E10) el tiempo sale de
  la **última pasada del visor *Completo*** que muestrea al mismo umbral: lo que
  lleva más lo que el motor espera que le falte (el trabajo que la última
  decisión dice que queda, al ritmo de la última pasada), escalado a los
  píxeles de la salida (*≈ 3 min hasta 1 % en este equipo, según la última
  pasada del visor Completo*); sin eso, *El tiempo sale de las pasadas: en modo
  Completo, o mientras se renderiza*. Mientras corre el render, el progreso de
  la cola es la parte del tiempo que el motor dice que lleva.
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
  albedo, normales, profundidad y pieza, que nunca mezcla dos piezas; su
  parte *Visor* es el interruptor *Reducir ruido* de la barra superior y
  del medidor, U11, y el render final usa siempre el filtro completo),
  con su **Intensidad** debajo (fase U11b; 0–100 %, por defecto 100 %, oculta
  con la reducción *Apagada*): la imagen entregada es la mezcla
  `ruidosa × (1 − s) + filtrada × s`, por canal y en luz lineal, hecha en el
  motor; vale a la vez para el render y para el visor *Completo* (un solo
  mando, guardado en el proyecto y deshacible), y con 0 % no se filtra nada.
  Cambiarla vuelve a empezar la imagen del visor, como cualquier ajuste del
  motor. Y,
  cuando el render se filtra, **Guardar también sin reducción de ruido**
  (un segundo archivo con «-noisy» en el nombre).

**2 bis · Animación** (en lugar de *Tamaño*, con una fila *Tamaño del
fotograma* solo en píxeles, y encima de *Calidad*, cuando
el segmento está en *Animación*; el tamaño de una animación es **suyo**:
no sigue a la cámara, un vídeo tiene un solo tamaño, y al volver a
*Imagen* el ancho se conserva y el alto sale de la cámara activa. El
Doctor avisa —*Proporción de la animación*— cuando la cámara de un plano
tiene otra proporción que ese tamaño, y su arreglo da a esas cámaras la
proporción de la salida): **rango** (*Todo* o de–a en
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

**4 · Plugins** (P6; `ui/panels/plugins.ts`), después de *Post-procesado IA*:
un bloque por cada plugin instalado con el *slot* `render.plugins`, dibujado
**solo desde su manifiesto** (ARCHITECTURE §9): la interfaz no conoce ningún
plugin. Plegada al principio mientras no hay ninguno instalado; sin plugins,
una línea: *No hay ningún plugin instalado: los plugins se instalan en Ajustes ▸
Plugins* y **Gestionar plugins…**, que abre esa sección. En un trabajo de la
cola que se edita, la sección no se muestra (no hay un resultado sobre el que
trabajar).

- **Cabecera**: el logo del plugin (de su paquete, sobre una tesela negra en los
  dos temas: es contenido, el color es suyo), el nombre, *versión 0.1.0*, la
  ficha **Licencia cerrada** y, debajo, su línea `notice` con **Página del
  proyecto ↗**. Para el de película: *Adelanto de una app de edición de fotos y
  simulación de película del mismo desarrollador, en desarrollo*.
- **Receta**, debajo de la cabecera y a todo lo ancho (decisión 8;
  `ui/panels/plugin-recipes.ts`): un **carrusel horizontal**, como la tira de
  película de la app móvil, con una tarjeta por receta en el orden y por las
  categorías **del plugin**: la imagen arriba, **su nombre público** debajo (el
  de película no enseña marcas de fabricantes ni de películas: su regla D112)
  y la categoría como etiqueta pequeña; la primera tarjeta es *Sin receta ·
  Solo los mandos* (el punto de partida del propio plugin). Se desplaza de lado
  con la rueda o el *trackpad* (una tarjeta por paso; en un extremo la rueda
  vuelve a ser de la ventana) y con **← →** (también ↑ ↓, Inicio y Fin), que
  eligen la tarjeta de al lado; un clic elige una. La elegida lleva un
  contorno de la tinta; el carrusel se ajusta a las tarjetas y se funde en el
  extremo donde hay más. Cada elección es una acción del *store*, deshacible.
  La imagen de cada tarjeta es **la imagen base del plugin** (la escena de
  prueba que trae su paquete: para el de película, el frasco junto a la
  lámpara encendida de `rt --write-film-thumb`) por esa receta con los mandos
  por defecto, a 160 × 100 y ampliada por CSS; mientras no llega, un hueco
  rayado gris (*Se está haciendo su imagen*). Se hacen **una vez** en este
  equipo (IndexedDB, por versión del plugin y receta), de una en una y solo
  cuando no hay una vista previa esperando; mientras, *Imágenes de las recetas
  12 de 128, hechas una vez en este equipo*. **Encima del carrusel, sus
  filtros** (P6b), los del plugin, como los de la búsqueda de películas de la
  app de aintfilm: una fila de *chips* por filtro, con su nombre, **Todos** y
  sus valores (para el de película: **Tipo** —*Color* (negativo en color),
  *B&W*, *Diapositiva*, *Cine*—, **ISO** en las tres bandas de la app —*≤ 100*,
  *200–400*, *≥ 800*, cortadas en 100 y 400— y **Grupo** —*Películas*, *Color de
  una película*, *Grano*, *Difusión*, *Objetivo*—; la fila de marcas de la app no
  está: son nombres de fabricantes). Un filtro elige un valor (o *Todos*); los
  filtros se combinan (todos a la vez) y una receta que no dice nada de uno (un
  grano no tiene ISO) solo está en su *Todos*. Debajo, la cuenta: *23 de 127
  recetas* (*Ninguna de las 127 recetas coincide con estos filtros*). La receta
  elegida sigue elegida aunque los filtros la dejen fuera: su tarjeta va
  **primera**, atenuada, con *Fuera de los filtros* en lugar de su categoría;
  *Sin receta* va siempre. Cada filtro es una acción del *store*, deshacible, y
  se guarda con los ajustes del plugin (`filters`); cambiarlo no rehace la
  vista previa. **Debajo del carrusel, un deslizador** fino de su mismo ancho
  para recorrer las recetas, atado al desplazamiento en los dos sentidos:
  arrastrarlo desplaza el carrusel tarjeta a tarjeta (al soltarlo se ajusta a
  la tarjeta) y desplazar el carrusel lo mueve; una marca en su pista dice
  dónde está la tarjeta elegida; se enfoca con el teclado y ← → mueven una
  tarjeta (*Recorrer las recetas*); sin nada que desplazar, no se ve. Debajo,
  la elegida con su categoría (*CN-01 · Películas · negativo en color*). A la
  izquierda, **los mandos del manifiesto** por grupos, cada grupo con
  su título: deslizador con su campo numérico (y su unidad; un deslizador con
  `minLabel` dice *Receta* en su tope izquierdo: ahí el plugin conserva el
  valor de la receta), lista o interruptor, cada uno con su frase cuando la
  trae. **Restaurar valores por defecto** al final. Cada cambio es una acción
  del *store* (`RenderSettings.plugins`), deshacible; arrastrar es **un**
  paso; se guarda con el proyecto.
- **Vista previa**, a la derecha (debajo en una ventana estrecha): **el
  resultado actual** —el abierto en el visor de resultados, si no el último; el
  de un resultado hecho por un plugin es su origen— a **480 px** de ancho por el
  plugin en su *worker*, con el divisor *Render · el plugin* de U5. Se rehace
  **300 ms** después del último cambio (al soltar, en un deslizador) y la que
  está en curso se cancela con la siguiente. Debajo: el tamaño, qué recibió
  el plugin (*luz lineal del EXR* o *imagen de 8 bits*) y de qué resultado;
  **la línea del plugin**: lo que el propio plugin dice de esa vista previa
  (para el de película: *Negativo por píxel 75 µm · Grano Gaussian · Etapas 5 ·
  Motor wasm 0.1.0*), nada que la interfaz calcule ni invente; y *El plugin
  tardó 1,1 s*, medido alrededor de su render. Sin resultados, **la imagen base
  del plugin** por él (*Escena de prueba · el plugin*; *de la escena de prueba
  del plugin*) con la línea *Aún no hay resultado: la vista previa enseña la
  escena de prueba del plugin; Aplicar necesita un render terminado*; un plugin
  sin imagen base dice *Renderiza antes una imagen: un plugin trabaja sobre un
  resultado terminado*.
- **Aplicar**: el resultado a su tamaño por el plugin (*Aplicando a 1920 ×
  1080…*, con **Cancelar**, que para el *worker*) y **un resultado nuevo** en el
  historial junto a su origen, como la imagen de la IA: PNG (JPEG para un
  resultado JPEG) con los ppp del origen, guardado donde se guardó el origen,
  con el nombre *<origen>_<plugin>.png* y su procedencia (`provenance: { plugin,
  version, recipe, controls }`). Se abre en el visor comparado con su origen,
  que dice *Hecho con aintfilm · simulación de película 0.1.0, receta CN-01, a
  partir de Botella_Cámara 1_0001.png*; un plugin con semilla guarda además
  `seed: { control, seed0, frame, rule: 'seed0+frame' }`.
- **Aplicar a los trabajos de render** (interruptor, decisión 9), debajo de
  *Aplicar*: con él, **cada imagen que renderiza la cola** pasa también por el
  plugin, con la receta y los mandos de ese trabajo, y se guarda junto a la del
  motor (*<nombre>_<plugin>.png*); en una animación, **cada fotograma con su
  semilla**, `semilla + fotograma` (el índice del fotograma en la animación, 0
  para el primero: un tramo renderizado aparte lleva el mismo grano), para que
  el grano sea el de una película fotograma a fotograma y no una capa fija; una
  imagen fija usa la semilla tal cual. La primera imagen del trabajo se guarda
  también en el historial con su procedencia. Si el plugin no está instalado o
  falla, se dice una vez (*aintfilm · simulación de película no se aplicó a
  …: …. Se guardó la imagen del motor.*) y el render queda como estaba.
  Deshacible y guardado con el proyecto como el resto. Captura:
  `docs/ui/render-plugins-film.png` (el paquete de película construido desde el
  *checkout* de aintfilm, con el logo del dueño).

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
mosaico 2 de 4 · intento 1 de 4*, *IA · comprobando · intento 1 de 4*— y la barra
mide la tubería, no ya el render (B1: la guarda repite como mucho `MAX_ATTEMPTS`
= 4 veces, y cada intento tiene su cuarto de la barra, así que la barra no se
acerca al final a cada reintento; tras un reintento, una segunda línea
en la fila, *El intento 1 no pasó: <motivo de la guarda>*; el estado y el motivo
enteros, en el texto emergente de la fila). *Detener* o *Pausar* en ese momento paran la
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

**En curso (U14).** El mismo sitio enseña un trabajo de la cola **mientras se
renderiza** (§2.5, *Vista en vivo*): la cabecera con la ficha **En vivo**, el
nombre del archivo que saldrá, una línea de datos con lo que dice el motor
(*1280 × 720 · 15 de 96 muestras · 0:14 · Cámara 1*; con *Terminar por
tiempo*, *15 muestras · 0:14 de 1:00*; con *Terminar por ruido* (E10),
*adaptativo · 16–212 muestras · ruido 2,4 % de 1 % · 0:14 · quedan ≈ 40 s*,
los números del motor; antes de la primera imagen, solo el
tamaño y la cámara), a la derecha el estado de la fila con su progreso
(*Renderizando · 19 %*, *Fotograma 3 de 48*, *IA · mosaico 2 de 4 · intento 1
de 4*) y su barra, una nota (*Su imagen a medida que el motor suma muestras; el
resultado se abre aquí al terminar*) y *Cerrar* (`Esc`). Debajo, la imagen a la
proporción del render, todo lo grande que quepa, sobre el damero neutro donde
el render es transparente. La imagen es la del motor reducida por un factor
entero a lo que cabe (como mucho 960 × 600 píxeles de pantalla; en cajas de más de 2 × 2 píxeles, la media de cuatro de ellos) y se amplía
suavemente: es para ver cómo llega, no para juzgar sus píxeles (eso, el visor de
resultados al terminar, con zoom). En la web, la acumulación del *pool* tal
como va, cada baldosa con sus muestras (en la primera pasada aparecen baldosa a
baldosa; los números son las muestras que ya tienen todos los píxeles); en el
escritorio, la pasada que el lanzador acaba de publicar, reducida en el
lanzador (`fit=`). Sin zoom ni comparación: llegan con el resultado.

### 2.9 · Ventana de Ajustes

Se abre con **Ajustes…** del menú de aplicación o `Ctrl/⌘ ,`. Es una de
las tres ventanas de la aplicación (§4.3): flotante, unos
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
| **Render** | **Motor de renderizado** | Motor (*Nativo, todos los hilos* en escritorio · *Navegador, WebAssembly*); hilos (*Automático* o un número; en el navegador, *workers*); SIMD (Automático · Desactivado); límite del visor en Completo (parar a las N muestras o a los N segundos, para no gastar batería); **mientras se renderiza** (*Mantener el visor vivo (compartido)*, por defecto: el render usa tres cuartos del motor y el visor sigue con el resto · *Pausar el visor (render más rápido)*); **partículas por efecto** (S4a: el tope de cada efecto de *Ambiente*; *Automático* = 100 000 en el navegador, 1 000 000 en nativo); **Suavizado de bordes** (E11, abajo); **Medir rendimiento** (renderiza la escena de ejemplo 10 s y muestra las muestras por segundo medidas, con hilos y SIMD; nunca un número inventado); datos del motor (versión, compilación, CPU, extensiones SIMD, hilos) |
| | **Post-procesado IA** | Tres apartados, en este orden: **Modelo activo**, **Modelos** y **Equipo** (detalle abajo); en escritorio, cuatro: **Motor de ejecución** entre *Modelos* y *Equipo*. Donde la tubería no existe (la web, hasta X3d; lo dice el servicio, `NOT_BUILT`), arriba una línea en auxiliar: *El post-procesado llega en una próxima versión; ya puedes descargar, importar y preparar modelos* |
| **Sistema** | **Plugins** | Los plugins del registro (`src/data/plugins.json`) y los instalados desde un archivo, cada uno con su logo, nombre, editor, versión, tamaño, resumen, la ficha **Licencia cerrada** y **Página del proyecto**; *Instalar*, *Actualizar a X*, *Quitar*; la clave de activación pedida en su fila; **Instalar desde archivo…** (detalle abajo) |
| | **Almacenamiento** | Espacio usado por categoría (modelos, historial de resultados, biblioteca, caché) con barra y *Liberar* por fila; límite del historial (número y tamaño); pedir almacenamiento persistente al navegador; en escritorio, la carpeta de datos con *Abrir carpeta* |
| | **Escritorio** | Solo en la aplicación de escritorio: modo portable (sí o no y dónde están los datos), navegador que dibuja la ventana, carpeta de registros |
| | **Actualizaciones** | Encima de *Acerca de*, en web y escritorio: versión instalada; **Buscar actualizaciones** con el resultado en su fila (*Tienes la última versión* · *Repackshot X está disponible* con el botón principal y **Notas** · *No se pudo comprobar* con el motivo real); **Buscar al iniciar** (activado por defecto): al arrancar comprueba una vez en segundo plano y, si hay versión nueva, lo dice en una línea de la barra de estado con el mismo botón principal, *Notas* y *Más tarde*, nunca en una ventana; *Última comprobación*. La fuente son las releases de GitHub (`src/data/update-feed.ts`). **El botón principal** es **Instalar y reiniciar** en escritorio (P5): pregunta por los cambios sin guardar (§4.3), el lanzador descarga el paquete de esta copia y su `SHA256SUMS.txt`, comprueba la suma, lo instala y la aplicación se reinicia sola con la versión nueva (detalle en `ARCHITECTURE.md` §5.5). En la web sigue siendo **Descargar** (abre la página de la versión) y la fila lo dice: *Descargar abre la página de la versión. Para actualizar desde la propia aplicación, usa la versión de escritorio.* También es *Descargar* donde el lanzador no sabe actualizarse (uno anterior) o la release no trae el paquete o las sumas. **Mientras se instala**, la fila (y la línea de la barra de estado, con *Ajustes* cerrado) dice dónde va: *Descargando… 45 % · 3,2 de 7,1 MB* con una barra fina (gris, sin color), *Comprobando…*, *Instalando… la aplicación se reiniciará*, con **Cancelar la actualización** hasta que empieza a cambiar archivos; cerrar *Ajustes* no la para (el estado es del lanzador y se sigue al recargar la página). **Los fallos** salen en la fila con su motivo y **Reintentar**: la descarga, la suma que no cuadra (*no se instaló*), sin espacio en el disco, el paquete que no se pudo desempaquetar o poner en su sitio (*no se cambió nada*) y *esta copia no está instalada ni es portable* (entonces el botón es *Descargar*). Al volver a arrancar, un aviso dice *Repackshot se actualizó a la versión X* |
| | **Acerca de** | Versión, licencia (PolyForm Noncommercial 1.0.0, resumen y texto completo), **licencias de terceros** con su texto (three.js, rhino3dm, occt-import-js con el enlace a su código fuente, stable-diffusion.cpp y ggml —MIT, el motor de ejecución de la IA de escritorio, X3c—, y los modelos de IA descargados con la suya), créditos (EZ Packshot) |

**Columna derecha**: título de la sección, una frase de qué se ajusta
ahí y las filas en bloques con un subtítulo y una línea fina entre
bloques. Cada fila: nombre, una línea auxiliar si hace falta, y el
control a la derecha (segmento, interruptor, campo numérico de §4.4,
desplegable). Una fila con un valor distinto del de fábrica lleva un
punto y, al pasar, *Restablecer* en línea; al pie de cada sección,
*Restablecer esta sección*. Lo que no existe todavía se ve,
deshabilitado, con *próximamente*.

**Motor de renderizado ▸ Suavizado de bordes** (fase E11). Dos listas,
cada una ordenada de menos a más coste, sin cifras de coste (el orden y
una frase de ayuda; regla 10). Son ajustes de la aplicación, no del
proyecto: no se deshacen ni viajan en el `.repack`; en escritorio
se guardan con los demás en `settings.json` del lanzador.

- **Modo Rápido**: segmento *Ninguno · MSAA 2× · MSAA 4× · MSAA 8×*, por
  defecto 4×. La línea auxiliar dice lo que da el dispositivo: *Este
  dispositivo llega a N×; dibuja ahora: M×* (o que no tiene
  multimuestreo); una opción por encima de su máximo dibuja con el máximo
  (lo dice su *tooltip*). Cambia al momento, sin volver a empezar nada.
- **Completo y render**: una lista vertical numerada, una opción por
  fila con su nombre y su frase: **1 Ninguno** (todas las muestras por el
  centro del píxel: bordes dentados, el más barato), **2 Estándar** (una
  caja de un píxel: lo que renderiza un RSB que no dice filtro), **3 Suave**
  (tienda de dos píxeles), **4 Fino** (Blackman–Harris de tres píxeles,
  el habitual de producción; **por defecto**: cuesta los mismos rayos que
  *Estándar*), **5 Fino + bordes ×2** (el doble de muestras donde cambian
  la pieza, el material o la profundidad), **6 Fino + bordes ×4**. Vale
  para el visor *Completo* y para todos los renders desde ese momento;
  cambiarla vuelve a empezar la imagen del visor. Los fotogramas de gesto
  (resolución reducida) usan el filtro pero no las muestras extra de
  borde. Las flechas recorren la lista.

En *Completo*, la línea del medidor que dice lo que el motor hace de la
imagen añade **Filtro · Estándar** (o el que sea) cuando no es el de
fábrica, *Fino*; en *Rápido*, **MSAA 2×** o **Sin multimuestreo** cuando
no dibuja con 4×.

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
ni va en el `.repack`), en un campo de varias líneas con el predeterminado del
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

**Plugins** (P6, `ui/panels/settings-plugins.ts`): arriba, dónde se guardan
(*Los plugins instalados se guardan en este equipo, sus paquetes cifrados y sus
claves aparte*, o que solo duran esta sesión donde no hay almacenamiento
duradero). Después, **Plugins disponibles**: una fila por plugin del registro
(y por cada uno instalado desde un archivo, con la ficha *Desde un archivo*):
el logo (el de su paquete, en cuanto está instalado: antes, un icono neutro),
el nombre con la ficha **Licencia cerrada**, *Editor · versión 0.1.0 · 1,8 MB*
(el tamaño que fija el registro), el resumen, **Página del proyecto ↗**, el
estado (*No instalado* · *Descargando 42 % · 0,7 MB de 1,8 MB* · *Comprobando
el paquete…* · *Esperando la clave de activación* · *Instalado: versión
0.1.0, 1,8 MB en este equipo* · *No instalado: la descarga no es el paquete que
fija el registro (su SHA-256 no coincide)*…) y la frase, en todos: *El código de
este plugin es cerrado; la licencia de Repackshot no lo cubre*. Instalado,
debajo, **su licencia completa** y **los avisos de terceros** de lo que lleva,
en desplegables que se leen del paquete (descifrado en memoria) al abrirlos. A
la derecha **Instalar**, **Actualizar a X** (cuando el registro trae otra
versión) y **Quitar** (pregunta: *Su paquete y su clave de activación se borran
de este equipo; los proyectos conservan sus ajustes*). Instalar descarga,
comprueba el tamaño y el `sha256` del registro y la cabecera del paquete, y
pide la clave: de `keyUrl` si el registro la trae; si no (o si falla), un
recuadro en la fila con *Este plugin se activa con una clave de su
desarrollador. Escríbela o pégala para terminar la instalación*, el campo
(*Pega la clave de activación*), **Activar** y *Cancelar*; una clave que no
abre el paquete y algo que no es una clave se dicen distinto. Una
actualización prueba primero la clave que ya tiene.

**Plugins ▸ Instalar desde un archivo**: **Elegir un archivo .rpk…** (el nombre
y el tamaño del elegido al lado), el campo de la clave e **Instalar**; debajo,
el resultado (*Instalado: Invertir (plugin de prueba) 1.0.0* o el motivo). La
herramienta queda a la vista para los plugins que vengan. Captura:
`docs/ui/settings-plugins.png`.

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

### 2.10 · Editor de material (fase M3a)

Se abre con **Nodos…** del inspector del material, con *Material ▸ Editar
con nodos…* del menú contextual de una pieza o con la paleta, sobre el
material de la selección (si la selección no tiene un solo material lo
dice un aviso). Un material en modo *Simple* pasa antes a *Nodos* (su
grafo mínimo: la salida sola, una entrada de deshacer). Es una ventana
flotante como la de render, de unos **1040 × 660 px** y centrada la
primera vez, pero **sin atenuar** lo de detrás: el visor sigue pintando lo
que hace el grafo. Se mueve por su barra de título, se agranda por su
esquina inferior derecha (mínimo 560 × 360) y recuerda dónde estaba y su
tamaño entre sesiones; un doble clic en la barra la vuelve a centrar.
`Esc` (sin nada seleccionado) o la × la cierran. Acromática como todo el
cromo: el color solo está en las esferas de los nodos, la del material,
los colores de los valores y la barra de las rampas, que son contenido.
![editor de material](material-nodes.png)

**Barra de título**: *Editor de material*, el nombre del material,
**Simple · Nodos** (como en el inspector, con la misma pregunta al volver
a Simple), **Ejemplos ▾** (los diez grafos de ejemplo, con su descripción
en el *tooltip*; uno sustituye el grafo, una entrada de deshacer),
**+ Añadir nodo** (`⇧ A`), **Encuadrar** (`F`) y la ×.

**Lienzo** (izquierda): un plano de puntos que se acerca con la rueda
(alrededor del cursor, 25 %–200 %, el porcentaje abajo a la derecha) y se
desplaza con el botón central, o con `Espacio` o `Alt` y el izquierdo. La
primera vez se encuadra el grafo. Cada **nodo** es una tarjeta: su nombre
arriba (la *Salida de material* en negativo; *Matemática* y *Mezcla* con
la operación: *Matemática · Seno*), su **esfera** de 64 × 64 (lo que da su
primera salida sobre una esfera de 100 mm vista de frente: un número en
gris, un color en sRGB, un vector por la parte fraccionaria de cada
coordenada, una normal como ½ + n/2; la de la salida, el material
sombreado), y una fila por toma: primero las salidas, a la derecha, y
luego las entradas que sus parámetros muestran, a la izquierda, con su
valor si no están conectadas (un número o una muestra del color). Las
**tomas** tienen una forma por tipo: **círculo** número, **rombo** color,
**cuadrado** vector, **triángulo** normal; huecas sin conexión, llenas
con ella. Las esferas las calcula un *worker* con el mismo intérprete que
la vista previa *Rápido*; mientras llegan, el hueco queda gris.
- *Clic* en una tarjeta la selecciona (`⇧` o `Ctrl/⌘` suman o quitan);
  arrastrarla la mueve con el resto de la selección (una entrada de
  deshacer por arrastre). Arrastrar en el vacío selecciona lo que toca el
  recuadro.
- **Conectar**: arrastrar de una salida a una entrada, o de una entrada
  libre a una salida. Mientras se arrastra, la toma bajo el cursor se
  marca si la acepta y se apaga si no; soltar en una que no la acepta no
  conecta y un aviso dice por qué (*Un color no puede entrar en una
  entrada de normal*, *Esa conexión cerraría un bucle*). Una entrada
  conectada se coge con el ratón y su conexión se suelta en otra entrada
  (se mueve, una entrada de deshacer) o en el vacío (se desconecta). Una
  conexión nueva a una entrada ya conectada sustituye la anterior.
- *Doble clic* o *clic derecho* en el vacío abre **Añadir nodo** en ese
  punto: un campo de búsqueda (por nombre, descripción y palabras clave,
  en los dos idiomas: *perlin*, *ruido*, *altura*) sobre los nodos por
  categoría (*Entrada, Textura, Color, Vector, Matemática, Superficie*);
  flechas y `⏎` eligen. *Clic derecho* en una tarjeta: *Duplicar*,
  *Desconectar las entradas*, *Eliminar* (la salida no se duplica ni se
  elimina).

**Panel** (derecha, 280 px): el material en una esfera de 128 px; **En
Rápido**, las líneas que dicen cómo lo dibuja la vista previa (*Dibujado
con mapas de 512 × 512 hechos en las UV de la malla* / *por su proyección
cilíndrica: lo que da el grafo* / *Lee coordenadas 3D: …un corte por el
frente de la pieza…*) y qué aproxima (*Rápido funde las caras de la
proyección de caja; el motor toma la cara a la que más mira la normal*;
*Fresnel y de cara se toman a 60° de la normal*; *La curvatura se omite
(0): la mide el motor*; *Sin mapa para barniz: su valor medio*), y la de
*Completo* y *Render* (*el motor ejecuta el grafo en cada punto (sus
imágenes filtradas, Fresnel y de cara con la vista real, la curvatura en las
aristas vivas de la pieza); la dispersión interna no se lee. Un motor
anterior renderiza el valor medio de cada salida*, M3b). Debajo, el **nodo seleccionado**: su nombre y su
descripción, sus **parámetros** (desplegables, deslizadores y campos
numéricos con su unidad, interruptores, color; la imagen de una *Textura
de imagen* con *Cargar…* y *Quitar*, por el mismo camino y límites que las
ranuras de M2a; las paradas de una *Rampa de color* con su posición, su
color y su ×, *Añadir una parada* en el hueco mayor, y una barra que la
muestra) y sus **entradas**: las libres con su valor editable, las
conectadas con *Desde Nodo · toma* y una × que desconecta, las que leen
una fuente del punto con cuál (*La normal de la superficie*, *Las UV de la
malla*, *Las coordenadas de la pieza (por 100 mm)*); *Duplicar* y
*Eliminar*. Con varios nodos, *N nodos seleccionados* y los dos botones;
con ninguno, una nota de cómo se usa.
![el frasco con el mármol en Rápido](material-nodes-preview.png)

**Pie**: *N nodos · M conexiones · programa de K instrucciones, F + V
registros* (lo que dice el compilador), o por qué no compila (*El grafo
es demasiado grande: su programa pasa de 2048 instrucciones*); a la
derecha, los atajos.

**Teclado**, con el foco en el editor: `Supr`/`Retroceso` elimina la
selección, `Ctrl/⌘ D` la duplica, `Ctrl/⌘ A` lo selecciona todo, `⇧ A`
abre *Añadir nodo*, `F` o `Inicio` encuadran, `Esc` deselecciona y, sin
selección, cierra; `Ctrl/⌘ Z` y `Ctrl/⌘ ⇧ Z` son el deshacer y rehacer de
la aplicación. Las demás teclas sueltas no llegan a las herramientas del
visor mientras el foco está en el editor. Con el foco fuera, la aplicación
tiene las suyas: el editor no es modal. El recorrido guiado tiene un paso
para *Nodos…*.

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
| `Ctrl/⌘ ⇧ R` | Visor: *Rápido* o *Completo* |
| `D` | *Reducir ruido* del visor *Completo*, en directo (fase U11) |
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
menús, la paleta, el popover del Doctor y **tres ventanas**, abiertas solo
a petición: la **ventana de render** (§2.7), porque un render es una
decisión con muchos parámetros que se toma de una vez, como en KeyShot,
la ventana de **Ajustes** (§2.9: secciones agrupadas en una columna a
la izquierda, cambios al momento) y el **editor de material** (§2.10,
fase M3a: un grafo necesita un lienzo, y el visor sigue vivo detrás).
Ninguna otra ventana; nada se abre solo.

**La pregunta por los cambios sin guardar** (solo si el proyecto los
tiene) es la misma para todo lo que los descartaría —cerrar la ventana,
*Nuevo*, *Abrir* y *Instalar y reiniciar*— y tiene tres botones más
*Cancelar*: **Guardar** (donde está el proyecto, sin diálogo), **Guardar
como…** (con el diálogo) y **No guardar** (en la actualización, **Salir sin
guardar**). *Guardar* y *Guardar como…* siguen solo si el proyecto se
escribió de verdad: un diálogo cancelado o un archivo que no se puede
escribir se quedan donde estaban. `Esc` y *Cancelar* no hacen nada. Sale bajo el
nombre del proyecto (cerrar, nuevo, abrir), en la fila de *Ajustes ▸
Actualizaciones* o encima del botón de la barra de estado (actualizar), que
es donde se pulsó; en *Ajustes* `Esc` cancela la pregunta, no la ventana.
Si durante la descarga el proyecto cambió, al cerrar la ventana para
reiniciar se pregunta otra vez (bajo el nombre del proyecto, con la
misma pregunta); si no ha cambiado desde que se contestó, no.

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
- Catálogo de materiales con sus 86 presets y sus esferas (ver §6),
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
  suavizado, bisel, clipping de cámara, luces visibles, proporción de la
  animación); los de motor, en *no disponible aún*.
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

- **Montajes de luz** (L6): las 88 `thumb_<clave>.png` (256 × 256) y
  `setup_<clave>.png` (64 × 64, su promedio) de `public/thumbs/setups/`
  las renderiza nuestro motor (`node tools/setup-thumbs.mjs`): cada set
  sobre su héroe (`BOTTLE` el frasco de ejemplo de vidrio con líquido,
  `BOX` una caja con una banda de aluminio, `RING` un toro de oro,
  `CHROME` un toro cromado, `SHOE` una cápsula de cuero, `SPHERES` tres
  esferas mate, brillante y metal) y cada montaje anterior sobre el héroe
  de su estilo, con el tipo *Estándar*, la cámara de referencia (o la del
  set), 96 muestras, *denoise* y semilla fija. Sustituyen a las de EZ
  Packshot. `manifest.json` guarda el *hash* de cada escena y de cada PNG;
  la suite comprueba que el código sigue construyendo esas escenas.
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
3. Las 72 miniaturas de montaje y las 86 esferas de material se ven y se
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
motor; hechas las dos), vista en sección. Todo está en `ROADMAP.md` con su
fase y su responsable. En la interfaz, cada uno de esos huecos se marca
con la palabra *próximamente* en texto auxiliar, nunca con un control que
parezca funcionar y no haga nada.
