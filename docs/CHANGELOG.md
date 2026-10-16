# Registro de cambios

Cada versión lista lo que trae, agrupado por áreas. Entre paréntesis, la
fase del roadmap (`ROADMAP.md`) de donde sale cada línea.

## v0.1.9 — 2026-10-16

Versión de prueba con la vista en vivo del render seleccionado en la cola
(petición del reporte del 14-10). Lo de v0.1.2 a v0.1.8 sigue igual.

### Interfaz

- **Vista en vivo en la cola** (petición del usuario): clic en la fila del trabajo que se está renderizando abre su imagen mientras se hace, sobre el visor (el visor de resultados en modo *en curso*), con las muestras y los segundos que dice el motor, el estado y el progreso de la fila; la fila elegida se marca. Un trabajo en espera dice que aún no ha empezado y enseña su imagen en cuanto empieza; uno terminado sigue abriendo su resultado, y el que acaba con la vista abierta pasa a ser su resultado en el visor. Cerrarla (`Esc`) o elegir otro trabajo hace que el motor deje de hacer imágenes: solo se hacen mientras se mira, como mucho cada medio segundo (U14).

### Escritorio

- El lanzador manda la trama de un render **reducida** a un recuadro (`GET /api/render/<id>?fit=<an>x<al>`, bandera 512): la vista en vivo de la cola recibe solo los píxeles de su imagen y no las sumas enteras (U14).

### Limitaciones conocidas de esta versión

- En el escritorio la imagen en vivo cambia una vez por pasada del motor
  (1, 2, 4, 8, 16 muestras…), no cada medio segundo; en la web el número de
  muestras es el que ya tiene cada píxel (0 mientras la primera pasada llena
  los mosaicos). No hay zoom ni 100 % en la vista en curso, y la miniatura
  de la fila en marcha sigue siendo el icono.
- Siguen las de la v0.1.8.

## v0.1.8 — 2026-10-16

Versión de prueba con una sola novedad: la ventana con los elementos de una
lente al dejar el puntero sobre ella (petición del reporte del 14-10). Lo de
v0.1.2 a v0.1.7 sigue igual.

### Interfaz

- *Cámara* ▸ **Lente**: al dejar el puntero un momento sobre una lente de la lista, o al llegar a ella con el teclado, se abre a su lado una **ventana con sus elementos** (petición del usuario del 14-10): el corte de la lente (el mismo dibujo de la sección), su nombre, su fuente y los números que el motor da para ella con la focal, el diafragma, el foco y el encuadre de la cámara (focal, diafragma y T-stop, elementos y grupos, longitud, y la compresión del adaptador anamórfico). Sobre un chip de *carácter* abre la de las lentes de ese carácter. Mientras el motor contesta dice *Preguntando al motor…*; sin motor (la versión web sin `rt.wasm`) deja el nombre y la fuente y dice que el motor no está cargado, sin números inventados. Se cierra al sacar el puntero o el foco, con Esc y al elegir; no toma el foco ni el puntero. La lista *Lente* es ahora la de la interfaz (flechas, Intro y Esc) en vez de un `select` del navegador, que no dice a la página sobre qué entrada está el puntero; los chips de carácter ya no se rehacen al pulsarlos, así que el foco se queda en el que se pulsó (O2b).

### Limitaciones conocidas de esta versión

- La ventana se recorta en pantallas de menos de unos 550 px de alto cuando
  un carácter tiene cuatro lentes; no se ha probado contra el lanzador de
  escritorio (usa el mismo servicio que la sección *Lente*). La lista de
  lentes ya no es un desplegable del sistema: no busca al teclear.
- Siguen las de la v0.1.7.

## v0.1.7 — 2026-10-16

Versión de prueba con la madera, la tela y el bisel de aristas en el modo
*Completo* y en los renders, materiales rugosos que ya no pierden luz,
medios dispersores y dispersión cromática del vidrio, la lente trazada con
las 16 lentes del catálogo, filtros de efecto en la lente, las 88
miniaturas de montaje rehechas y los arreglos del reporte de errores del
14-10 (enfocar con clic, el color de una tela en nodos, la extensión
`.repack`, los intentos de la IA). Es la primera a la que se llega con
*Actualizar desde la aplicación*. Lo de v0.1.2 a v0.1.6 sigue igual.

### Interfaz

- *Cámara* ▸ **Filtros** (O3a): hasta tres filtros de efecto por cámara, cada uno con su tipo y una frase de lo que hace, su grado y, según el tipo, tinte, puntas y ángulo. El modo Rápido los dibuja como aproximación (y el medidor lo dice); el modo Completo y el render, con el motor.
- En el inspector de un vidrio, bajo *Paredes*: **Dispersión interna** (mm), **Color de dispersión** y **Dirección** (−0,9 a 0,9, hacia atrás / hacia delante), con su ayuda; el visor Rápido lo aproxima con un difuso translúcido y lo dice (E9b).
- **Nueve materiales nuevos** (92 en total con los de los sets de L6 y el cristal de E9c): HDPE blanco, PP natural y acrílico esmerilado entre los plásticos; cera, jabón de glicerina, leche, zumo de naranja, zumo de manzana y crema entre los otros. Los líquidos no se desgastan (E9b).
- **Número de Abbe** en el inspector del vidrio (0 a 100; 0, sin dispersión), con su ayuda; el visor Rápido lo aproxima con la dispersión de three.js. Material nuevo: **Cristal de perfumería** (Abbe 40) en *Vidrio* (E9c).
- Las 88 **miniaturas de montaje** están renderizadas de nuevo con el motor de esta versión (luz por punto de E12, energía de E9a, denoise de E11, el bisel de aristas de E6 en los héroes): se van los puntos sueltos de `STRIP_EDGE`, `BLACK_ON_BLACK` y `WARM_COOL_CINEMA`. El charco de **Fondo degradado con foco** (`GRADIENT_POOL`) sube de 0,70 a 0,85 para seguir siendo al menos el doble de brillante que el papel con los materiales corregidos (L6, E9).
- La madera gana *Escala*, *Contraste de anillos* y *Poros*; su *Densidad de anillos* cuenta anillos por 100 mm, y los presets llevan los de cada especie (roble 33: 3 mm). Sus campos dicen que los pinta el modo *Completo*; la vista *Rápida* muestra su color medio (E6).
- **Nudos** en la madera: *Nudos*, *Tamaño de los nudos*, *Variación de tamaño* y *Oscuridad de los nudos*, colocados con la *Semilla* del material; la vista *Rápida* ya enseña dónde caen. En el bambú, el MDF y el ébano están desactivados con una nota (E6).
- El campo *Bisel de aristas* del material ya no dice *próximamente*: lo dibujan el modo *Completo* y los renders; la vista *Rápida* sigue mostrando las aristas vivas, y la nota del campo lo dice (E6).
- La tela gana *Hilos por cm* (2–200, los de cada tela) y el tejido *Sarga 3/1 (vaquero)*; tejido, densidad y relieve los pinta el modo *Completo*, y la vista *Rápida* muestra el color medio del tejido (el vaquero, índigo: su cara es de urdimbre) (E6).
- *Cámara* ▸ **Lente** (O2): *Lente fina* o **lente trazada**, una de las 16 del catálogo elegida por carácter (*Clínica, Suave, Remolino, Vintage, Anamórfica, Macro, Gran angular, Tele*), con su fuente, su tratamiento, el objetivo detrás del adaptador anamórfico, el hueco de la lente blanda y las láminas; lo que calcula el motor para esa cámara (focal, tiraje, f/ y T-stop, elementos y grupos, longitud, pupila de entrada, distorsión y luz hacia la esquina) y el **corte de la lente** en SVG; en *Avanzado*, los ajustes marcados *no físico* (distorsión, viñeteo, carácter de la esférica, respiración, aberración cromática, remolino); **Guardar lente como…** a *Míos*. El modo Rápido dibuja su distorsión y su viñeteo como aproximación y el medidor lo dice.
- Los tipos de bokeh **Cometa de coma**, **Respiración de foco** y **Aberración esférica variable** ya se pueden elegir: ponen su lente trazada en la cámara, con su miniatura renderizada por el motor (O2).
- Con una lente trazada, **un clic cae en lo que está bajo el cursor**: enfocar con clic, seleccionar, el *gizmo*, los glifos de luces y cámaras y la selección por caja siguen la distorsión que dibuja el visor, y el contorno de la selección y el *gizmo* se dibujan con ella; al mirar a través de otra cámara o de una luz el visor ya no aplica la lente de la cámara activa (O2).
- **Enfocar con clic** ya no se deshace con el mismo clic: el visor terminaba el gesto de órbita al soltar el botón y devolvía el foco a la distancia de órbita (688 → 660 → 688 en el ejemplo, con la entrada de deshacer *Mover la cámara*). Ahora un clic que no mueve la vista no toca la cámara, y una órbita arrastra el foco solo si ya estaba en la distancia de órbita; vale también para *Mirar a través* de una cámara guardada. El clic mide desde la cámara que se ve, no desde la activa (B1).
- **Intentos de la IA contados** (la cola): la fila dice *IA · mosaico 2 de 4 · intento 2 de 4* (la guarda repite como mucho 4 veces por variante y no hay bucle sin fin), y tras un reintento una segunda línea con el motivo de la guarda (*El intento 1 no pasó: …*); la barra se reparte por intentos, un cuarto cada uno, en vez de acercarse al final a cada reintento. El registro del lanzador dice *attempt k of 4 failed*. En la ventana de render, la vista previa de la IA ya no se abandona y empieza de nuevo con cada instantánea del gestor de modelos (llegan cada 200 ms durante una descarga): solo cuando cambian los modelos instalados o la tienda empieza a responder (B1).
- Pasar una **tela a *Nodos*** conserva su color: el grafo mínimo promediaba los dos hilos a partes iguales, así que el vaquero volvía al gris azulado que E6 había corregido (y el raso y la microfibra se desviaban); ahora usa el color medio del tejido que leen el motor y la vista Rápida (B1).

### Motor

- **Filtros de efecto en la lente** (O3a): difusión blanca, negra y dorada, brillo, suavizado, red, estrella (4, 6 u 8 puntas) y rayas, como dispersión del rayo de cámara en la pupila: con la probabilidad del grado (1/8 a 2) el rayo se desvía según la PSF del filtro (tablas de CDF inversa), así que el halo lleva el bokeh y el enfoque y una luz fuera del encuadre vela la imagen; hasta tres apilados; el tinte (dorada, red, rayas) va al halo y a las rayas, no a la imagen; el grado alarga las rayas de la estrella sin ensancharlas, la red deja una cruz corta y tenue, y el brillo es una nube de destellos finos. Cada muestra de cámara se conecta además, a través de la PSF, con una luz que ve la cámara, pesada contra la dispersión (MIS): la misma imagen con varias veces menos ruido alrededor de las luces pequeñas (`rt --filter-noise` lo mide). Campos nuevos al final de `LENS`; sin filtros no cambia ni un bit (O3a).
- **Los materiales rugosos ya no pierden luz** (E9a): la luz que rebota varias veces entre las microfacetas del GGX vuelve (el lóbulo añadido de Kulla y Conty 2017 en el metal, el brillo del plástico y el barniz; el escalado de Turquin 2019 en el vidrio rugoso), con tablas integradas por nosotros. En un entorno blanco uniforme, un metal blanco de rugosidad 1 pasa de 0,356 a 0,999, el vidrio rugoso de 0,361 a 0,995 y el plástico blanco de 0,918 a 1,000 (0,860 a 0,998 con barniz). La capa difusa bajo el brillo recibe exactamente lo que el brillo no refleja (Kulla y Conty), también con rugosidad 0. Las imágenes ganan luz: el ejemplo un 15,6 % de luminancia media, la escena de E5 un 13,6 %, el cielo de E5c un 13,2 % (E9a).
- **Medios dispersores dentro de los sólidos** (E9b): un vidrio con *Dispersión interna* se llena de un medio que dispersa la luz dentro (plástico translúcido, cera, jabón, leche, zumo, crema), con un paseo aleatorio por el interior, su color y su dirección por canal, y la luz encontrada donde el paseo sale. Las escenas sin medios no cambian ni un bit. Los mismos bits en el escritorio y en el navegador (E9b).
- **Dispersión cromática del vidrio** (E9c): un vidrio macizo con *Número de Abbe* separa la luz en colores al refractar (cada longitud de onda con su índice, por la ley de Cauchy); un camino elige una longitud de onda al primer vidrio dispersivo y las cáusticas también se colorean. Las escenas sin él no cambian.
- **Madera procedural** (E6): las 13 maderas del catálogo dibujan sus anillos (diente de sierra, con el contraste de cada especie, que serpean y cambian de ancho), su fibra, sus poros (en anillo en el roble y el fresno, difusos en el nogal o finísimos en el arce; ninguno en el pino ni en el ébano) con su relieve, y la rugosidad estirada a lo largo de la veta; el bambú en tiras con sus haces y sus nodos, el MDF moteado y el ébano con vetas. Tamaños físicos: anillos de 2 a 5 mm según la especie, en cualquier pieza; la médula nunca cruza la pieza (una bola no enseña una diana). **Nudos**: ramas que cruzan la pieza desde la médula, con la fibra y los anillos rodeándolas, su testa más oscura, su bolsa de corteza y su grieta; el pino trae cuatro, el cerezo y el nogal uno. Ruido propio. Nueva sección `PATN` del RSB (E6).
- **Bisel de aristas en el sombreado** (E6): el radio *Bisel de aristas* de cada material redondea la normal cerca de las aristas vivas de la malla (más de 20° entre caras, y los bordes abiertos) como un redondeo de ese radio, en los reflejos y en las sombras; aristas cóncavas, esquinas y aristas curvas incluidas, también entre las mallas de una pieza con materiales por cara. Las aristas se buscan una vez por malla, con un BVH propio; el coste medido es de un +3 % en la botella de ejemplo con su bisel de 0,3 mm. Los mismos bits con cualquier número de hilos y en el navegador (E6).
- **Lente trazada** (O2): la cámara traza cada rayo por las superficies reales de una lente del catálogo (esferas, planos, asféricas, cilindros, espejos), escalada a la focal y enfocada como la lente (unidad, enfoque interno, elemento flotante, el adaptador anamórfico con su propio hueco), con la aberración cromática en tres bandas, los tratamientos como transmisión (T-stop y tinte) y lo que sale solo: distorsión, viñeteo, ojo de gato, burbuja o cremoso, coma, curvatura de campo, respiración. El motor dice lo que calcula de la lente (focal, escala de imagen, tiraje, f/, T-stop, distorsión, iluminación relativa, el corte) a la página y al lanzador (`/api/lens/info`). Los rayos de cámara cruzan la lente en lotes de ocho: la cámara trazada es el 13,7 % del render del ejemplo (0,25 µs por muestra, la lente fina 0,19 µs). Las escenas sin lente trazada no cambian ni un bit (O2).
- **Tela procedural** (E6): las 12 telas del catálogo (el carbono entre ellas) tejen sus hilos de urdimbre y de trama, redondos, que suben y bajan en cada cruce y enseñan la torsión de su hilo, en tafetán, sarga 2/2, sarga 3/1 (el vaquero), raso, lona, punto (uves que se solapan) y fieltro; el relieve inclina la normal y el brillo se estira a través del hilo de encima. Tamaños físicos: hilos por cm de cada tela (algodón 40, vaquero 24, raso 100, punto 4, carbono 5…), en cualquier pieza, con una proyección de caja sin costura. `PATN` de tipo 2 (E6).

### Proyecto

- El proyecto se guarda como **`.repack`** (petición del usuario): es el mismo JSON, con otro nombre. Los `.repack.json` de antes se siguen abriendo igual, desde el selector, el diálogo del escritorio o soltándolos en la ventana, y *Guardar* sobre uno abierto lo escribe donde está. El lanzador escribe `.repack` y recuerda cualquiera de los dos como último proyecto. Los instaladores no asocian la extensión con el programa (doble clic): queda para el empaquetado (B1).
- Los proyectos anteriores se abren igual y sus vidrios siguen sin medio; el registro `MATL` de la escena del motor pasa a 100 bytes (con el bisel de E6, el medio y el número de Abbe de E9c) y los archivos anteriores se leen como antes (E9).
- Una cámara guarda su lente trazada por su clave del catálogo y lo que se cambió (`optics.traced`); los proyectos anteriores no la tienen y se abren igual. La biblioteca propia gana **lentes** (O2).
- Los proyectos guardados se ven con las aristas redondeadas en *Completo* sin tocar nada: toda instancia de un preset ya traía un *Bisel de aristas* del 0,25 % del tamaño de la pieza (el arreglo del Doctor). Una madera o una tela guardadas conservan su `ringDensity` y su `threadCount`, que ahora se leen como anillos por 100 mm y hilos por cm (hasta 200). El bisel va en el byte 72 del registro `MATL` y los dibujos en la sección `PATN` nueva (E6).

### Limitaciones conocidas de esta versión

- Las **texturas**, las **etiquetas** y los **materiales de nodos** siguen
  viéndose solo en *Rápido*; *Completo* y el render usan la media de cada
  salida hasta que el motor las lea (M2b y M3b).
- Del reporte de errores del 14-10, esta versión arregla lo confirmado
  (B1) y trae la lente trazada (O2); el resto está clasificado en
  `TRIAGE.md` y espera sus fases (M2b, M3b, U14) o una decisión. El bucle
  de intentos de la IA y el *denoise* que lava colores no se han podido
  reproducir: hace falta el registro del lanzador y una escena.
- El veredicto fotográfico de la hoja de lentes de O2 (qué lente da qué
  bokeh, las prescripciones y los diafragmas supuestos, las constantes del
  adaptador anamórfico) está pendiente: los valores son los propuestos.
- Siguen las de las versiones anteriores, sobre todo que lo nuevo de
  escritorio **no se ha probado en un Windows real** y que la primera imagen
  real de la IA en una tarjeta gráfica sigue pendiente.
- La luz sale de un medio como de una superficie difusa (la aproximación de producción de Chiang, Kutz y Burley 2016): en una esfera de leche bajo un panel lateral queda un 3,3 % más brillante que el camino que refracta de verdad. No hay medios anidados (un líquido dentro de otro), un sólido con índice 1 no tiene medio, y con una dirección muy marcada (cerca de ±0,9) converge despacio (E9b).
- **Un líquido dentro de un frasco de vidrio** ve las luces a través de una pared fina y lisa (hasta 5 mm, caras casi paralelas) como si el vidrio no las desviara, una aproximación que en una losa de leche bajo una placa de 3 mm queda un 2 % por debajo del camino exacto; a través de un fondo grueso, de vidrio rugoso o con barniz, solo le llega la luz por los caminos que la encuentran al azar (con grano a pocas muestras) o, con *Cáusticas* encendidas, por fotones (E9b).
- La compensación de energía aproxima los lóbulos anisótropos con el ancho isótropo equivalente y no toca las paredes finas (E9a).
- La dispersión lleva un solo color por camino: alrededor de un cristal hay grano de color a pocas muestras, y una luz vista a través de él converge como una cáustica. Los rayos de sombra, las paredes finas alrededor de un medio y los sólidos con medio no dispersan (E9c).
- La lente trazada pinta cada muestra en una banda (R, G o B): a igualdad de muestras el bokeh tiene unas cinco veces la varianza del de la lente fina (las bandas y las muestras que la lente para), así que pide más muestras para converger; la inclinación de la lente fina no se aplica a una lente trazada (próximamente) y el modo Rápido aproxima su distorsión y su viñeteo con una curva radial (en un anamórfico, la del meridiano vertical) (O2).
- La vista *Rápida* no pinta los anillos de la madera ni los hilos de la tela, solo su color medio (y los nudos, oscurecidos); a tamaño real, los hilos de la mayoría de las telas son más finos que un píxel y se promedian en él. El barniz del carbono y de la madera barnizada sigue el relieve del dibujo (M4), la malla técnica no tiene agujeros (M2b) y el terciopelo no tiene *sheen* (S8) (E6).

## v0.1.6 — 2026-10-14

Versión de prueba con texturas y etiquetas, el editor de materiales por
nodos, sets de estudio con intención fotográfica, lente fina mejorada con
selector de bokeh, filtros de lente planificados para la siguiente, salida
TIFF y RAW, la proporción en la cámara, plugins con el primero de película,
elección de luz por punto, despieces configurables y línea de tiempo nueva,
cuerpos rígidos con *Dejar caer*, partículas de ambiente, *denoise* en
directo con intensidad y suavizado de bordes, y actualizar desde la
aplicación. Lo de v0.1.2 a v0.1.5 sigue igual.

### Limitaciones conocidas de esta versión

- Las **texturas**, las **etiquetas** y los **materiales de nodos** se ven en
  *Rápido*; *Completo* y el render usan la media de cada salida hasta que el
  motor las lea (M2b y M3b, en marcha). La madera con nudos, el bisel y la
  tela hilo a hilo (E6), la energía, los medios y la dispersión (E9) y los
  filtros de lente (O3a) están hechos y entran en la siguiente versión.
- **Partículas**: el polvo a contraluz apenas brilla en el haz y la lluvia
  bajo una clave dura motea el producto (los dos en S4b); no se seleccionan
  en el visor; a 200 000 partículas el render cuesta 3,2×, a las densidades
  de los presets cerca de 1,1×.
- **Físicas**: solo cuerpos rígidos; *Tela* y *Líquido* dicen *próximamente*.
  Mientras corre una simulación el visor pasa a *Rápido*. Con el cabezal en 0
  una pieza que sostiene una simulación grabada enseña su fotograma inicial.
- **Plugin de película**: licencia cerrada, un adelanto de una app en
  desarrollo; la clave de activación la da su desarrollador (el registro no
  la trae: se teclea al instalar). El paquete `film-0.1.0.rpk` es un *asset*
  de esta release.
- **Reducción de ruido en directo**: el carril del lanzador es un hilo; el
  refresco nunca supera una muestra de toda la vista. MSAA 8× no se ha visto
  dibujado (el Chromium de aquí llega a 4×).
- **Actualizar desde la aplicación**: la primera actualización real es de
  esta versión a la siguiente; la instalación en Windows no se ha probado en
  un Windows real.
- Las 88 **miniaturas de montaje** se renderizaron antes de la elección de
  luz por punto (E12); se rehacen en la siguiente versión.
- Siguen las de las versiones anteriores, sobre todo que lo nuevo de
  escritorio **no se ha probado en un Windows real** y que la primera imagen
  real de la IA en una tarjeta gráfica sigue pendiente.

### Escritorio

- **Actualizar desde la aplicación** (P5): *Ajustes ▸ Actualizaciones ▸ **Instalar y reiniciar*** (y el mismo botón en el aviso de la barra de estado) descarga la versión nueva, comprueba su SHA-256 contra el `SHA256SUMS.txt` de la release, la instala y reinicia la aplicación con ella, sin pasar por el navegador. En **Windows instalado** ejecuta el instalador en silencio (`/S /LAUNCH`: espera a que la aplicación se cierre, instala y la vuelve a abrir); en un **portable** (Windows y Linux) extrae el paquete junto al programa y sustituye los archivos en el sitio —el ejecutable en uso se renombra a `.old`, `data/` y `portable.txt` no se tocan, y si algo falla a medias queda lo viejo donde estaba—, y la versión nueva borra los `.old` al arrancar. Solo se descarga de las releases del repositorio de la aplicación (`github.com/<owner>/<repo>/releases/download/…`); una suma que no cuadra no instala nada. La fila enseña *Descargando… 45 % · 3,2 de 7,1 MB*, *Comprobando…* e *Instalando…*, los fallos con su motivo y *Reintentar*, y *Cancelar la actualización*; cerrar *Ajustes* no la para. La web sigue con *Descargar*, que abre la página de la versión. La primera actualización desde la aplicación será de la versión que lleve esto a la siguiente (P5).
- El instalador de Windows, en silencio, espera hasta 30 s a que `repackshot.exe` quede libre, no toca la elección de modelos de IA ni recrea un acceso directo del escritorio que se borró, y con `/LAUNCH` abre la aplicación al terminar (P5).

### Interfaz

- Sección *Cámara* ▸ **Bokeh** (O1): los 20 tipos de bokeh con una miniatura renderizada por el propio motor (doce puntos de luz desenfocados sobre negro); los que necesitan la lente trazada o la óptica de ondas dicen lo que esperan. Variantes (láminas rectas o curvas, estrellas, corazón, agujeros…), *Disco sencillo* para volver a la lente fina de siempre, y **Óptica avanzada**: láminas, redondez, giro, perfil e intensidad, obstrucción, ojo de gato, anamórfico, inclinación y su eje, desplazamiento horizontal y vertical (el modo Rápido mueve el encuadre), y, marcados *no físico*, aberración cromática y remolino. Todo deshacible; las cámaras anteriores abren igual.
- **La pregunta por los cambios sin guardar** gana **Guardar como…** (con el diálogo) en todos sus usos —cerrar, *Nuevo*, *Abrir* y actualizar—: *Guardar · Guardar como… · No guardar*, y *Cancelar* o `Esc`. *Guardar* y *Guardar como…* siguen solo si el proyecto se escribió de verdad. En *Ajustes*, `Esc` cancela una pregunta abierta en lugar de cerrar la ventana (P5).
- La lista de cámaras del visor (arriba a la derecha) enseña la óptica de cada cámara (*85 mm · f/5.6*) y un **lápiz** por fila que abre la ficha de esa cámara en el inspector (nombre, *Activar*, *Mirar a través*, óptica y posición) con la pestaña *Cámaras* abierta; y la sección *Cámara* del inspector de escena dice **qué cámara edita** (la activa, por su nombre), con el mismo lápiz y una nota de que cada cámara tiene su óptica y su posición (aviso del usuario: no se veía que se estuviera editando *Cámara 1*).
- **Editor de material por nodos** (M3a): un material puede ser **Simple** (los parámetros de su familia) o **Nodos**, un grafo de nodos que se edita en la ventana nueva **Editor de material** (*Nodos…* del inspector, *Material ▸ Editar con nodos…* del menú de una pieza, la paleta). Lienzo con zoom y desplazamiento, tarjetas que se arrastran con una esfera de lo que da cada nodo, tomas con una forma por tipo (número, color, vector, normal), conexiones por arrastre que rechazan los tipos que no casan y los bucles diciendo por qué, **Añadir nodo** con búsqueda, selección por clic y por recuadro, *Duplicar*, *Eliminar*, atajos, y el panel del nodo con sus parámetros y entradas. Diecinueve nodos: *Salida de material*, *Textura de imagen*, *Mapeado*, *Ruido* (Perlin y símplex), *Degradado*, *Cuadros*, *Rayas*, *Rampa de color*, *Mezcla*, *Matemática*, *Fresnel / peso de capa*, *Curvatura*, *Valor*, *Color*, *Separar* y *Combinar RGB*, *Invertir*, *Mapa de normales* y *Relieve*; y **diez ejemplos** (plástico con etiqueta, metal cepillado con arañazos, mármol, cuero, madera con dos ruidos, vidrio con suciedad por Fresnel, cuadros, pintura metalizada con copos, cerámica con esmalte, rayas). Pasar a *Nodos* da el grafo mínimo y volver a *Simple* desde él es exacto; desde uno más rico, pregunta. Todo deshacible, una entrada por edición (M3a).
- La vista **Rápido** dibuja los materiales de nodos con mapas de 512 × 512 evaluados en *workers* (antes uno de 128²); el inspector y el editor dicen sobre qué superficie (las UV, su proyección, o un corte frontal para lo que lee coordenadas 3D) y qué aproximan (Fresnel a 60°, curvatura omitida, el valor medio de las salidas sin mapa). *Completo* y *Render* usan el valor medio de cada salida hasta que el motor evalúe grafos (*próximamente*, M3b) (M3a).
- **Texturas de imagen** (M2a): el inspector de un material gana la sección **Texturas**, con seis ranuras —*Color*, *Rugosidad*, *Metal*, *Normal*, *Alfa* y *Emisión*—, cada una con su vista previa, *Cargar…* (PNG o JPEG; el diálogo del sistema en escritorio) y *Quitar*, y cómo lee su imagen (canal, invertir, intensidad del mapa de normales o de alturas, recorte y umbral del alfa, tinte e intensidad de la emisión); y un **mapeado** común: *Proyección* (*UV · Caja · Plana · Cilíndrica · Esférica*), eje, juego UV, tamaño en mm con *Ajustar a la pieza*, giro, desplazamiento, repetición y bordes. Todo deshacible, un arrastre una entrada (M2a).
- **Etiquetas** (M2a): *Añadir etiqueta…* elige una imagen con alfa, y una pulsación sobre la pieza con un arrastre la coloca allí (plana desde la normal de la superficie, derecha) con su ancho; varias por material, en orden (*Traer delante*, *Enviar atrás*), con ancho, giro, alcance y su acabado (rugosidad, barniz, relieve del papel); **Mover etiqueta** la desliza por la superficie (M2a).
- La vista **Rápido** dibuja todas las ranuras, las cinco proyecciones (la caja mezcla tres ejes, la cilíndrica y la esférica sin costura visible) y las etiquetas, con mipmaps, sobre el aspecto de siempre (luces, entorno, sombras, contorno). *Completo* y *Render* las pintan cuando el motor las lea (*próximamente*, M2b) (M2a).
- La **hoja de importación** gana la sección **Texturas**: cuántas imágenes se guardan y cuánto pesan, y cada una que no, con el porqué (M2a).
- **Reducir ruido** en la barra superior, a la derecha de *Rápido · Completo* (atajo `D`): el *denoise* del visor *Completo* en directo. Es el mismo interruptor que el botón del medidor y que la parte *Visor* de *Avanzado ▸ Reducción de ruido*: una sola verdad, la del proyecto, deshacible y guardada con él. En *Rápido* se ve deshabilitado (*Se aplica al modo Completo*). El paso *Rápido y Completo* del recorrido guiado lo nombra (U11).
- **El visor *Completo* reduce el ruido mientras se acumula**: encenderlo limpia al momento lo acumulado (también con la imagen ya convergida) y apagarlo enseña en el fotograma siguiente la imagen ruidosa, sin volver a empezar; mientras se renderiza, la imagen limpia se refresca tan a menudo como cuesta un *denoise* (al menos cada `max(2 × su coste, 0,5 s)`) y nunca es de hace más de un *denoise*. Antes se refrescaba al principio, al final y solo cuando había pasado tres veces lo que costó el último, y entre medias se quedaba atrás (U11).
- *Avanzado ▸ Reducción de ruido* gana **Intensidad** (0–100 %, por defecto 100 %): cuánto de la imagen filtrada se entrega, mezclada con la ruidosa por canal en luz lineal. Un solo mando para el render y para el visor *Completo*; con 0 % no se filtra nada. Deshacible y guardada en el proyecto; los proyectos anteriores abren al 100 % (U11b).
- **Ajustes ▸ Motor de renderizado ▸ Suavizado de bordes**: dos listas de menos a más coste. *Modo Rápido*: *Ninguno · MSAA 2× · MSAA 4× · MSAA 8×* (por defecto 4×; la línea dice hasta dónde llega el dispositivo y con qué dibuja). *Completo y render*: *Ninguno · Estándar · Suave · Fino · Fino + bordes ×2 · Fino + bordes ×4*, cada uno con su frase (por defecto *Fino*, que cuesta los mismos rayos que *Estándar*, el de antes). Son ajustes de la aplicación (en escritorio, en `settings.json`), no del proyecto. El medidor dice el filtro cuando no es el de fábrica (*Filtro · Estándar*, por ejemplo) y el multimuestreo de *Rápido* cuando no es 4× (E11).
- **Dejar caer** (S2): en el menú contextual de una pieza, un grupo o un modelo (en el árbol y en el visor), en las secciones *Pieza* y *Físicas* del inspector y en la paleta. Lo seleccionado cae sobre el suelo y sobre lo que tenga debajo y la simulación se para sola cuando todo está quieto; toda la caída es una entrada de deshacer (S2).
- La **barra de físicas** (S2), un cajón de la barra inferior junto a *Animación*: *▶ Iniciar · ⏸ Pausar / ▶ Reanudar · ■ Parar · ↺ Reiniciar*, el tiempo simulado y los cuerpos despiertos tal como los cuenta el simulador, y el estado (*Parado* por defecto, y cómo acabó). *Pausar* congela lo que se ve, *Parar* confirma la pose y *Reiniciar* la deshace como otra entrada de deshacer (S2).
- Inspector ▸ **Físicas** (S2): papel (*Estático · Dinámico*; *Tela* y *Líquido*, próximamente), densidad en kg/m³ (la de la familia del material, o propia), rozamiento, rebote y, en un grupo, *Como piezas* (S2).
- El **Doctor** avisa de una pieza dinámica que empieza atravesando el suelo, y la sube (S2).
- **Salida en TIFF y en RAW (DNG)** (U12): la ventana de render ofrece **TIFF** —sin compresión, con *8 bits*, *16 bits* (sRGB) o *32 bits flotante* (luz lineal con la exposición del render, como el EXR), con fondo transparente y los DPI de la ventana como resolución— y **RAW (DNG)** —un DNG 1.4 lineal en coma flotante que un revelador de raw abre como el de una cámara, con toda la latitud del render y sin alfa—, cada uno con una línea de ayuda. El nombre acaba en `.tif` o `.dng`; el visor de resultados y las miniaturas usan una copia PNG de 8 bits del mismo render (los navegadores no muestran TIFF ni DNG); *Guardar de nuevo* escribe el archivo. Los ajustes antiguos abren igual, y *Preferencias ▸ Render ▸ Formato* ofrece los dos (U12).

- **La proporción de la imagen es de la cámara** (U13): cada cámara lleva la suya —*3:2*, *4:3*, *16:9*, *1:1*, *5:4*, *4:5*, *9:16*, *21:9*, *2:1*, *65:24* panorámica o *Propia* con su `w : h`—, en una fila **Proporción** de la sección Cámara y de la ficha de cada cámara (deshacible). El **marco del visor** sigue a la cámara que se ve, el chip de arriba a la derecha dice la proporción con el tamaño (*16:9 · 1920 × 1080*) y la lista de cámaras la pone tras la óptica. La **ventana de render** lee y escribe la misma: en una imagen el ancho se conserva y el alto sale de la proporción de la cámara activa; un tamaño que la rompe (los dos lados, o uno con el candado abierto, o un preset de tamaño de otra proporción) la reescribe en la cámara y la ventana lo dice en una línea (*La proporción de Cámara 1 pasa a 4:3*). *Nueva desde la vista actual* copia la proporción; cada cámara conserva la suya al cambiar la activa; un trabajo para otra cámara sale con el alto de esa cámara. La animación conserva su tamaño propio y el Doctor gana **Proporción de la animación**, que avisa de los planos cuya cámara tiene otra proporción (y lo arregla).
- **Ambiente** (S4a): la pestaña *Escena* gana la sección **Ambiente**, entre *Entorno* y *Cámara*: efectos de partículas del aire —*Motas de polvo*, *Polen*, *Lluvia*, *Nieve*, *Polvareda*, *Ceniza*, *Burbujas que suben*, *Confeti que cae*— que se añaden desde una galería de tarjetas (*Calima*, *Haces de luz* y *Niebla baja*, *próximamente*), con ocho mandos de fotógrafo siempre visibles (cantidad, tamaño, energía, caos, viento y su dirección, gravedad, variación, semilla con *Barajar*) y *Avanzado* plegado con todo lo demás (región, banda, forma, caída, giro, estela, turbulencia, nube, material, tintes, *Congelar en*, visibilidad, tope). Todo deshacible. El visor *Rápido* dibuja hasta 50 000 partículas por efecto con el simulador del propio motor (o la caja de la región sin `rt.wasm`, y el medidor lo dice); *Ajustes ▸ Motor de renderizado ▸ Partículas por efecto* fija el tope (automático: 100 000 en el navegador, 1 000 000 en nativo) y el Doctor avisa de lo que pasa de él.

### Plugins

- **Ajustes ▸ Plugins** (P6): los plugins del registro de Repackshot, cada uno con su logo, editor, versión, tamaño, resumen, la ficha **Licencia cerrada**, su página y la frase *El código de este plugin es cerrado; la licencia de Repackshot no lo cubre*; **Instalar**, **Actualizar** y **Quitar**; la **clave de activación** pedida en su fila cuando el registro no trae dónde pedirla; **Instalar desde archivo…** (`.rpk` y su clave); su licencia y sus avisos de terceros completos, desplegables (P6).
- **Ventana de render ▸ Plugins** (P6), después de la IA: un bloque por plugin, dibujado desde su manifiesto: recetas por sus categorías, sus mandos por grupos, **vista previa** del resultado actual por el plugin (a 480 px, 300 ms después del último cambio, cancelable) con los números que da el propio plugin y el tiempo medido, y **Aplicar**, un resultado nuevo en el visor con su procedencia, guardado como *<origen>_<plugin>.png*. Los ajustes de cada plugin son del proyecto: deshacibles y guardados con él (P6).
- **El primer plugin: aintfilm · simulación de película** (P6): el motor de película de aintfilm, la app de edición de fotos y simulación de película del mismo desarrollador, en desarrollo (un adelanto): 51 películas, su color solo, 8 granos, 13 filtros de difusión y 4 caracteres de objetivo, con sus nombres públicos; los mandos de su editor de recetas (formato del negativo, exposición y forzado, color, contraste, saturación, calidez, copia o escaneo, grano, halación, difusión, objetivo, motor de grano, semilla). Un EXR entra como luz lineal, sin pasar por 8 bits. Licencia cerrada; se descarga como *asset* de la release v0.1.6 (P6).
- El paquete `.rpk` (P6): cabecera en claro y contenido cifrado con AES-256-GCM; se guarda cifrado en este equipo con su clave aparte y solo se descifra en memoria. `tools/plugin-pack.mjs` empaqueta un plugin (P6).
- **Las recetas, un carrusel** (P6): una tarjeta por receta con su imagen —la escena de prueba del plugin (para el de película, un frasco de perfume junto a una lámpara encendida en un cuarto oscuro) por esa receta—, su nombre y su categoría; se desplaza de lado con la rueda y se elige con las flechas. Las imágenes se hacen una vez en cada equipo. Antes del primer render, la vista previa enseña esa escena de prueba (P6).
- **Filtros y deslizador en el carrusel de recetas** (P6b), como en la búsqueda de películas de la app de aintfilm: *chips* de **Tipo** (color, B&W, diapositiva, cine), **ISO** (≤ 100 · 200–400 · ≥ 800) y **Grupo** (películas, el color de una película, grano, difusión, objetivo), que se combinan, con la cuenta (*23 de 127 recetas*); la receta elegida sigue a la vista, primera y marcada, aunque los filtros la dejen fuera, y los filtros se guardan con el proyecto. Debajo del carrusel, un deslizador para recorrer las recetas, atado a su desplazamiento, con la elegida marcada (P6b).
- **Aplicar a los trabajos de render** (P6): un plugin puede pasar también cada imagen que renderiza la cola; en una animación, cada fotograma con su semilla (*semilla + fotograma*), así que el grano de la película cambia de fotograma en fotograma como en una película de verdad (P6).
- El logo del plugin de película es el del dueño: el cartucho de 35 mm en puntos, con la lengüeta en tres grises (P6).

### Animación

- **Despieces configurables** (N6): el despiece (`EXPLODE`) gana tres geometrías —**lineal** a lo largo de Z, X, Y o una dirección propia, *separar* (cada pieza por su lado del centro) o *apilar* (todas en el mismo sentido, en su orden: el despiece clásico de un envase); **radial**, alejándose de un eje; **esférica**, alejándose de un punto— y la **jerarquía** (piezas, un nivel con los grupos como bloques, o todos los niveles por etapas), con distancia en × tamaño o mm, reparto igual o por distancia, proporcional al tamaño de la pieza, centro (el conjunto, una pieza, el pivote o un punto), orden (a la vez, por distancia o por profundidad, con solape), **suavidad** en un solo mando (de lineal a muy suave), **excepciones** que no se mueven (*Fijar en el despiece* en el menú de una pieza), conservar la orientación o inclinar las piezas, y el modelo o un grupo como objetivo. Las piezas de un set no se despiezan (N6).
- Cualquier animación se puede **invertir** (un despiece invertido monta: empieza separado y acaba junto) y **repetir** n veces; partir una en el cabezal deja dos mitades que siguen una de otra (N6).
- **Línea de tiempo de tres zonas** (N6): a la izquierda el árbol de lo animado (una fila por objetivo con sus animaciones y su frase corta, *+ Animar Tapón…* en cada uno), en el centro la regla en segundos y fotogramas, el cabezal y las barras, que se arrastran y se estiran con **imán** a los bordes de las otras, al cabezal y a los segundos (`Mayús`: libre), con selección múltiple, objetivos plegables y la pista de cámara con sus planos; a la derecha las propiedades de la animación elegida, con su cabecera de una línea (*Tapón · Despiece esférico · 1,5 × tamaño · 0–3 s*), sus mandos y la curva con su vista previa. Elegir una animación resalta su objetivo en el visor y dibuja su pista (arco de la órbita, flecha, vectores del despiece, eje del giro); elegir una pieza marca las filas que la mueven. Teclas: `Espacio`, `Inicio`/`Fin`, `←`/`→` (`Mayús`: diez fotogramas), `Supr`, `Ctrl D`; *Bucle* y zoom en la cabecera (N6).
- Los despieces guardados antes se leen **exactamente igual** (la clave `RADIAL` sigue siendo la esférica; la radial nueva es `CYLINDRICAL`) (N6).
- **Toda simulación se graba en la animación** (S2): cada cuerpo que cae recibe un clip **Simulación** (`PHYSICS`) en la línea de tiempo, que crece fotograma a fotograma mientras corre, con el cabezal detrás; se mueve en el tiempo, se estira para ralentizarlo, se repite y se invierte como cualquier otro, se guarda con el proyecto y sigue al nodo si se mueve después. La foto fija usa el fotograma del cabezal (S2).

### Importación

- glTF y GLB traen sus **materiales con sus mapas** leídos de su JSON (color base, metal-rugosidad, normal con su escala, emisión con su factor y `KHR_materials_emissive_strength`, alfa con su modo y umbral; transmisión, IOR y barniz de sus extensiones; `KHR_texture_transform`); OBJ lee sus **`.mtl`** y sus imágenes (con `-s`, `-o`, `-bm`, `-clamp`, `-imfchan`); FBX, Collada, 3MF, USD y 3DM, los mapas que carga su lector. Las imágenes y bibliotecas que un modelo nombra se buscan entre los archivos **elegidos o soltados con él**; *Importar modelo…* deja elegir varios (M2a).
- Las **UV** se conservan, también un **segundo juego** (glTF `TEXCOORD_1`), y las normales por vértice del archivo (M2a).

### Proyecto

- La sección *Físicas* de cada nodo y los clips `PHYSICS` (pista horneada en base64 y ancla) se guardan en el proyecto; un proyecto anterior abre igual y el esquema sigue en 2 (S2).
- Las cámaras guardan su proporción (`aspect`); un proyecto de antes la toma del tamaño de render que guardó (el preset que cuadra con un 0,5 %, si no *Propia* con esos píxeles) y conserva ese tamaño (U13). Abrir un proyecto vuelve a calcular las comprobaciones del Doctor con el catálogo de esta versión, también al leer solo el estado.
- El **grafo** de un material viaja en el proyecto (con su versión) y en la biblioteca (sin sus imágenes, que son del proyecto); un grafo guardado abre idéntico. Los proyectos anteriores abren con sus materiales en *Simple* (M3a).
- Las imágenes de textura **viajan en el proyecto** tal cual (PNG o JPEG, base64), una vez cada una, bajo un id que nombra su contenido: un proyecto guardado y abierto vuelve con los mismos bytes. Hasta 16 MB por imagen y 64 MB por proyecto. Los proyectos anteriores abren igual (M2a).
- Los efectos de *Ambiente* se guardan con el proyecto como parámetros (las partículas no: se evalúan); un proyecto anterior abre sin ninguno (S4a).

### Motor

- **Lente fina mejorada** (O1): sección nueva y opcional `LENS` del RSB, justo después de `CAMR`. Diafragma redondo o de 3 a 18 láminas rectas o curvas con su giro, o una máscara (estrellas, corazón, varios agujeros…) muestreada por su CDF 2D; textura de pupila (polvo, rayas, malla, anillos de cebolla); perfil de la pupila (uniforme, centro brillante, anillo brillante, apodizada), obstrucción central, ojo de gato aproximado (con el viñeteo que lo acompaña), compresión anamórfica de 1,33× y 2× (la imagen sale desestirada), descentramiento y **inclinación con plano de enfoque de Scheimpflug**, y, como ajustes artísticos, aberración cromática por tres bandas (cada muestra una banda, estratificada, sin mover el foco) y remolino. Todo muestreado con su densidad exacta, sin rechazo, determinista en cualquier plataforma. Una escena sin `LENS` renderiza bit a bit como antes (O1).
- **Elección de luz por punto** (E12): la estimación de siguiente evento elige cada vez la luz por lo que puede iluminar el punto que se sombrea (las cotas de Conty Estevez y Kulla, HPG 2018), no por su flujo en toda la escena. Un foco pequeño cerca de su papel —el *pool* de STRIP_EDGE, BLACK_ON_BLACK o WARM_COOL_CINEMA— deja de sembrar chispas blancas en el papel: bajo el foco se elige el 21–48 % de las veces en lugar del 0,08–0,3 %. Con una sola luz la imagen es la misma, bit a bit; el atrapasombras y las cáusticas siguen eligiendo por flujo (el atrapasombras conserva su aspecto); los mismos bits con cualquier número de hilos y en el navegador (E12).
- **`rt-phys`**, el simulador de cuerpos rígidos propio (S2): dinámica por posiciones extendida (XPBD, Müller et al. 2020) a 240 pasos por segundo con 4 subpasos, envolventes convexas por *quickhull* propio (o caja orientada) y esferas exactas, contactos por ejes separadores contra envolventes, triángulos y el suelo, rozamiento de Coulomb con anclas y torsión, restitución, resistencia a la rodadura y dormir. Determinista: el mismo *hash* de poses con 1 y N hilos y en wasm. Mil esferas se asientan en 1,7 s simulados (S2).
- `rt-wasm` exporta el simulador (`phys_new`, `phys_step`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_hash`…), que corre en un *worker* propio de la página (S2).
- El **contrato de los grafos con el motor** queda escrito para M3b (`ARCHITECTURE.md` §5.2 quater): el programa lineal (registros f32 y vec3, instrucciones de seis palabras con códigos estables, constantes, tabla de imágenes, salidas, su forma en bytes), cada instrucción en f32 con su orden de operaciones, el ruido (hash de esquina, gradientes de Perlin 2002, símplex, octavas) y los 1000 puntos de la prueba cruzada, con los valores de los diez ejemplos fijados en el intérprete de TypeScript (M3a).
- El **contrato RSB de las texturas** queda escrito para M2b (`ARCHITECTURE.md` §5.2: sección `IMGS`, bloque de texturas de `MATL` desde el byte 100, UV en `MESH`); el escritor lo produce solo cuando se le pide, y hasta entonces los bytes de cualquier escena son los de antes (M2a).
- **Ajuste de visor del *denoise*** (`Preset::VIEWPORT`): tres pasadas à-trous en vez de cinco y una varianza espacial 3 × 3 por debajo de cuatro muestras, con su propio halo de 24 filas. Frente a referencias de 1024 muestras, desde 8 muestras su error queda a menos de un 3 % del filtro completo y a 4 muestras entre un 3 y un 11 % por encima, en un 60 % del tiempo en un hilo y un 40 % por bandas. El render final y `rt` conservan el filtro completo y sus bits (`0xab15f290`) (U11).
- El lanzador reduce el ruido del visor en un carril propio, un hilo que toma uno de los hilos del visor mientras trabaja (nunca uno de un render final), con pasadas de más o menos lo que dura un *denoise*; la web lo hace con los *workers* del visor por bandas, entre baldosa y baldosa. Los fotogramas del lanzador llevan el número de su imagen y el visor lo sigue sin pedir las sumas otra vez si no cambiaron (U11).
- `RNDR` gana `denoise_strength` al final (56 B; sin él, 1: los *hashes* de siempre) y el motor mezcla `ruidosa × (1 − s) + filtrada × s` (`rt_post::denoise::blend`, `denoise_rows_at`); con 0 no ejecuta el filtro. `rt --denoise-strength <S>` y `rt_denoise_with(ajuste, s, …)` en wasm (U11b).
- **Filtros de píxel** por muestreo de importancia: centro, caja de 1 px (el de siempre), tienda de 2 px y Blackman–Harris de 3 px (CDF inversa tabulada en `f32`, sin trigonometría al renderizar), y **muestras extra en los bordes** (×2, ×4): los píxeles cuyo vecino ve otra pieza, otro material o otra profundidad, desde los rayos centrales, toman `k` muestras por índice y suman su media; la misma imagen con cualquier número de hilos y cualquier corte de baldosas. `RNDR` gana `pixel_filter` y `edge_supersample` al final (64 B; sin ellos, la imagen de antes); `rt --pixel-filter none|standard|soft|fine --edge-samples K` y `rt --write-e11-example` (E11).
- `rt-core::tiff` y `rt-core::dng`, los escritores de TIFF 6.0 y DNG 1.4 de la salida, solo con `std` y de la especificación pública; la interfaz escribe los mismos bytes (`encodeTiff`, `encodeDng`), con los archivos de `tests/fixtures/tiff/` como prueba de paridad. `rt` escribe `--format tiff` (con `--bits 8|16|32`) y `--format dng`, o por la extensión de `-o`; el lanzador guarda esos resultados y deja escribir `.tif`, `.tiff` y `.dng` (U12).
- **Partículas de aire sin estado** (S4a): *crate* nuevo `rt-sim` (cada partícula es función pura de semilla, id e instante, en forma cerrada, con deriva de *curl noise* y muerte en el suelo); sección RSB `FXAM` con los parámetros de cada efecto (192 B, `ARCHITECTURE.md` §5.2); esferas con intersección estable, discos y cápsulas con su BVH en `rt-core`, un tamaño mínimo de 0,35 px para los rayos de cámara que conserva la energía, visibilidad a cámara, en reflejos y en sombras; `rt_particles_eval` en `rt.wasm` para el visor, y `rt --write-ambient-example`. Sin efectos, los píxeles de toda escena no cambian.

### Luz

- **Sets de estudio** (L6): 16 montajes nuevos, el estilo **Sets**, el primero del catálogo, que traen además de los focos lo que el producto refleja y donde se apoya: **tarjetas** blancas, negras y plateadas fuera del encuadre, un **fondo** (color, **degradado** o fondo infinito que recibe luz y sombra), un **suelo** (acrílico negro o blanco brillante, espejo negro, mate o el atrapasombras), un **charco de luz** detrás del producto, un desvío de exposición y la fuerza de la cúpula. Cada uno con su razón fotográfica en la ayuda de su miniatura: *Tira larga y canto negro*, *Campo oscuro*, *Campo claro*, *Blanco infinito*, *Caja de luz con negros*, *Familia de ángulos*, *Rasante con relleno*, *Negro sobre negro*, *Ventana cálida*, *Contraluz líquido*, *Cine cálido-frío*, *Color pop*, *Fondo degradado con foco*, *Suelo espejo*, *Cenital* y *Silueta con halo* (L6).
- Aplicar un set es una entrada de deshacer; otro montaje sustituye su decoración sin tocar tus piezas, *Restablecer montaje* la quita y *Crear estudio* la vuelve a ajustar. Las piezas del set no cuentan para el tamaño de pieza, el encuadre ni el Doctor, y se pueden apagar una a una en la sección *Luz*. **Usar la cámara del set** pone la vista para la que está pensado (L6).
- Los 15 tipos de producto de estudio **son un set**: *Crear estudio* (y *El del tipo de producto*) pone sus focos, su fondo, su suelo, sus tarjetas y su charco de luz, y el ejemplo o el modelo importado llegan ya vestidos (joyería, *Caja de luz con negros*; relojería, automoción y herramienta, *Familia de ángulos*; perfumería y cosmética, *Tira larga y canto negro*; electrónica, *Negro sobre negro*; electrodoméstico e instrumental médico, *Blanco infinito*; mobiliario interior, *Ventana cálida*; calzado y textil, *Rasante con relleno*; óptica, *Campo claro*; estándar y *packaging*, *Fondo degradado con foco*). Los demás montajes se ven sobre ellos igual que antes. Mobiliario exterior conserva su sol (L6).
- Las 88 **miniaturas de montaje** las renderiza ahora nuestro motor, cada set sobre el objeto para el que está pensado y los montajes anteriores sobre el de su estilo; las de los sets, el doble de grandes (L6).

### Materiales

- Cinco materiales nuevos para los sets: *Tarjeta blanca*, *Tarjeta negra*, *Acrílico negro brillante* y *Acrílico blanco* (con la ligera bruma de una lámina real) y *Espejo negro* (la tarjeta plateada es el *Aluminio cepillado*) (L6).

### Entorno

- Fondo **Degradado**: dos colores, arriba y abajo del encuadre, en la vista previa y en el motor (L6).

## v0.1.5 — 2026-10-14

Versión de prueba con cáusticas y reducción de ruido propias, focos propios
que se mueven en el visor, el *prompt* propio y las variantes de la IA, y
un recorrido guiado. Lo de v0.1.2 a v0.1.4 sigue igual.

### Motor

- ***Denoise* propio** (E5b-1): un filtro à-trous con paradas en aristas (Dammertz et al. 2010) con la parada de luminancia guiada por la varianza de SVGF (Schied et al. 2017), guiado por el albedo, las normales, la profundidad y los ids de cada píxel y por su varianza, que ahora acumula la película; nunca mezcla dos piezas. A 4 muestras por píxel el error frente a un render largo baja a entre el 4 y el 20 % del de la imagen sin filtrar en las escenas de la hoja de contactos. Los mismos bits en el escritorio y en el navegador (E5b-1).
- **Cáusticas** con un mapa de fotones progresivo (SPPM, Hachisuka y Jensen 2009, en la forma de Knaus y Zwicker 2011): la luz que atraviesa el vidrio o rebota en el metal pulido hasta el suelo, el atrapasombras o una pieza mate llega por fotones y no por caminos ruidosos del trazador (también la que ilumina la escena después de un rebote difuso, que daba destellos), sin contarse dos veces; la sombra del vidrio macizo deja de ser negra. Deterministas con cualquier número de hilos (E5b-1).
- **Puntos y focos direccionales** en el integrador (`LGHT` 3 y 4): una esfera de radiancia uniforme muestreada en su cono de direcciones (un punto, por posición), el cono con transición en *smoothstep* como en la vista previa, visibles a cámara y en reflejos con MIS; un foco estrecho apuntado a la escena se elige como su punto, así que su círculo de luz no sale con ruido. Bit 2 de `LGHT.flags`: **sin sombra** (L4).

### Interfaz

- Ventana de render ▸ *Calidad* ▸ **Cáusticas**: *Automático* (por defecto: encendidas con vidrio o metal pulido y una luz pequeña) · *Encendidas* · *Apagadas*; en *Avanzado*, **Calidad de cáusticas** (*Baja · Media · Alta*), **Reducción de ruido** (*Apagada · Visor · Render · Los dos*, por defecto *Los dos*) y **Guardar también sin reducción de ruido** (E5b-1).
- El medidor del visor *Completo* dice *Ruido reducido* y *Cáusticas · N fotones por muestra* cuando el motor lo hace, y su botón *Reducir ruido* enciende o apaga el filtro del visor (E5b-1).
- **Focos propios** (L4): *+ Añadir luz* en la pestaña *Luces* (y en *Añadir ▸* de la cabecera, el clic derecho del visor en vacío y la paleta) añade un **área** (rectángulo, disco o esfera), un **punto**, un **foco direccional** (cono y transición) o un **sol**, delante y arriba de la pieza, encendido, seleccionado y con el brillo medio de los focos encendidos; *IES* sigue *próximamente* (L5). Duplicar, eliminar y apuntar en la fila del foco seleccionado; *Apuntar un foco aquí ▸* en el menú contextual de una pieza.
- El inspector de un foco tiene todo: nombre, tipo, forma, tamaño o radio, acimut, elevación y distancia, **coordenadas X, Y, Z**, **Apuntar a…** (el centro del producto, un punto, una pieza), giro, dispersión, cono y transición, disco del sol, temperatura o color, **potencia en vatios con sus lúmenes** (o lux), visible en reflejos y a cámara, **proyecta sombra**, encendido, *Colocar por reflejo*, **Colocar sobre superficie**, *Mirar a través*, *Duplicar* y *Eliminar*. Ya no dice *próximamente* (L4).
- **Guardar montaje como…** guarda también los focos propios (tipo, objetivo, giro, transición, sombra); aplicado a otro tipo de producto conserva la irradiancia total de ese tipo y el reparto entre focos. **Restablecer al montaje** quita los focos propios (L4).
- **Luces y cámaras en el visor**: glifos acromáticos (el contorno del panel, la esfera, el punto, el cono del foco, la flecha del sol, la pirámide de cada cámara guardada) mientras la pestaña *Luces* o *Cámaras* está abierta o hay una seleccionada; el botón **Luces y cámaras** de la barra de vista, a la izquierda de *Desplazar*, los muestra u oculta. Un clic en un glifo lo selecciona y **Mover** lo mueve y lo gira (la luz con su asa de apuntar, la cámara con su objetivo), una entrada de deshacer por arrastre (L4).
- **Mirar a través** (`Ctrl/⌘ ⇧ L`, el botón de la barra de vista o del inspector, doble clic en el glifo): el visor mira desde la luz o la cámara seleccionada, en *Rápido* y en *Completo*, y Orbitar, Desplazar y Zoom la mueven (la luz apunta a donde mira el visor); una cámara bloqueada no se mueve; `Esc` vuelve a la cámara activa (L4).
- **Recorrido guiado** (U10): una capa propia que recorre la pantalla zona por zona —menú de la aplicación, árbol y niveles de selección, herramientas de vista, *Rápido* y *Completo*, el inspector (producto, luz y montajes, entorno y cielo, cámara y enfoque, materiales), las pestañas *Luces*, *Cámaras* y *Estudios*, *Añadir ▸ Primitiva*, la ventana de render (cola e IA), los resultados y *Ajustes* sección por sección— con un texto corto por paso, *Siguiente · Atrás · Saltar*, puntos de progreso y las teclas `→`, `←` y `Esc`; en español e inglés, acromática, y los pasos abren lo que necesitan (la ventana de render, Ajustes, la pestaña, el cajón) y lo dejan como estaba. Sale sola en el primer arranque y desde *Ayuda ▸ Recorrido guiado*; *Saltar* cuenta como visto, y se recuerda en el documento de ajustes (la carpeta de datos en escritorio).
- El menú de la aplicación gana **Ayuda ▸** con *Recorrido guiado*, *Guía*, *Atajos de teclado* y *Acerca de*.

### Proyecto

- Un proyecto guarda los focos propios con su objetivo, giro, transición y sombra; los proyectos, estudios y bibliotecas anteriores se abren igual, con sus focos apuntando al centro del producto (L4).
- Los ajustes de la IA de la ventana de render y de cada trabajo guardan también el *prompt* propio y el número de variantes; un proyecto anterior se abre sin *prompt* y con una variante (X4b).

### Post-procesado IA

- **Aviso del motor de ejecución** (U10): con un modelo instalado y sin motor de ejecución (o con la descarga en pausa, o sin que arranque, o sin Microsoft Visual C++ en Windows), la sección de IA de la ventana de render y *Ajustes ▸ Post-procesado IA* lo dicen con un botón **Instalar** (el mismo flujo de la fila *Motor de ejecución*), y la barra de estado lleva una nota discreta una sola vez por sesión. Sin modelo, o con un motor que arranca, no dicen nada.
- **El instalador pide también el motor de ejecución** (U10): al elegir algún modelo en el paso *Modelos de IA* se marca el motor recomendado para el equipo (Vulkan con tarjeta gráfica, CPU sin ella: la misma regla y los mismos datos que la aplicación), se puede desmarcar, y el lanzador lo descarga en el primer arranque junto a los modelos. El selector del primer arranque de los portables lo ofrece igual. Lo que el instalador elija en *Ejecutar en el procesador* pasa a ser *Ajustes ▸ Post-procesado IA ▸ Ejecutar en*.
- **Prompt propio** en la sección *Post-procesado IA* de la ventana de render: un campo de varias líneas (hasta 400 caracteres) para describir la luz o el ambiente; va con el trabajo (se guarda en el proyecto, se deshace de una vez al salir del campo y cada trabajo de la cola lleva el suyo) y se añade al final del *prompt* de la escena, sin sustituirlo; el negativo fijo sigue igual. Si el modelo en uso no admite un *prompt* de texto, el campo se ve deshabilitado con el motivo y no se envía nada (X4b).
- **Variantes**: un número de 1 a 8 (1 por defecto) junto a *Otra variación*. Un trabajo con N variantes hace un solo render del motor y N pasadas de la IA con semillas consecutivas, con el modelo cargado una vez; la cola dice *IA · variante 2 de 4 · mosaico 3 de 4*; cada variante lleva su informe de la guarda y su archivo (`_AI`, `_AI_2`, `_AI_3`…). Detener a mitad conserva el render y las variantes terminadas. La sección avisa del tiempo de IA estimado cuando ya se midió en este equipo (X4b).
- El visor de resultados enseña una **tira de miniaturas** de las variantes bajo la cabecera: la elegida es la que el divisor compara con el render, con su informe; *Guardar esta variante* y *Guardar todas*. La cola y el historial dicen cuántas imágenes de IA tiene cada resultado (X4b).
- **Prompt del sistema** en *Ajustes ▸ Post-procesado IA*: unas palabras generales para todas las imágenes, que van antes de las de la escena y del *prompt* propio del trabajo, con *Restablecer el predeterminado*. Las protecciones de la guarda no dependen de él. Para un modelo que lee pocos *tokens* (SD 1.5: 77) se usa su versión corta mientras no se cambie, y lo que no cabe se recorta empezando por el *prompt* propio, luego la escena y por último el del sistema, con una línea que dice qué se quedó fuera (X4b).
- Un modelo importado declara en su `model.repackshot.json` si sigue un *prompt* de texto (`capabilities.textPrompt`) y cuántos *tokens* lee (`capabilities.maxPromptTokens`); el formulario de importar lo pregunta (X4b).

### Correcciones

- Solo de pruebas, sin efecto en la aplicación: la prueba del lanzador que sigue un post-procesado por mosaicos pedía que la respuesta al encargo dijera *en espera*, y con la máquina muy cargada el trabajo ya había empezado; ahora acepta cualquier estado anterior al primer mosaico.

### Limitaciones conocidas

- **La IA sigue sin probarse en una tarjeta gráfica**, ahora también con el *prompt* propio y las variantes. Con SD 1.5 (77 *tokens*) el *prompt* propio casi nunca cabe: la cuenta de *tokens* es prudente y se queda corta de sitio antes que el modelo (X4b).
- Con *Comparar con…* (otro resultado), elegir una variante en la tira solo cambia la línea del informe (X4b).
- **La página del instalador con el motor de ejecución no se ha visto en un Windows real**: se construye y una prueba comprueba su guion, pero aquí no se puede ejecutar el instalador. Quien actualiza ve el recorrido guiado una vez, como en un primer arranque, y el aviso del motor de ejecución sale cuando hay un modelo ya descargado, no mientras se descarga (U10).
- Los perfiles IES siguen *próximamente* (L5). Los puntos, las esferas y los focos direccionales no lanzan fotones: no dan cáusticas (L4, E5b-1).
- **Cáusticas**: solo de las luces de área *glossy*, el sol y los emisores, no del entorno; el radio de recogida es uno por pasada, no por píxel; los brillos de una luz pequeña vistos a través del vidrio pulido siguen saliendo del trazador y tardan en limpiarse; con el fondo transparente el atrapasombras no recoge cáusticas. Cuestan alrededor de un 24 % más de tiempo (E5b-1).
- **Reducción de ruido**: filtra el color sin separar la luz directa de la indirecta, no actúa sobre los fotogramas de resolución reducida mientras se mueve la vista, y el recorte de luciérnagas pierde algo de energía donde las hay. En 1920 × 1080 tarda unos segundos (E5b-1).
- Siguen las de v0.1.2 a v0.1.4, sobre todo que **nada de lo nuevo de escritorio se ha probado en un Windows real**.

## v0.1.4 — 2026-10-13

Versión de prueba con el post-procesado con IA funcionando de punta a punta
en el escritorio, el cielo físico propio, las primitivas y la herramienta
de escalar. Lo de v0.1.2 y v0.1.3 sigue igual.

### Motor

- **Cielo físico propio** (E5c): el cielo de día por defecto tiene la forma funcional de Hošek y Wilkie (2012) con coeficientes ajustados por nosotros a nuestra propia simulación espectral de la atmósfera (capas esféricas, moléculas, bruma, ozono, suelo), en sala limpia. El de Preetham sigue como *Clásico*. La vista previa del modo Rápido dibuja el mismo cielo que el motor, bit a bit (E5c).

### Interfaz

- *Entorno* ▸ *Cielo* estrena **Modelo**: *Físico* (por defecto) o *Clásico*; la bruma baja ahora hasta 1 (aire limpio) en el físico. Los proyectos guardados antes se abren con el físico (E5c).
- **Primitivas** paramétricas en *Añadir ▸ Primitiva* (menú de la cabecera, el `+` del panel *Escena*, la paleta de comandos y el clic derecho del visor en vacío): *Caja* (con radio de bisel), *Plano*, *Disco*, *Cilindro*, *Pedestal* (cilindro con bisel), *Esfera*, *Cono*, *Toro*, *Cápsula*, *Tubo*, *Escalones* y *Fondo infinito* (el suelo que sube en curva hasta una pared). Nacen con criterio de estudio: la *Caja* y el *Pedestal* como base bajo el producto, con 1,4 veces su huella y el producto apoyado encima (una sola entrada de deshacer); el plano y el disco bajo él; el fondo infinito con su pared detrás; el resto en el suelo, junto al producto. Material neutro *Blanco estudio* (U9).
- El **fondo infinito** nace de cara a la cámara activa y llenando todo su encuadre con margen (la óptica y el formato de salida cuentan), con la pared detrás del producto (y detrás del contraluz y los focos traseros del montaje, que siguen iluminando) y una curva suave; *Ajustar a la cámara* lo rehace tras mover la cámara (U9).
- Sección **Primitiva** del inspector: las medidas en mm (ancho, fondo, alto, radios, bisel, segmentos, escalones), en vivo: cambiar una regenera la pieza, un arrastre es una entrada de deshacer y la pieza no se despega del suelo. *Convertir en malla* congela las medidas (también en el menú *Geometría ▸*) (U9).
- Las primitivas tienen caras CAD por cara lógica (la tapa, el lateral, el bisel, cada escalón), así que el nivel *Caras*, los materiales por cara y *Separar por caras CAD* funcionan con ellas; UV en [0, 1] y normales correctas (U9).
- Herramienta **Escalar** (`S`) en la barra de vista, junto a *Desplazar*: el *gizmo* de *Mover* con solo sus asas de escala (un cubo por eje y el punto central para las tres), alrededor del pivote, en ejes locales o globales, incrementos del 10 % con `Shift`; un arrastre es una entrada de deshacer (U9).
- **Clic derecho ▸ Escalar…** en una pieza del visor o del árbol: un panel en línea con *Uniforme* (%), *Por eje* (X, Y, Z en %) y *A medida* (mm de ancho, fondo y alto con la proporción bloqueada), *Aplicar* y *Restablecer escala*; actúa sobre la selección al nivel vigente, alrededor de su pivote (U9).
- Las luces, *Crear estudio*, el tamaño de pieza y el Doctor miran al producto y no al decorado: un fondo infinito seis veces mayor no mueve los focos ni cambia la escala (U9).

### Proyecto

- Un proyecto guarda las primitivas como medidas en un campo opcional del nodo, no como malla, y las vuelve a generar al abrir; se guarda, abre y vuelve a guardar en los mismos bytes. El esquema sigue en 2 y los proyectos anteriores abren igual (U9).

### Post-procesado IA

- En escritorio el interruptor de *Post-procesado IA* de la ventana de render **ya funciona** y deja de decir *próximamente*; también *Ajustes ▸ Post-procesado IA*. En la web sigue diciéndolo (X3c).
- **La tubería de escritorio, de punta a punta**: un render final con *Post-procesado IA* encendido lo hace el lanzador sin que los píxeles vayan a la página y vuelvan: mosaicos, stable-diffusion.cpp con el modelo activo (cargado una vez, también entre vistas previas), la guarda determinista y los reintentos a menos intervención si una protección no pasa. El historial guarda las dos imágenes y el informe de la guarda (X3c).
- La imagen de la IA se escribe desde la luz lineal del render, con su exposición y su curva: un PNG de 16 bits o un EXR siguen siéndolo, y con Intervención 0 es el mismo fichero que el del motor, byte a byte. Con Intervención 0 ni siquiera se arranca el motor de ejecución (X3c).
- La cola enseña dónde está la IA: *IA · cargando el modelo*, *IA · mosaico 2 de 4*, *· intento 2*, *IA · comprobando*. Detener o pausar en ese momento conserva la imagen del motor en el historial (X3c).
- La vista previa de la ventana de render usa en escritorio la misma tubería, con el fotograma del modo Rápido (X3c).
- El suelo del estudio cuenta como superficie que la IA puede reiluminar (sus sombras de contacto y su luz rebotada), con su propia comprobación de color; antes un suelo visto antes que cualquier pieza se trataba como fondo. Los pases de la vista previa lo dibujan igual que el motor (X3c).
- El *prompt* sale de los materiales, las luces y el estilo de la escena, con el negativo fijo; la guarda recibe la tabla de materiales con sus nombres (X3c).
- En Windows, si al motor de ejecución le falta el entorno de Microsoft Visual C++ 2015–2022, *Ajustes ▸ Post-procesado IA ▸ Motor de ejecución* lo dice y ofrece *Instalar el entorno de Microsoft Visual C++…* (la página oficial de Microsoft) y *Comprobar de nuevo* (X3c).
- *Acerca de* lista stable-diffusion.cpp y ggml con sus licencias MIT (X3c).
- El visor de resultados da al informe de la guarda su propia línea, a todo lo ancho bajo el título y los botones, en vez de apretarlo en una columna estrecha junto al título; los botones pasan bajo el título cuando no caben a su lado, y *Cerrar* se queda en la esquina (X3c).
- Un post-procesado por el que nadie pregunta (su ventana se cerró) se para solo a los dos minutos, y apagar el interruptor libera el modelo de la memoria (X3c).

### Correcciones

- *Enfocar con clic* enfoca justo en el punto clicado: medía la distancia en línea recta y el motor enfoca un plano perpendicular a la vista, así que cualquier punto fuera del centro quedaba detrás del plano de foco (aviso del usuario).
- La nota de la cámara ya no dice que la profundidad de campo está *próximamente*: se ve en *Completo* y en el render; *Rápido* no la dibuja.
- Solo de pruebas, sin efecto en la aplicación: la prueba de «respuestas sin leer» del visor, que fallaba de vez en cuando con la máquina muy cargada, espera ahora por condiciones y no por tiempos (P3a).

### Limitaciones conocidas

- **La primera imagen real de la IA en una tarjeta gráfica no se ha probado.** Aquí no hay GPU: la tubería se probó de punta a punta con un motor de ejecución falso y una sola vez con SD 1.5 de verdad en CPU (un ejemplo de 256 × 192, 53 s). Los tiempos con Z-Image, los modelos de edición (FLUX.2 klein y Qwen-Image-Edit, que van como *img2img* más imagen de referencia) y las tolerancias de la guarda son provisionales hasta la fase X1 parte B (X3c).
- Solo SD 1.5 lleva ControlNet (profundidad); con los demás modelos, y con los bordes en todos, la protección de las formas la da la guarda (X3c).
- **En Windows el motor de ejecución necesita el entorno de Microsoft Visual C++ 2015–2022 (x64)**, que no viene con Repackshot ni con el instalador. *Ajustes ▸ Post-procesado IA ▸ Motor de ejecución* lo dice y su botón abre la página de descarga de Microsoft (X3c). En Linux hace falta glibc 2.38 o posterior (X3b).
- **La web sigue sin IA** (fase X3d): allí el interruptor dice *próximamente*. Las animaciones tampoco pasan por la IA (X4).
- Con un trabajo EXR, el historial guarda la imagen de la IA como EXR y el visor no compara *Render | IA*, porque los navegadores no muestran EXR. Si se pausa un trabajo durante la IA, *Reanudar* deja un segundo resultado del mismo trabajo (X3c).
- **Cielo físico con el sol bajo.** Con el sol a 20° o más el error frente a nuestro simulador es de 1 a 8 %; a 10° sube al 5–15 % y por debajo de 3° al 9–17 %, y se nota: al amanecer, un patrón acimutal de ±20 %, y en la hora dorada con bruma un resplandor un 20 % más oscuro junto al sol. Es el límite de la forma funcional. El albedo del suelo es fijo (0,2) y el sol es un cuerpo negro de 5772 K. Los proyectos anteriores se abren con el cielo físico y pueden cambiar de aspecto: *Clásico* devuelve el de antes (E5c).
- **Primitivas.** Mover la cámara no reajusta el fondo infinito (*Ajustar a la cámara* lo rehace); cambiar las medidas de una base no vuelve a subir el producto; *Invertir normales*, *Suavizado* y *Separar* convierten la primitiva en malla; una pieza escalada con *Escalar* sigue mostrando sus medidas sin escala en la sección *Primitiva*; y las versiones anteriores a esta no ven las primitivas de un proyecto nuevo (U9).
- Las luces, *Crear estudio* y el Doctor miran al producto y no al decorado (las piezas que no son primitivas); *Encuadrar todo* sigue encuadrando todo (U9).
- Siguen las de v0.1.2 y v0.1.3, sobre todo que **nada de lo nuevo de escritorio se ha probado en un Windows real**.

## v0.1.3 — 2026-10-13

Versión de prueba que arregla la detección de tarjetas gráficas en Windows,
hallada al probar v0.1.2. Todo lo demás es como en v0.1.2.

### Escritorio

- En Windows se ven por fin las tarjetas gráficas: v0.1.2 no encontraba ninguna en ningún equipo (solo la CPU), porque `reg` sale con error al llegar a una subclave protegida del registro y el lanzador tiraba toda su respuesta. Ahora las pregunta a DXGI, con la memoria de vídeo exacta, y además al registro (clave a clave), a `Win32_VideoController` y a `wmic`; el registro del lanzador (`logs/repackshot.log`, líneas `hardware:`) dice qué contestó cada uno, y si ninguno puede contestar *Ajustes* dice que no se pudieron leer las tarjetas en lugar de que no hay (P3e).
- De esa detección dependen *Ajustes ▸ Post-procesado IA ▸ Equipo*, la fila *GPU*, la elección Vulkan o CPU del motor de IA y el paso de modelos del instalador, que lee el mismo `--hardware` y ya ve las tarjetas (P3e).
- Los programas del sistema (`reg.exe`, `powershell.exe`, `WMIC.exe`) se lanzan por su ruta absoluta en `System32` (P3e).

### Motor

- Interno, sin cambios visibles: pases exactos del motor para el post-procesado con IA (albedo, normal, profundidad, id de pieza, id de material y círculo de confusión de la lente). Pedirlos no cambia ni un píxel de la imagen. En escritorio, el lanzador guarda los de los cuatro últimos renders finales. Todavía no los usa nada: los consumirá la tubería de IA (X2).

### Correcciones

- Una prueba del analizador de tarjetas le pasaba el texto sin el código de salida de `reg`, y por eso se escapó el fallo: era más permisiva que la realidad. Ahora la prueba lee programas que imprimen y salen con error, como el `reg` de verdad (P3e).
- Una prueba del lanzador de IA daba por hecho que el equipo no tiene tarjeta gráfica y fallaba en cualquiera que la tuviera; ahora pide la CPU explícitamente (P3e).

### Limitaciones conocidas

- Siguen todas las de v0.1.2, incluida la principal: el post-procesado con IA no genera ninguna imagen todavía (tubería X3c).
- La detección de tarjetas sigue sin probarse en un Windows real más que a través de Wine. Si aun así falla, `logs/repackshot.log` dice qué contestó cada fuente.
- La página de modelos del instalador no distingue «no se pudo leer» de «no hay tarjeta».

## v0.1.2 — 2026-10-13

Versión de prueba con los arreglos de escritorio que pediste tras probar
v0.1.0, más el post-procesado con IA a medias (la interfaz y el motor de
ejecución, no la tubería) y varias mejoras de motor e interfaz.

### Escritorio

- Ventana propia en Windows, dibujada por Edge WebView2 (el que trae Windows 10 y 11) y no por una pestaña de navegador. Usa la barra de título del sistema, oscura con el tema oscuro, con el título *Repackshot — proyecto* y el icono propio (P3c).
- Cerrar la ventana (botón, `Alt F4`, barra de tareas, menú del sistema) pregunta con nuestra propia ventana *Guardar · No guardar · Cancelar* si hay cambios sin guardar; nunca el aviso de Edge (P3c).
- Icono de la barra de tareas con identidad propia (`Repackshot.App`), también en los accesos directos del instalador, para que se agrupen al anclarlos. La ventana recuerda tamaño, posición y tema (P3c).
- Si falta el cargador o el *runtime* de WebView2, se abre la ventana de aplicación de Edge como respaldo, y *Ajustes ▸ Escritorio* dice cuál de las dos es y por qué. `--window=webview2|browser` fuerza una (P3c).
- La cabecera enseña el logotipo con una flecha hacia abajo en lugar de las tres rayas (P3c).
- Nada del navegador: sin menú contextual, minimenú de selección de texto, oferta de traducir, `Ctrl F`, `Ctrl P`, `Ctrl R`, zoom con el teclado ni navegación; los enlaces externos se abren en el navegador del sistema (P3b, P3c).
- Los diálogos de carpeta, abrir y guardar son los del sistema, los abre el lanzador (PowerShell en Windows; `zenity` o `kdialog` en Linux) y salen delante de la ventana (P3b).
- Renders, proyectos, importaciones, exportaciones y modelos los escribe el lanzador, solo donde la persona eligió en un diálogo; no sale la burbuja de descargas del navegador (P3b).
- En escritorio la página es solo la interfaz: ajustes, biblioteca, historial de resultados, miniaturas y modelos viven en la carpeta de datos del lanzador y no en el almacenamiento del navegador (P3e).
- El origen de la ventana ya no cambia en cada arranque (puerto estable por carpeta de datos), con lo que ajustes, biblioteca e historial **sobreviven a reiniciar**; antes se perdían (P3e).
- *Ajustes ▸ Almacenamiento* mide el espacio usado y la carpeta de datos con el lanzador, y *Liberar* pasa por él (P3e).
- La lista de tarjetas gráficas de *Ajustes* sale del lanzador, con las tarjetas reales del equipo (P3e).
- Ninguna fila de *Ajustes* habla del navegador en escritorio, y las filas ya no se pisan a ningún ancho ni tamaño de interfaz (P3e).
- El servidor de escritorio ya no manda como «inmutables» los ficheros de `assets/` que no llevan *hash*, así que un recurso regenerado no se ve viejo para siempre (A6).

### Visor y cola

- El modo Completo ya no se queda parado tras un rato de cambios. Causa: el visor retenía las seis conexiones que el navegador abre al lanzador y las peticiones esperaban sin fin (P3a).
- Nunca más «0 muestras» en silencio: un *watchdog* vuelve a arrancar el visor si se para y el medidor dice el motivo (P3a).
- El visor sigue vivo mientras se renderiza, compartiendo el equipo (*Completo · compartido con el render*). *Ajustes ▸ Motor de render ▸ Mientras se renderiza* elige entre mantenerlo vivo o pausarlo para renderizar más rápido (P3a).
- La cola se pausa y se reanuda: el botón dice *Pausar* mientras corre, *Reanudar* tras una pausa e *Iniciar cola* si no. *Pausar* libera el motor y *Reanudar* sigue donde estaba (P3a).

### Interfaz

- Arrastrar un material (una miniatura del catálogo o de *Míos*, o la esfera del material de la selección) sobre una pieza del visor o una fila del árbol lo asigna, con fantasma, resaltado y `Esc` para cancelar; una sola entrada de deshacer. En el visor llega a lo que seleccionaría un clic al nivel vigente (pieza, ensamblaje, modelo o cara). `Alt` al soltar da una copia propia. Si el destino lleva materiales distintos, se sigue preguntando en línea (U7).
- Selección por caja con *Seleccionar* y *Mover*: `Ctrl/⌘` + arrastrar sustituye la selección, con `Shift` añade y con `Alt` quita. De izquierda a derecha es una ventana (lo que queda entero dentro, contorno continuo) y de derecha a izquierda un cruce (lo que toca, contorno discontinuo), a nivel *Modelo*, *Grupo*, *Pieza* o *Caras*; el botón *Rayos X* coge también las caras ocultas. Con los esquemas del ratón que dejan libre el botón izquierdo, un arrastre sin más dibuja la caja. Sin `Ctrl/⌘`, el botón izquierdo sigue orbitando; `Ctrl/⌘` + arrastrar ya no desplaza con esas herramientas (U7).
- A nivel *Caras*, un clic coge la cara entera (la cara CAD en STEP e IGES; en el resto de mallas, la superficie que continúa). `Shift` clic añade un triángulo suelto, `Ctrl/⌘` clic mete o saca la cara y `Alt` clic la quita (M1).
- *Separar por caras CAD* deja de ser *próximamente*: está en el menú de pieza y parte una pieza de STEP o IGES en una por cara CAD, cada una con su color (M1).
- Los clics en el visor combinan con la selección que había: `Shift` añade, `Ctrl/⌘` mete o saca, `Alt` quita (U7).
- Ajustes ▸ Preferencias ▸ Visor y navegación ▸ Ratón y el tooltip de *Seleccionar* cuentan cómo se dibuja la caja, en español y en inglés (U7).

### Motor y entorno

- Vidrio de verdad: transmisión con IOR y rugosidad, absorción de color dentro del sólido (*Distancia de absorción*), paredes finas y recortes por opacidad (E5).
- Barniz sobre cualquier material, anisotropía y emisores que alumbran la escena (E5).
- Entorno nuevo: *Cielo* procedural con el sol del montaje, *Plano*, y *Archivo HDRI* con lectores propios de `.hdr` y `.exr`, con rotación e intensidad y muestreo por importancia (E5).
- *Imagen de fondo* (llenar, encajar, estirar), guardada dentro del proyecto (E5).

### Post-procesado con IA (a medias)

- Motor de la guarda: una biblioteca de Rust y su versión wasm que, a partir de los pases del render, comprueban que la IA no mueva aristas, no cambie los colores de los materiales ni emborrone lo enfocado, y limitan o rechazan lo que se pase (X3a).
- Descarga e instalación del motor de ejecución (stable-diffusion.cpp, compilaciones Vulkan y CPU para Windows y Linux) desde *Ajustes ▸ Post-procesado IA ▸ Motor de ejecución*, con progreso, pausa, reanudación y comprobación de `sha256`, y *Ejecutar con* (Automático, Vulkan o CPU) (X3b).
- El lanzador sabe arrancar el motor de ejecución como proceso auxiliar con progreso, cancelación y tiempo límite, y lo para al cerrar (X3b).
- La ventana de render estrena la sección **Post-procesado IA** (plegada y apagada): interruptor con el modelo en uso o el motivo por el que no puede, seis controles de 0 a 100 con su frase (*Intervención*, *Luz*, *Rebotes*, *Desgaste y microdetalle*, *Estilo*, *Fuerza del estilo*), las protecciones como fichas fijas con candado, *Otra variación* y una vista previa del modo Rápido con divisor antes y después que se actualiza al soltar un control y dice el tiempo medido. Hasta que llegue la tubería real (X3c) el interruptor dice *próximamente*; con `?ai=synthetic` corre un servicio sintético, sin modelo (X4).
- Un resultado con IA conserva las dos imágenes y el informe de la guarda: el visor las abre con el divisor (*Render | IA*) y una línea *Comprobado: geometría ✓ · materiales ✓ (ΔE máx 1,8) · resolución ✓ · enfoque ✓*, y la cola y el historial enseñan las dos miniaturas; en el escritorio la imagen de la IA es un fichero más del resultado (`<id>.ai.<ext>`) (X4).

### Recursos de estudio

- Datos preparados para las herramientas de estudio que vendrán: 16 prescripciones de lentes, 20 tipos de bokeh, 45 máscaras de diafragma, 12 gobos y 14 movimientos de cámara, todos generados por código del repositorio. Todavía sin interfaz (A6).

### Correcciones

- El inspector no se reconstruía al coger la primera cara de una pieza (M1).
- Asignar un material que el destino ya llevaba creaba una entrada de deshacer vacía (U7).
- El deslizador no seguía al valor al deshacer mientras tenía el foco: el campo cambiaba y la perilla se quedaba donde estaba (X4).
- Una vista del motor que el lanzador olvidaba o rechazaba no se volvía a pedir, y el bucle de animación se paraba para siempre con cualquier excepción (P3a).
- Un trabajo de render que entraba en pánico no terminaba nunca y bloqueaba al siguiente; ahora termina como fallido (P3a).
- Un servidor de IA que dejó un arranque anterior se paraba mal si la carpeta de datos está detrás de un enlace simbólico (X3b).
- Al reabrir en Windows con el puerto recordado aún en `TIME_WAIT`, se toma otro una vez en lugar de fallar (P3e).
- Arreglos solo de CI y pruebas, sin efecto en la aplicación (CI, X3b, P3e): la cadena de herramientas de Rust fijada a 1.97.0; el catálogo de pruebas del motor de IA entra por las opciones del servidor y no por un fichero que solo leía la compilación de depuración; la prueba del servidor huérfano esperaba mal el arranque del proceso (carrera con `vfork`); y la prueba de paridad del motor tenía una carrera al devolver el último marco.

### Limitaciones conocidas

- **El post-procesado con IA aún no genera ninguna imagen.** La interfaz está en la ventana de render, pero el interruptor dice *próximamente*: la tubería real es la fase X3c. Los modelos y el motor de ejecución (stable-diffusion.cpp) se pueden descargar e instalar, y nada más.
- Las compilaciones de Windows del motor de ejecución necesitan el entorno de **Visual C++ 2015–2022 (x64)**; no lo traen y el instalador todavía no lo instala. Si falta, *Ajustes* lo dice. Las de Linux necesitan glibc 2.38 o posterior. Descargarlo usa el `curl` del sistema (Windows 10 1803 o posterior); sin él, *Instalar desde un archivo…*.
- La comprobación de actualizaciones lee las releases públicas de GitHub: mientras el repositorio sea privado dirá que no encuentra versiones publicadas.
- **Nada de lo nuevo de escritorio se ha probado en un Windows real** (solo bajo Wine y con Chromium en Linux): la ventana de WebView2 y su cierre; que los diálogos salgan delante de la ventana; que el minimenú de Edge desaparezca del todo; la agrupación de la barra de tareas y el identificador de los accesos directos (Wine no deja leerlo); Edge hallado por *App Paths*; la memoria de vídeo con controladores reales; el instalador pulsado a mano; Vulkan con una tarjeta real; los ajustes que sobreviven a reiniciar; el modo Completo durante largo rato; y SmartScreen, porque el `.exe` no está firmado.
- En Windows, `repackshot --version` solo se ve con la salida redirigida (subsistema gráfico).
- En Linux la ventana sigue siendo la de Chromium en modo aplicación, con el endurecimiento de P3b; la ventana propia llega con P3d.
- El cielo es el de Preetham; el cielo físico propio es la fase E5c. En *Rápido* la imagen de fondo se pinta tal cual, y en *Completo* y en el render pasa por la exposición y la curva de tono. El vidrio muy rugoso pierde algo de energía y el macizo da cáusticas ruidosas con emisores pequeños. Los `.exr` con compresión PIZ, PXR24, B44 o DWA, en mosaico o profundos, se rechazan.
- A nivel *Caras*: el contador dice *caras* pero cuenta triángulos; la caja coge las caras de una sola pieza; el catálogo solo aparece con una cara seleccionada; y una cara plana junto a un redondeo muy suave puede seguir el redondeo en mallas que no son STEP ni IGES (M1, U7).
- Siguen las de v0.1.0: sin codificación de vídeo (las animaciones salen como secuencias de fotogramas), en STEP e IGES se supone Z arriba y no hay versión para macOS.

## v0.1.1 — 2026-10-13

### Ajustes

- **Actualizaciones**, una sección nueva encima de *Acerca de*: *Buscar
  actualizaciones* con el resultado en su fila, *Buscar al iniciar*
  (activado por defecto) y *Última comprobación*. Al arrancar comprueba
  en segundo plano y avisa en la barra de estado, con *Descargar* (el
  paquete de tu plataforma), *Notas* y *Más tarde*.

### Limitaciones conocidas

- La comprobación lee las releases públicas de GitHub de
  `Grohle-developer/Repackshot`; mientras el repositorio sea privado
  dirá que no encuentra versiones publicadas.
- Siguen las de v0.1.0; los arreglos de escritorio que pediste (visor
  vivo durante el render, cola que se pausa, ventana propia sin avisos
  del navegador, diálogos nativos, arrastrar materiales) llegan en la
  siguiente.

## v0.1.0 — 2026-10-13

Primera versión. Abre en modo estándar, con un estudio ya montado.

### Interfaz

- Tres columnas y un botón: escena, imagen e inspector; **Render…** abre la ventana de render (U1).
- Temas claro y oscuro, en blanco y negro; español e inglés, cambiables en caliente (U1).
- Visor de vista previa con three.js; selección en cuatro niveles; guía con flechas (U1).
- Deshacer y rehacer en todo el estado, con etiquetas en los dos idiomas (U1).
- Herramienta de mover con *gizmo*, pivotes, apoyar y centrar, con un solo deshacer por gesto (U3).
- Duplicar, enlazar, agrupar, patrones lineales y circulares, y operaciones de material y de geometría (U3).
- Menú contextual completo y atajos de teclado (U3).
- Biblioteca propia de materiales, montajes de luz, tipos de producto y estudios, con miniaturas, exportación e importación en JSON (U4).

### Motor

- Motor de render en Rust sin dependencias (`rt-core`, `rt-cli`, `rt-wasm`), con el formato de escena RSB y un PNG propio (E1).
- BVH de 4 u 8 ramas con SAH y recorrido SIMD (escalar, SSE2, AVX2 y simd128), con resultados bit a bit iguales (E2).
- Trazador de caminos con muestreo Sobol con *scrambling* de Owen, BSDF físico, luces de área y sol con NEE y MIS (E3).
- Cúpula de estudio, suelo y atrapasombras, fondo de color o transparente, y curvas de tono lineal, ACES, fílmica, AgX y estándar (E3).
- El motor corre en el navegador con un pool de workers y `rt.wasm`, con la misma imagen que la línea de órdenes (E4).
- Modo *Rápido* (vista previa) y *Completo* (trazador) en el visor, con conmutador en la cabecera (E4).
- Corrección de la potencia de las luces de panel: su flujo sigue la convención de Cycles (π/4 × potencia × tamaño²); antes daban π veces menos luz (corrección posterior a E4).

### Importación

- OBJ, STL (ASCII y binario), glTF y GLB, con soldadura, normales por ángulo y aristas vivas (I1, U1).
- STEP (AP203, AP214 y AP242) e IGES, con caras CAD, ensamblajes, colores y calidad de teselado ajustable (I2).
- FBX, 3DM, 3MF, PLY, DAE y USD (I3).
- Hoja de importación con unidades y eje detectados; aplica las unidades antes de añadir el modelo (I3).
- El Doctor ofrece ×1000 y ÷1000 cuando el archivo declara sus unidades (I1).
- Soltar un modelo sobre el estado vacío lo importa, lo apoya y lo encuadra (U1).

### Render y cola

- Ventana de render con *Imagen* y *Animación*; salida en PNG de 8 o 16 bits, JPEG y EXR lineal (U5).
- Plantilla de nombre, carpeta, tamaño en píxeles o en impresión, con ppp escritos en el PNG y el JPEG (U5).
- *Terminar por* muestras, por tiempo o por lo primero que ocurra (U5).
- Animaciones como secuencias de fotogramas; el vídeo queda *próximamente* (U5).
- Cola deshacible, con reordenar, editar, duplicar, pausar y ver los terminados (U5).
- Visor de resultados con zoom, datos, comparación con divisor e historial en IndexedDB (U5).
- *Render* usa siempre el trazador, también en el navegador (E4).

### Proyecto

- Guardar y abrir `.repack.json` con las mallas dentro; no depende de rutas externas (U2).
- Archivo recordado con File System Access: `Ctrl/⌘ S` guarda en él y `Ctrl/⌘ ⇧ S` pregunta dónde (U2).
- Cambios sin guardar: pregunta en línea y aviso al cerrar la pestaña (U2).
- Abrir valida el archivo antes de tocar nada; soltar un proyecto sobre la ventana lo abre (U2).

### Ajustes y modelos de IA

- Ventana de Ajustes con buscador, unos 57 ajustes y los grupos Aplicación, Render y Sistema (U6).
- Accesibilidad: tamaño de interfaz y de texto, contraste alto, reducir movimiento y anuncios para lectores de pantalla (U6).
- Gestor de modelos de IA: descargas por trozos que se reanudan y verificación por `sha256` (U6).
- Catálogo de siete modelos, con ficheros fijados a un *commit*, tamaños y `sha256` comprobados, y licencias citadas en `ai-licences.md` (X1, parte A).
- Recomendación de modelos según el equipo; importación con manifiesto que rechaza ficheros *pickle* (U6).

### Escritorio

- Lanzador propio `repackshot` en Rust, solo con la biblioteca estándar: abre la interfaz en una ventana de Edge o Chromium con perfil propio (P2).
- Servidor local solo en `127.0.0.1`, con *token* por arranque y comprobación de `Host` y `Origin` (P2).
- Motor nativo con todos los hilos del equipo, con el mismo resultado que el navegador (P2).
- Portable de Windows (zip), portable de Linux (tar.gz con binario estático) e instalador de Windows (NSIS, por usuario y sin administrador) (P2).
- El instalador deja elegir qué modelos de IA descargará la aplicación al arrancar (P2).
- Carpeta de datos propia, o `data/` junto al programa en modo portable (P2).
- Icono de la aplicación en blanco y negro, avisos de terceros incluidos, y `SHA256SUMS.txt` con las sumas de los paquetes (P2).
- Corrección: un proyecto vacío se renderiza ya en el motor nativo; antes el lanzador pedía mallas que no existían (fallo hallado en P2).

### Limitaciones conocidas

- Todavía no hay post-procesado con IA. Los modelos se pueden descargar y dejar preparados.
- No hay codificación de vídeo; las animaciones salen como secuencias de fotogramas.
- La versión de Windows se ha probado bajo Wine, no en un Windows real, y no está firmada: SmartScreen avisará al ejecutarla.
- En STEP e IGES se supone que el eje vertical es Z, porque el formato no lo declara.
- No existe versión para macOS.
