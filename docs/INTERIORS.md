# Interiores y mobiliario — investigación y decisión de integración

Qué hace falta para que Repackshot renderice **mobiliario en su contexto**
(un sofá en un salón iluminado por una ventana, una cocina con lámparas)
y **catálogos de mobiliario** (silos sobre blanco, variantes de tela,
alzados), y cómo se integra en el producto sin romper su idea: una sola
interfaz, un inspector contextual, un botón *Render*, cromo en blanco y
negro. Es un documento de decisión de Fable, hecho a partir de dos
investigaciones (producto y técnica) con fuentes públicas; las fases que
salen de aquí están en `ROADMAP.md` como **K1–K8**.

---

## 1 · Resumen y decisión

**No habrá un "modo interiores".** Se integra como lo hacen los
renderizadores que lo hacen bien: un **tipo de escena** (*Producto ·
Interior · Estudio de catálogo*) que solo cambia valores por defecto, una
**habitación** como nodo más de la escena, **ventanas que iluminan solas**
(portales automáticos, sin jerga), una **cámara de interiores** (verticales
rectas, altura de ojo, panorámica), un **Doctor** que detecta los errores
clásicos de principiante, y un motor con las cuatro o cinco técnicas que
de verdad importan en escenas cerradas. Todo con los mismos controles y en
el mismo sitio; lo que cambia es qué viene puesto.

Lo que no se hace: ReSTIR, bidireccional, Metropolis, cachés de radiancia,
redes neuronales de *denoise*. Ni dan en CPU/wasm lo que prometen en GPU
ni compensan su coste desde cero (ver §4).

---

## 2 · Lo que hacen los demás (observación de caja negra)

**KeyShot** trata los interiores como un *preset* del panel de luz
(*Performance, Basic, Product, Interior, Jewelry*): *Interior* está
"optimizado para iluminación interior", muestrea mejor HDRIs con fuentes
pequeñas e intensas como sol y cielo, y usa un reparto de muestras
distinto al de *Product*
([manual](https://manuals.keyshot.com/kss2026/en-us/manual/lighting.html),
[presets](https://manuals.keyshot.com/kss2026/en-us/manual/custom-lighting-presets.html)).
Las luces son **materiales** que se aplican a geometría (área, punto, IES,
foco, emisivo) en lúmenes, vatios o lux, con el aviso de que el modelo debe
estar a escala real
([blog](https://www.keyshot.com/blog/how-to-create-and-use-physical-lights-in-keyshot/)).
Las ventanas se resuelven con un plano detrás que lleva la vista como
etiqueta
([blog](https://www.keyshot.com/blog/how-to-create-perfect-window-views-for-interior-sces-in-keyshot/)).
La cámara tiene lente *Shift* para perspectiva de dos puntos con
*Estimar desplazamiento vertical*
([manual](https://manuals.keyshot.com/kss2025/en-us/manual/shift.html)),
modo *walkthrough* y lente panorámica 2:1
([cámaras](https://manual.keyshot.com/manual/cameras/)). Para interiores
sol y cielo recomienda la curva *Low Contrast*
([manual](https://manual.keyshot.com/?p=5600)). No tiene constructor de
habitación: se importa o se escenifica como *Model Set* siempre visible.
Un banco de pruebas independiente sitúa un interior en unas 500 muestras a
2K frente a 100 de un estudio simple
([Visune](https://visune.io/blogs/articles/keyshot-output-settings-what-should-you-use-in-2025)).

**V-Ray y Corona**: lo que la gente alaba es *LightMix* (cambiar
intensidad y color de cada luz **después** de renderizar, y sacar de un
render las variantes de día y de noche), la exposición y el balance de
blancos automáticos, y los muestreadores adaptativos de entorno que han
hecho casi innecesarios los portales manuales
([Chaos](https://blog.chaos.com/architectural-rendering-basics-interiors),
[CG Channel](https://www.cgchannel.com/2020/09/chaos-czech-releases-corona-renderer-6-for-3ds-max),
[Novedge](https://novedge.com/blogs/design-news/v-ray-tip-portal-lights-and-adl-optimize-daylight-interior-sampling)).
El primer paso de su flujo de interiores es el recorte de cámara para
poder ver dentro de la habitación.

**Cycles**: luces de área marcadas como *portal* sobre las aberturas
"reducen mucho el ruido en interiores" (más lentas por muestra, convergen
antes, inútiles en exteriores); árbol de luces; *shift* de cámara
equivalente a renderizar más campo y recortar descentrado, que mantiene
las verticales; *clamping*, *filter glossy* y guiado de caminos para
habitaciones iluminadas por una puerta
([luces](https://docs.blender.org/manual/en/4.5/render/cycles/light_settings.html),
[muestreo](https://docs.blender.org/manual/en/4.5/render/cycles/render_settings/sampling.html),
[cámaras](https://docs.blender.org/manual/en/4.5/render/cameras.html)).
Pega: portales y árbol de luces son controles de experto.

**Enscape, Twinmotion, D5, Lumion** (tiempo real para arquitectura):
bibliotecas de activos, sol por hora del día, exposición automática "al
pasar de interior a exterior", presets de calidad *exterior / mixto /
interior*, panorámicas 360 por lotes, vistas ortográficas en un clic
([Enscape](https://www.chaos.com/enscape/features),
[Twinmotion](https://dev.epicgames.com/documentation/twinmotion/ambience-settings)).
Pegas: sin terciopelo ni alfombras, luz menos fiel, dependencia de GPU.

**Estudios de CGI de mobiliario**: sus entregables son silos sobre blanco
(con alfa), silos con cotas, *lifestyle hero*, cambio de color
(*colourways*), inspiracionales, detalles, 360, vídeo
([lista](https://files.cgifurniture.com/uploads/cgi-content-checklist.pdf),
[tipos](https://cgifurniture.com/blog/lifestyle-shots-6-types/)). Un
fabricante hace sus renders de novedades "en unas horas" con KeyShot
([caso](https://www.keyshot.com/customers/ki-used-keyshot-to-cut-100k-furniture-rendering-costs/)).

**Lo que falla siempre**: la escala y las unidades (SketchUp 2026 exporta
FBX ×1000; glTF es metros y Y arriba), lentes demasiado angulares,
habitaciones oscuras por miedo a sobreexponer, ventanas quemadas sin
querer, lámparas encendidas de día, demasiadas luces físicas (*fireflies*)
([Poliigon](https://www.blog.poliigon.com/blog/7-mistakes-in-lighting-archviz),
[KeyShot](https://support.keyshot.com/en/knowledge-base/how-to-resolve-firefly-lights-in-keyshot-scenes),
[hilo SketchUp](https://forums.sketchup.com/t/sketchup-2026-fbx-export-model-units-problem/347178)).

---

## 3 · Decisiones de producto

### 3.1 · Tipo de escena, no modo

`scene.type ∈ {PRODUCT, INTERIOR, CATALOGUE}`, en la sección *Producto*
del inspector, encima del tipo de producto. Cambiarlo reescribe **valores
por defecto** y deja todos los controles donde están:

| | Producto (hoy) | Interior | Estudio de catálogo |
| --- | --- | --- | --- |
| Entorno | cúpula de estudio | sol y cielo por la ventana, o HDRI interior | cúpula blanca, ciclorama |
| Rebotes | 8–12 | 16–24 | 8 |
| Cáusticas | AUTO | OFF | OFF |
| Sombra de suelo | contacto | ninguna propia (la pone la habitación) | contacto suave |
| Transformada | Estándar / AgX | AgX con rodillo largo, *Low contrast* | Estándar |
| Exposición | fija (EV del preset) | **automática** + mando EV | fija |
| Muestras objetivo | 256 | 512 + adaptativo + *denoise* | 256 |
| Cámara | 85–100 mm, tres cuartos | 28 mm, altura de ojo 1,5 m, verticales rectas | 50 mm, alzado o tres cuartos |
| Unidades mostradas | mm | m y cm | mm |

**Hecho en K1** (`ROADMAP.md`): `scene.type`, con sus valores por defecto
aplicados al cambiar de tipo, las filas que existen hoy (entorno, rebotes,
cáusticas, sombra de suelo, transformada, muestras con adaptativo y
*denoise*, focal). Siguen sin aplicarse, por esperar a su fase o no ser del
proyecto: el ciclorama (K2), la exposición automática y el mando EV, la
altura de ojo y las verticales rectas (K3), el rodillo largo y *Low contrast*,
y las unidades mostradas (una preferencia de la aplicación).

**Hecho en K3**: *Interior* enciende la **exposición automática** y las
**verticales rectas** de la cámara activa, como dos casillas más del
mismo mecanismo (`image.exposureMode` y `camera.verticals:<id>`), y
volver de tipo las deja como estaban. La **altura de ojo no** se aplica
al cambiar de tipo: mover la cámara a 1,5 m cambia el encuadre que los
chequeos de K1 miden y el viaje de ida y vuelta de esos tests dejaba de
cuadrar; queda como presets en el inspector (◆ Fable, `ROADMAP.md` K3).

### 3.2 · La habitación es un nodo

Nodo `ROOM` paramétrico (fase K2), con lo mínimo que piden los flujos
reales: ancho, fondo y alto; **aberturas** (ventana o puerta) con
posición, tamaño y alféizar; un **material por superficie** (suelo,
paredes, techo); zócalo opcional; **ocultar la pared del lado de la
cámara** en un clic (el "recorte de cámara" de Chaos, hecho sin pensar
en planos de recorte); y una variante **ciclorama** para catálogo (suelo
que sube en curva a pared blanca, como `cyclorama_profile` en EZ
Packshot). Se edita en el inspector como cualquier pieza y se guarda en
el proyecto. Importar una habitación hecha fuera sigue valiendo: es lo
que hacen los profesionales (§2), y para ella funcionan la detección de
aberturas y el resto de lo de abajo.

### 3.3 · Las ventanas iluminan solas

Cada abertura de la habitación es, a la vez, el hueco visible y un
**portal** de muestreo del entorno (sol, cielo o HDRI) en el motor; el
usuario nunca ve la palabra. En habitaciones importadas, heurística:
cualquier cuadrilátero de vidrio o transparente en la envolvente se
trata como portal, y el Doctor avisa si hay sol o cielo y ninguna
abertura muestreable. El **vidrio de ventana** es un material fino que
no refracta y no bloquea sombras (como `thindielectric`), porque un
panel refractivo mata el muestreo explícito de luz y llena la imagen de
puntos. La **vista exterior** es una imagen en un plano detrás de la
ventana con paralaje opcional (la solución de KeyShot y de Lumion), no
un entorno completo.

### 3.4 · Cámara de interiores

- **Verticales rectas** por defecto en *Interior*: desplazamiento de
  lente (*shift*) calculado automáticamente de la inclinación, como
  *Estimar desplazamiento vertical*; se puede apagar.
- **Altura de ojo**: presets *de pie* 1,5 m y *sentado* 1,1 m; la
  cámara se mueve a ras de una altura, no alrededor de la pieza.
- **Ópticas**: 24, 28 y 35 mm como presets de interior; por debajo de
  18 mm el Doctor avisa de que estira los bordes.
- **Pared frontal oculta** y recorte cercano automático.
- **Vistas**: héroe a tres cuartos, esquina, alzado (ortográfica),
  planta (ortográfica desde arriba con el techo invisible a cámara pero
  presente para la luz: la visibilidad a cámara por objeto es
  imprescindible).
- **Panorámica** equirectangular 2:1 (y *fisheye*), que es el entregable
  clásico de interiores para clientes; en el navegador se renderiza por
  franjas.
- **Exposición**: un solo mando *Brillo (EV)* con **exposición
  automática** y presets (*Día luminoso* 7, *Tarde de lámparas* 5); ISO,
  obturador y diafragma en *Avanzado*. Un multiplicador de exterior solo
  para el rayo de cámara evita ventanas quemadas sin oscurecer la
  habitación.
- **Recorrido** (*walkthrough*): WASD y ratón con altura fija, para
  encontrar el encuadre; se añade a la herramienta de vista.

**Hecho en K3** (`ROADMAP.md`, con los números): verticales rectas
(apagables, con el *shift* que sale de la inclinación escrito en el
*shift* de la óptica de O1), presets de altura de ojo y de ópticas de
interior, *Visible a cámara* por pieza (vista previa y RSB, bit
`INSTANCE_NO_CAMERA`), alzado y planta ortográficos, panorámica
equirectangular y *fisheye* (la vista previa por las seis caras de un
cubo, el motor con proyecciones propias en `CAMR`), exposición automática
con *Brillo (EV)* y presets, y el multiplicador de exterior en el rayo de
cámara. **No** se hizo: el recorrido WASD (lo cubre N3), el render por
franjas de la panorámica (es K6; el motor la renderiza entera), ISO y
obturador en *Avanzado*, la pared frontal oculta y el recorte cercano
automático (K2, con el nodo `ROOM`).

### 3.5 · Luz y materiales de mobiliario

- Catálogo de montajes: nuevo estilo **Interior** con *Ventana de
  mañana*, *Ventana de mediodía*, *Ventana de tarde*, *Nublado*,
  *Lámparas de noche*, *Hora azul* (lámparas y cielo equilibrados) y
  *Sala blanca de estudio*; cada uno fija sol o cielo o HDRI, exposición
  y curva. *(Hecho en K1: las siete recetas fijan su mundo, sol y cielo o
  la cúpula de estudio, y su exposición; la curva y el HDRI no, y sus cifras
  son una propuesta pendiente de decisión.)*
- Luces físicas: las de L4 más **IES** (L5) y tiras y paneles emisivos
  muestreados por ángulo sólido.
- **Grupos de luz** con intensidad y color editables **después** del
  render (K8, al estilo *LightMix*): día → atardecer → noche de un solo
  render. Exige pases por grupo en el motor; es lo que más valoran los
  usuarios de V-Ray y Corona.
- Materiales: **terciopelo** (sheen y retrodispersión), **trama a escala
  real** (hilos por cm o DPI, que es como lo introducen los fabricantes),
  chapa de madera, cuero, **pelusa con tope** de fibras. Lo cubren E6, R·
  y el *sheen* del BSDF.

### 3.6 · Doctor de interiores

Chequeos nuevos, cada uno con arreglo de un clic y ligado a un fallo
documentado: escala (caja envolvente frente a tamaños plausibles de
mueble y habitación, aviso de unidades); habitación cerrada con sol o
cielo y sin abertura muestreable; vidrio de ventana grueso o refractivo;
luces demasiado débiles o en unidades implausibles (y *emisivo no es una
luz*); exposición (media oscura o ventanas quemadas, con sugerencia de
auto-exposición y curva de bajo contraste); riesgo de ruido (cáusticas
encendidas, muchas luces físicas, pocas muestras); cámara inclinada sin
*shift*, óptica por debajo de 18 mm, altura de ojo implausible, recorte
cercano dentro de una pared; normales de pared invertidas o de una cara;
escala de textura o grano fuera de unidades reales y pelusa por encima
del presupuesto. *(Hecho en K1, los que no piden el motor: escala y
unidades, abertura ausente con sol o cielo, vidrio grueso, óptica por debajo
de 18 mm, altura de ojo, recorte cercano y normales invertidas; los demás
esperan al motor o a K2.)*

### 3.7 · Entregables de mobiliario

Silo sobre blanco con alfa (y con cotas), *lifestyle*, hoja de
**variantes de tela y acabado** de una sola escena (*colourways*),
panorámica 2:1, alzados y planta, EXR con pases e **id de pieza**
(máscaras), 2K y 4K, plato giratorio, hoja de contactos. Los lotes
cámaras × estudios × variantes de N2 cubren la producción.

### 3.8 · Activos de ejemplo

Solo CC0 o con atribución registrada por archivo: **Poly Haven** (521
modelos, 85 de mobiliario; [licencia](https://polyhaven.com/license)),
**ambientCG** (texturas de tela y madera;
[licencia](https://docs.ambientcg.com/license/)). **Ningún HDRI de
terceros**: los entornos son recetas propias generadas por nuestro motor
(`STUDIO-TOOLS.md` §2),
**Kenney** (kit de mobiliario CC0). **Khronos** (SheenChair,
GlamVelvetSofa) es CC-BY 4.0 y exige atribución. **No** se empaqueta
nada de Quaternius (licencia propia que prohíbe redistribuir) ni del 3D
Warehouse de SketchUp. Sweet Home 3D es inspiración de caja negra (GPL).
La habitación de ejemplo del producto se genera por procedimiento, como la
botella.

---

## 4 · Decisiones técnicas del motor

Resumen de la investigación técnica, con el veredicto por técnica. Las
fuentes están en las referencias de cada punto.

**Conjunto mínimo para que un interior salga bien** (unas 12 semanas de
un ingeniero fuerte, en este orden):

1. **Geometría robusta a escala de habitación**: triángulos *watertight*
   y recorrido robusto (ya en E2), desplazamiento de origen de rayo por
   ULP en lugar de épsilon (Wächter y Binder 2019,
   [NVIDIA](https://research.nvidia.com/publication/2019-03_fast-and-robust-method-avoiding-self-intersection)),
   BVH de dos niveles con instancias para mobiliario repetido. En `f32` a
   16 m un ULP es ~1 µm: el milímetro está a salvo; el problema son los
   desplazamientos, no la precisión.
2. **Fuentes de luz**: sol como disco propio (0,53°) con muestreo de cono
   y excluido del entorno; cielo **Hošek–Wilkie**
   ([proyecto](https://cgg.mff.cuni.cz/projects/SkylightModelling/); el
   código de referencia circula con cabecera BSD-3; E5c no lo usa: toma
   solo la forma funcional y ajusta los coeficientes a un simulador
   propio, en sala limpia; Preetham queda como *Clásico*) o HDRI
   con CDF 2D; rectángulos y discos por ángulo sólido (Ureña 2013); IES;
   vidrio fino.
3. **Portales** declarados desde la habitación y por heurística de
   vidrio (Bitterli, Novák y Jarosz 2015,
   [paper](https://cs.dartmouth.edu/~wjarosz/publications/bitterli15portal.html);
   una tabla de área sumada por portal, 8 MB a 2048 × 1024), con MIS
   contra el BSDF.
4. **Árbol de luces** (Conty y Kulla 2018,
   [SIGGRAPH](https://history.siggraph.org/learning/importance-sampling-of-many-lights-with-adaptive-tree-splitting);
   nodo compacto como en pbrt-v4): elegir lámpara por contribución
   estimada, no por potencia; con ≤ 8 luces se muestrean todas. Punto
   ciego conocido: no sabe de visibilidad; etiquetas de habitación para
   podar lámparas de otra sala.
5. **Fireflies y muestreo adaptativo**: *clamping* separado de directo e
   indirecto en unidades de exposición, regularización tras el primer
   rebote no especular (pbrt-v4, Kaplanyan 2013), ruleta rusa tras
   profundidad 1, 8–12 rebotes difusos; muestreo adaptativo por error de
   dos medios búferes (Rousselle 2012) en bloques de 8 × 8 con recuentos
   por píxel para el *denoise*.
6. **Denoise propio**: pases AOV (albedo del primer rebote no especular,
   normal, profundidad, varianza, recuento), filtrado de la irradiancia
   **demodulada** (si no, se emborronan las texturas) con *à-trous*
   guiado por varianza (Dammertz 2010; la parte espacial de SVGF sin
   reproyección, Schied 2017). Esperable: bueno en habitaciones difusas
   desde 16–64 muestras; emborrona reflejos brillantes y bordes del
   parche de sol. Un CNN tipo OIDN queda fuera (conjunto de
   entrenamiento, inferencia en wasm).
7. **Cámaras**: *shift*, equirectangular, *fisheye*, ortográfica con
   visibilidad a cámara por objeto; EV100 y *filmic*/AgX con rodillo
   largo; multiplicador de exterior en el rayo de cámara.

**Ampliación, en orden**: **guiado de caminos** con árbol SD (Müller,
Gross y Novák 2017, [proyecto](https://jannovak.info/publications/PathGuide/index.html);
sin hiperparámetros, 15 MB en su cocina de prueba, encaja en workers
sin memoria compartida porque la estructura se congela por iteración; la
implementación de referencia es GPL y Open PGL es Apache con TBB: **solo
la idea**), que además aprende los portales solo; heurística o mapa de
visibilidad para portales automáticos; *denoise* NFOR; SPPM o MNEE para
cáusticas de lámparas y vidrio; cielo con atmósfera (Bruneton, Hillaire,
código BSD/MIT); aislamiento de origen cruzado (`coi-serviceworker`, MIT)
para una sola copia de escena por pestaña.

**No**: ReSTIR en todas sus variantes (régimen de 1 muestra y miles de
luces en GPU; ninguna implementación CPU/offline; exige reservorios y
G-buffer por píxel e intercambio entre workers), BDPT/VCM/UPS (en la
cocina de prueba del guiado "le cuesta construir subcaminos de luz a
través de la ventana", y necesita *splats* de imagen de luz por worker),
Metropolis (convergencia desigual que rompe *denoise* y adaptativo),
cachés de irradiancia (sesgo y ajuste; el *denoise* las hace
redundantes), cachés neuronales (GPU).

**Cáusticas**: lo que se le dice al usuario: *"La luz enfocada por
vidrio (sol sobre una mesa de cristal, pantallas de lámpara de vidrio)
está apagada por defecto: el vidrio se ve, los parches de luz enfocada
salen suaves o no salen."* Opciones por coste: vidrio fino sin refracción,
regularización (manchas suaves, sesgada), SPPM, MNEE.

**Presupuestos de convergencia** (estimaciones a 1080p, ~10 rayos por
muestra; nativo 4 núcleos a 8–16 M rayos/s, 4 workers a un tercio;
recalibrar con E3):

| Caso | Muestras | Nativo 4 núcleos | 4 workers |
| --- | --- | --- | --- |
| Primera previa 960 × 540 con *denoise* | 8 | 3–5 s | 8–15 s |
| Con *denoise*, sin guiado | 64 | 1,5–3 min | 4–8 min |
| Con *denoise*, sin guiado | 256 | 6–11 min | 17–33 min |
| Limpio sin *denoise*, sala con sol | 1024 | 22–44 min | 1–2 h |
| Guiado + *denoise*, calidad de 256 | 85–170 | 2–9 min | 6–28 min |

Una panorámica 8192 × 4096 cuesta 16 veces 1080p: por franjas y en
`f16` en el navegador. Memoria wasm: 4 GB de techo; sin memoria
compartida cada worker tiene su copia de la escena, así que el
presupuesto es ~400–500 MB por worker en escritorio y 150–250 MB en
móvil; BVH ≈ 100–150 MB por millón de triángulos; texturas a 8 bits y
2K salvo excepción. Escenas públicas para medir: Veach Ajar, Country
Kitchen, White Room, Modern Hall
([Bitterli](https://benedikt-bitterli.me/resources/), CC0 / CC-BY).

**Renderizadores libres de los que aprender ideas (nunca código)**:
Cycles (Apache-2.0: árbol de luces, portales, guiado vía Open PGL,
adaptativo), LuxCoreRender (Apache-2.0: bidireccional, grupos de luz,
"portales sin portales"), Mitsuba 3 (BSD con cláusula: `thindielectric`,
`sunsky`), pbrt-v4 (Apache-2.0: árbol de luces, portales, `regularize`),
appleseed (MIT). La guía práctica (`practical-path-guiding`) y Mitsuba
0.6 son GPL: ni mirarlos.

---

## 5 · Fases nuevas (resumen; el detalle está en `ROADMAP.md`)

| Fase | Responsable | Qué | Depende de |
| --- | --- | --- | --- |
| **K1** (hecha) | Sonnet | Tipo de escena con sus valores por defecto; estilo *Interior* del catálogo de luz; Doctor de interiores (chequeos de escena) | U1, L4 |
| **K2** | Opus | Nodo habitación paramétrico con aberturas, materiales por superficie, pared frontal oculta, ciclorama; portales automáticos (declarados y heurísticos); vidrio fino; vista exterior con paralaje | U3, I3 |
| **K3** | Opus | Cámara de interiores: *shift* automático, altura de ojo, ópticas, visibilidad a cámara por objeto, ortográfica para alzados y planta, panorámica, exposición automática y EV, recorrido | U1, E3 |
| **K4** | Opus | Motor interior, conjunto mínimo: desplazamiento ULP y BVH de dos niveles, sol disco y cielo, luces por ángulo sólido, portales, árbol de luces, *fireflies* y adaptativo, AOV y *denoise* à-trous demodulado | E5, K2 |
| **K5** | Opus + Fable | Guiado de caminos con árbol SD (la idea, no el código), y portales automáticos por visibilidad | K4 |
| **K6** | Sonnet | Entregables de mobiliario: silo con alfa y cotas, hoja de variantes, panorámica por franjas, alzados, lote por variantes | K3, N2 |
| **K7** | Sonnet | Habitación de ejemplo procedural y activos CC0 con licencia registrada por archivo; hoja de contactos de interiores | K2 |
| **K8** | Opus | Grupos de luz con intensidad y color tras el render (*LightMix*): pases por grupo en el motor y mezclador en la interfaz | K4 |

**Decisiones pendientes de Fable**: ~~licencia exacta de las tablas de
Hošek–Wilkie~~ (resuelto en E5c: no se usan; el cielo es propio, con la
forma funcional publicada y coeficientes ajustados a nuestro simulador de
atmósfera); si se activa el aislamiento
de origen cruzado para compartir la escena entre workers; a partir de
qué número de luces entra el árbol.
