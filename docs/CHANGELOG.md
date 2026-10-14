# Registro de cambios

Cada versión lista lo que trae, agrupado por áreas. Entre paréntesis, la
fase del roadmap (`ROADMAP.md`) de donde sale cada línea.

## Sin publicar

### Escritorio

- **Actualizar desde la aplicación** (P5): *Ajustes ▸ Actualizaciones ▸ **Instalar y reiniciar*** (y el mismo botón en el aviso de la barra de estado) descarga la versión nueva, comprueba su SHA-256 contra el `SHA256SUMS.txt` de la release, la instala y reinicia la aplicación con ella, sin pasar por el navegador. En **Windows instalado** ejecuta el instalador en silencio (`/S /LAUNCH`: espera a que la aplicación se cierre, instala y la vuelve a abrir); en un **portable** (Windows y Linux) extrae el paquete junto al programa y sustituye los archivos en el sitio —el ejecutable en uso se renombra a `.old`, `data/` y `portable.txt` no se tocan, y si algo falla a medias queda lo viejo donde estaba—, y la versión nueva borra los `.old` al arrancar. Solo se descarga de las releases del repositorio de la aplicación (`github.com/<owner>/<repo>/releases/download/…`); una suma que no cuadra no instala nada. La fila enseña *Descargando… 45 % · 3,2 de 7,1 MB*, *Comprobando…* e *Instalando…*, los fallos con su motivo y *Reintentar*, y *Cancelar la actualización*; cerrar *Ajustes* no la para. La web sigue con *Descargar*, que abre la página de la versión. La primera actualización desde la aplicación será de la versión que lleve esto a la siguiente (P5).
- El instalador de Windows, en silencio, espera hasta 30 s a que `repackshot.exe` quede libre, no toca la elección de modelos de IA ni recrea un acceso directo del escritorio que se borró, y con `/LAUNCH` abre la aplicación al terminar (P5).

### Interfaz

- **La pregunta por los cambios sin guardar** gana **Guardar como…** (con el diálogo) en todos sus usos —cerrar, *Nuevo*, *Abrir* y actualizar—: *Guardar · Guardar como… · No guardar*, y *Cancelar* o `Esc`. *Guardar* y *Guardar como…* siguen solo si el proyecto se escribió de verdad. En *Ajustes*, `Esc` cancela una pregunta abierta en lugar de cerrar la ventana (P5).
- La lista de cámaras del visor (arriba a la derecha) enseña la óptica de cada cámara (*85 mm · f/5.6*) y un **lápiz** por fila que abre la ficha de esa cámara en el inspector (nombre, *Activar*, *Mirar a través*, óptica y posición) con la pestaña *Cámaras* abierta; y la sección *Cámara* del inspector de escena dice **qué cámara edita** (la activa, por su nombre), con el mismo lápiz y una nota de que cada cámara tiene su óptica y su posición (aviso del usuario: no se veía que se estuviera editando *Cámara 1*).
- **Texturas de imagen** (M2a): el inspector de un material gana la sección **Texturas**, con seis ranuras —*Color*, *Rugosidad*, *Metal*, *Normal*, *Alfa* y *Emisión*—, cada una con su vista previa, *Cargar…* (PNG o JPEG; el diálogo del sistema en escritorio) y *Quitar*, y cómo lee su imagen (canal, invertir, intensidad del mapa de normales o de alturas, recorte y umbral del alfa, tinte e intensidad de la emisión); y un **mapeado** común: *Proyección* (*UV · Caja · Plana · Cilíndrica · Esférica*), eje, juego UV, tamaño en mm con *Ajustar a la pieza*, giro, desplazamiento, repetición y bordes. Todo deshacible, un arrastre una entrada (M2a).
- **Etiquetas** (M2a): *Añadir etiqueta…* elige una imagen con alfa, y una pulsación sobre la pieza con un arrastre la coloca allí (plana desde la normal de la superficie, derecha) con su ancho; varias por material, en orden (*Traer delante*, *Enviar atrás*), con ancho, giro, alcance y su acabado (rugosidad, barniz, relieve del papel); **Mover etiqueta** la desliza por la superficie (M2a).
- La vista **Rápido** dibuja todas las ranuras, las cinco proyecciones (la caja mezcla tres ejes, la cilíndrica y la esférica sin costura visible) y las etiquetas, con mipmaps, sobre el aspecto de siempre (luces, entorno, sombras, contorno). *Completo* y *Render* las pintan cuando el motor las lea (*próximamente*, M2b) (M2a).
- La **hoja de importación** gana la sección **Texturas**: cuántas imágenes se guardan y cuánto pesan, y cada una que no, con el porqué (M2a).
- **Salida en TIFF y en RAW (DNG)** (U12): la ventana de render ofrece **TIFF** —sin compresión, con *8 bits*, *16 bits* (sRGB) o *32 bits flotante* (luz lineal con la exposición del render, como el EXR), con fondo transparente y los DPI de la ventana como resolución— y **RAW (DNG)** —un DNG 1.4 lineal en coma flotante que un revelador de raw abre como el de una cámara, con toda la latitud del render y sin alfa—, cada uno con una línea de ayuda. El nombre acaba en `.tif` o `.dng`; el visor de resultados y las miniaturas usan una copia PNG de 8 bits del mismo render (los navegadores no muestran TIFF ni DNG); *Guardar de nuevo* escribe el archivo. Los ajustes antiguos abren igual, y *Preferencias ▸ Render ▸ Formato* ofrece los dos (U12).

- **La proporción de la imagen es de la cámara** (U13): cada cámara lleva la suya —*3:2*, *4:3*, *16:9*, *1:1*, *5:4*, *4:5*, *9:16*, *21:9*, *2:1*, *65:24* panorámica o *Propia* con su `w : h`—, en una fila **Proporción** de la sección Cámara y de la ficha de cada cámara (deshacible). El **marco del visor** sigue a la cámara que se ve, el chip de arriba a la derecha dice la proporción con el tamaño (*16:9 · 1920 × 1080*) y la lista de cámaras la pone tras la óptica. La **ventana de render** lee y escribe la misma: en una imagen el ancho se conserva y el alto sale de la proporción de la cámara activa; un tamaño que la rompe (los dos lados, o uno con el candado abierto, o un preset de tamaño de otra proporción) la reescribe en la cámara y la ventana lo dice en una línea (*La proporción de Cámara 1 pasa a 4:3*). *Nueva desde la vista actual* copia la proporción; cada cámara conserva la suya al cambiar la activa; un trabajo para otra cámara sale con el alto de esa cámara. La animación conserva su tamaño propio y el Doctor gana **Proporción de la animación**, que avisa de los planos cuya cámara tiene otra proporción (y lo arregla).

### Importación

- glTF y GLB traen sus **materiales con sus mapas** leídos de su JSON (color base, metal-rugosidad, normal con su escala, emisión con su factor y `KHR_materials_emissive_strength`, alfa con su modo y umbral; transmisión, IOR y barniz de sus extensiones; `KHR_texture_transform`); OBJ lee sus **`.mtl`** y sus imágenes (con `-s`, `-o`, `-bm`, `-clamp`, `-imfchan`); FBX, Collada, 3MF, USD y 3DM, los mapas que carga su lector. Las imágenes y bibliotecas que un modelo nombra se buscan entre los archivos **elegidos o soltados con él**; *Importar modelo…* deja elegir varios (M2a).
- Las **UV** se conservan, también un **segundo juego** (glTF `TEXCOORD_1`), y las normales por vértice del archivo (M2a).

### Proyecto

- Las cámaras guardan su proporción (`aspect`); un proyecto de antes la toma del tamaño de render que guardó (el preset que cuadra con un 0,5 %, si no *Propia* con esos píxeles) y conserva ese tamaño (U13). Abrir un proyecto vuelve a calcular las comprobaciones del Doctor con el catálogo de esta versión, también al leer solo el estado.
- Las imágenes de textura **viajan en el proyecto** tal cual (PNG o JPEG, base64), una vez cada una, bajo un id que nombra su contenido: un proyecto guardado y abierto vuelve con los mismos bytes. Hasta 16 MB por imagen y 64 MB por proyecto. Los proyectos anteriores abren igual (M2a).

### Motor

- El **contrato RSB de las texturas** queda escrito para M2b (`ARCHITECTURE.md` §5.2: sección `IMGS`, bloque de texturas de `MATL` desde el byte 100, UV en `MESH`); el escritor lo produce solo cuando se le pide, y hasta entonces los bytes de cualquier escena son los de antes (M2a).
- `rt-core::tiff` y `rt-core::dng`, los escritores de TIFF 6.0 y DNG 1.4 de la salida, solo con `std` y de la especificación pública; la interfaz escribe los mismos bytes (`encodeTiff`, `encodeDng`), con los archivos de `tests/fixtures/tiff/` como prueba de paridad. `rt` escribe `--format tiff` (con `--bits 8|16|32`) y `--format dng`, o por la extensión de `-o`; el lanzador guarda esos resultados y deja escribir `.tif`, `.tiff` y `.dng` (U12).

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
