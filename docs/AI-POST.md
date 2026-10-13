# Post-procesado IA — decisión, protecciones e interfaz

Un paso **opcional** después del render: un modelo de imagen de pesos
abiertos, ejecutado en el equipo del usuario, mejora la imagen (luz más
natural, rebotes, desgaste y microdetalle, o un estilo) **sin cambiar
nunca la geometría, los materiales, la resolución, la profundidad de
campo, el encuadre ni nada que no se haya pedido**. El usuario decide
cuánto interviene el modelo con controles sencillos, lo ve antes en una
vista previa, y al terminar tiene las dos imágenes —la del motor y la de
la IA— para compararlas con un divisor deslizable. Fases **X1–X5** en
`ROADMAP.md`. Investigación de modelos y motores de ejecución con fuentes
a fecha 2026-10-13; las licencias se vuelven a verificar en X1 antes de
publicar nada.

---

## 1 · Principios

1. **El render del motor es la verdad.** La IA es un acabado opcional y
   nunca sustituye al motor: la imagen del motor se guarda siempre, y el
   post-procesado se puede apagar, rehacer o descartar.
2. **Nada que no se pida.** Cada aspecto que la IA puede tocar tiene su
   control, y a 0 ese aspecto no cambia. Lo demás está **protegido** y no
   se puede desproteger desde la interfaz normal: geometría, materiales
   (color y acabado), resolución, profundidad de campo, encuadre, texto y
   logotipos.
3. **Las protecciones no dependen del modelo.** No se confía en que un
   modelo generativo "obedezca": la imagen que sale del modelo pasa por
   una **guarda determinista** (§3) que solo deja pasar los cambios
   permitidos y comprueba el resultado con números. Cambiar de modelo no
   afloja ninguna protección.
4. **Local y privado.** Todo se ejecuta en el equipo; la imagen no sale
   de él. Nada se sube a ningún servidor.
5. **Honestidad.** Si el equipo no puede ejecutar el modelo, el
   interruptor aparece deshabilitado con el motivo. Si la guarda tuvo que
   limitar la intervención para respetar las protecciones, se dice cuánto.

---

## 2 · El modelo y dónde se ejecuta

### 2.1 · Modelo por defecto: Z-Image-Turbo

**Decisión provisional, a confirmar en X1** con una comparación visual
propia (no hay ninguna prueba pública que mida "mejorar un render sin
cambiar su estructura"):

| | |
| --- | --- |
| Modelo | **Z-Image-Turbo** (Tongyi-MAI), transformador de difusión de 6,15 B parámetros con codificador Qwen3-4B, noviembre de 2025 |
| Licencia | **Apache-2.0** en modelo, codificador y ControlNet: uso comercial y redistribución permitidos, así que no limita cómo distribuye el autor el producto (ni siquiera si lo vende) |
| Por qué | Entre los modelos pequeños con licencia permisiva es el único que tiene a la vez *img2img* nativo con `strength` (la intervención se controla con un número) y **ControlNet de la misma licencia** (profundidad, bordes, *tile* hasta 2048²); el mejor de los Apache en las clasificaciones públicas de texto a imagen; versión ONNX cuantizada publicada para el navegador |
| Cuantización | Escritorio: GGUF Q8_0 (6,6 GB) con ≥ 12 GB de VRAM, Q4_0 (3,7 GB) con 6–8 GB; codificador Q4_K_M (2,5 GB). Navegador: ONNX q4f16 (≈ 6 GB en total) |
| Velocidad orientativa | Segundos por imagen de 1024² en una GPU de gama media-alta; *img2img* a intervención baja ejecuta solo una fracción de los pasos. Cifras sin verificar: se miden en X1 |

**Alternativas**, que el usuario puede descargar desde Ajustes:
**FLUX.2 [klein] 4B** (Apache-2.0; más ligero, bueno en ediciones por
instrucción, sin `strength` ni ControlNet oficial) y, solo en
escritorio, **Qwen-Image-Edit-2511** (20 B, Apache-2.0; edición
"profesional" con LoRA de iluminación, ≈ 18 GB cuantizado).

**No pueden ser modelo por defecto** porque su licencia prohíbe el uso
comercial o la redistribución de los pesos: Qwen-Image-2.1 (el mejor en
las clasificaciones abiertas, licencia de investigación), FLUX.1
Kontext/Krea/dev, FLUX.2 dev y klein 9B, SD-Turbo y SDXL-Turbo, IC-Light
V2, SD 3.5 (tope de ingresos). Un usuario puede importarlos por su cuenta
(§5): quedan marcados *no apto para uso comercial* y la licencia es
suya.

### 2.2 · El instalador elige el modelo, con una recomendación por equipo

Los pesos ocupan varios GB, así que **no van en el repositorio ni en la
página web**: el repositorio no contiene pesos. El modelo **se elige al
instalar**:

- **Instalador de escritorio (P2)**: un paso *Modelos de IA* muestra la
  lista recomendada de §2.4, **detecta el equipo** (GPU y su VRAM, o la
  RAM si se elige ejecutar en CPU) y **marca uno como *Recomendado para
  tu equipo***. El usuario puede elegir ese, otro, varios o **ninguno**
  (instalar sin IA). Cada fila dice tamaño de descarga, licencia, calidad
  esperada y velocidad orientativa; la licencia se muestra antes de
  descargar. La detección y la recomendación las hace el propio lanzador
  de la aplicación (`repackshot --hardware`), con los mismos datos y la
  misma regla que la interfaz, así que el instalador y *Ajustes*
  recomiendan siempre lo mismo.
- **Decidido: el instalador elige, la aplicación descarga.** El
  instalador deja la elección en la carpeta de datos y termina en
  segundos; la aplicación empieza a descargar lo elegido desde el primer
  arranque, en *Ajustes ▸ Post-procesado IA ▸ Modelos* (`UI.md` §2.9),
  con progreso, pausa, reanudación tras cerrar y `sha256` por fichero
  (fijado en `src/data/ai-models.json`). Varios GB dentro de un
  instalador no se pueden pausar ni reanudar, lo bloquean, y un corte lo
  deja a medias; así además la descarga es la misma en web y escritorio.
- **Versiones portables** (escritorio sin instalar): no hay instalador,
  así que el mismo selector aparece una vez en el primer arranque, como
  en la web.
- **Versión web**: no hay instalador, así que la misma lista y la misma
  recomendación aparecen la primera vez que se activa el post-procesado y
  en *Ajustes ▸ Modelos de IA*, filtradas a lo que puede ejecutarse en el
  navegador (WebGPU); se guarda en el almacenamiento privado del navegador
  (OPFS, con `navigator.storage.persist()` para que no lo borre).
- Después, en todos los casos, *Ajustes ▸ Post-procesado IA ▸ Modelos*
  permite descargar **los mismos modelos que ofrecía el instalador**,
  importar uno propio (§5), configurar el activo o borrar.

### 2.3 · Motores de ejecución

- **Navegador**: **ONNX Runtime Web** (MIT) con WebGPU, en workers (uno
  por etapa: codificador de texto, transformador, VAE, que se terminan al
  acabar para liberar la GPU), pesos troceados en fragmentos de ≤ 1 GiB
  (los navegadores limitan los búferes a 1–2 GiB y ONNX Runtime Web a
  4 GB por modelo). WebGPU está en Chrome y Edge (Windows, macOS,
  ChromeOS, Android; Linux solo con ciertas GPU), Safari 26 y Firefox en
  Windows y macOS; donde no hay WebGPU, no hay post-procesado.
- **Escritorio (P2)**: **decidido (2026-10-13, §7.1)**: todo en nativo.
  La inferencia la hace **stable-diffusion.cpp** (MIT, ggml: Vulkan y
  CPU) como **proceso auxiliar** que gobierna el lanzador y que lee los
  GGUF fijados en `ai-models.json` y los que importe el usuario; la
  guarda y todo el trabajo con píxeles, el *crate* `rt-post` (§7.2).
  ONNX Runtime nativo queda descartado en escritorio: los ficheros
  fijados son GGUF.
- **Separado del motor de render.** El post-procesado vive en
  `engine/crates/rt-post` (la guarda, Rust sin dependencias), en el
  lanzador (la tubería de escritorio y el proceso auxiliar) y en
  `src/ai/` (el conductor web y el *prompt*). `rt-core` sigue sin saber
  que la IA existe; su única aportación son los **pases** (§3.1).
- **Lo que no es posible y se dice**: un modelo de 12–20 B en una pestaña
  del navegador (supera los límites de memoria), ni el post-procesado sin
  WebGPU en un tiempo razonable. Mensaje: *"El post-procesado IA necesita
  una tarjeta gráfica con WebGPU y varios GB de memoria libre. Este
  navegador o este equipo no pueden ejecutarlo. Tu imagen nunca se sube a
  ningún sitio. Usa la aplicación de escritorio, elige un modelo más
  ligero o deja la IA apagada: tu render no cambia."*

### 2.4 · Lista recomendada y regla de recomendación

La lista sale de la investigación del 2026-10-13. Vive como datos en
`src/data/ai-models.json` (claves estables, ficheros con URL, tamaño y
`sha256`, licencia, requisitos, y la regla de recomendación como tabla),
para que X1 corrija umbrales y tiempos con medidas reales sin tocar
código. Es JSON y no TypeScript porque lo leen dos programas: la
interfaz y el lanzador de escritorio que usa el instalador; los dos
evalúan la tabla igual y lo prueba un mismo fichero de casos. Tamaños de descarga aproximados, sumando transformador,
codificador de texto y VAE.

| Clave | Modelo y cuantización | Descarga | Licencia | Para qué |
| --- | --- | --- | --- | --- |
| `ZIMAGE_Q8` | Z-Image-Turbo GGUF Q8_0 + Qwen3-4B Q4_K_M | ≈ 9,3 GB | Apache-2.0 | **Calidad máxima del modelo por defecto** |
| `ZIMAGE_Q4` | Z-Image-Turbo GGUF Q4_0 + Qwen3-4B Q4_K_M | ≈ 6,4 GB | Apache-2.0 | Equilibrio calidad / memoria |
| `ZIMAGE_Q2` | Z-Image-Turbo GGUF Q2_K + Qwen3-4B Q4_K_M | ≈ 5,3 GB | Apache-2.0 | GPU pequeñas; algo menos de calidad |
| `ZIMAGE_WEB` | Z-Image-Turbo ONNX q4f16 (navegador) | ≈ 6 GB | Apache-2.0 | La versión web. **No disponible todavía** (X1 parte A): la única exportación publicada no trae el codificador del VAE, así que no puede hacer imagen a imagen; X3 tiene que exportarlo desde el `ae.safetensors` Apache-2.0 |
| `KLEIN4B_Q4` | FLUX.2 [klein] 4B GGUF Q4_K_M + Qwen3-4B Q4_K_M | ≈ 5,3 GB | Apache-2.0 | Alternativa: ediciones por instrucción ("más luz cálida") |
| `QWENEDIT_Q4` | Qwen-Image-Edit-2511 GGUF Q4_K_M + Qwen2.5-VL-7B Q4_K_M + proyector de visión Q8_0 | ≈ 19 GB | Apache-2.0 | *Pro*, solo escritorio: edición fuerte por instrucciones (una LoRA de iluminación, si se añade, será otra fila con su licencia) |
| `SD15_LIGHT` | Stable Diffusion 1.5 + ControlNet 1.1 *tile* y *depth* (fp16) | ≈ 3,6 GB | CreativeML OpenRAIL-M (uso comercial con restricciones de uso que se muestran y se aceptan) | Equipos muy modestos |

**Ficheros fijados (X1 parte A, 2026-10-13).** Cada clave lista en el
JSON sus ficheros con URL fijada a un *commit* de Hugging Face, tamaño
exacto y `sha256` (comprobados contra la API y contra la etiqueta del
CDN, sin descargar los pesos); todos los repositorios son públicos y sin
acceso restringido. Las licencias, citadas al pie de la letra, están en
`docs/ai-licences.md`. Tamaños medidos: Q8 9,41 GB, Q4 6,52 GB, Q2
5,43 GB, klein 5,44 GB, Qwen-Edit 19,03 GB, SD 1.5 3,58 GB. Ningún
componente es no comercial; SD 1.5 lleva las restricciones de uso de
OpenRAIL-M, que se muestran y se aceptan antes de descargar. **Los
ficheros se guardan una sola vez por su `sha256`** (el codificador
Qwen3-4B, 2,5 GB, lo comparten cuatro claves): borrar un modelo solo
borra lo que ningún otro instalado usa. Que stable-diffusion.cpp cargue
cada combinación está sin probar: lo prueba X1 parte B antes de quitar
la marca *provisional*.

La memoria se evalúa como **medida / 0,94**: los equipos muestran menos
memoria útil que la nominal (un equipo de "16 GB" da 15,6 GiB) y sin el
factor caerían una fila más abajo. Se prefiere la RAM instalada cuando se
puede leer.

**Regla de recomendación** (valores de partida, a calibrar en X1 con el
pico real de memoria a 1024² y un margen del 20–30 % para activaciones):

| Equipo detectado | Recomendado | También se ofrece |
| --- | --- | --- |
| GPU con **≥ 24 GB** de VRAM | `ZIMAGE_Q8` | `QWENEDIT_Q4` (*Pro*), `KLEIN4B_Q4` |
| GPU con **12–24 GB** | `ZIMAGE_Q8` | `KLEIN4B_Q4` |
| GPU con **6–12 GB** | `ZIMAGE_Q4` | `KLEIN4B_Q4` |
| GPU con **4–6 GB** | `ZIMAGE_Q2` (codificador de texto en RAM) | `SD15_LIGHT` |
| GPU con **< 4 GB** | `SD15_LIGHT` | ninguno |
| **CPU** con **≥ 32 GB** de RAM | `ZIMAGE_Q8` | `ZIMAGE_Q4` |
| **CPU** con **16–32 GB** | `ZIMAGE_Q4` | `SD15_LIGHT` |
| **CPU** con **8–16 GB** | `SD15_LIGHT` | ninguno |
| **CPU** con **< 8 GB** | ninguno (instalar sin IA) | — |
| **Navegador** con WebGPU y búferes de ≥ 1 GiB | `ZIMAGE_WEB` (hoy ninguno: no disponible todavía) | — |
| Navegador sin WebGPU | ninguno, con el mensaje de §2.3 | — |

En CPU el instalador avisa de que cada imagen tarda **minutos** (cifra
medida en X1, no estimada), y la vista previa del configurador se hace a
menos resolución. La detección usa la API nativa en escritorio (VRAM
dedicada de la GPU elegida; en Apple, la memoria unificada recomendada
para GPU) y los límites del adaptador WebGPU en el navegador. Si la
detección falla, no se recomienda nada y se muestra la tabla.

---

## 3 · Cómo se garantiza que no cambia lo que no se pide

### 3.1 · Lo que el motor le da a la IA

El motor emite, junto a la imagen, **pases exactos** (fase X2):
profundidad, normales, albedo del primer rebote no especular, **id de
pieza** e **id de material**, y el **mapa de desenfoque** (círculo de
confusión por píxel, de la profundidad de campo de la cámara). Además, el
texto de la escena: materiales por región (nombre, familia, si admite
desgaste), luces y entorno, para el *prompt*.

### 3.2 · Tubería

1. **Entrada**: la imagen del motor con su curva de tono, al tamaño del
   trabajo.
2. **Condicionamiento**: profundidad exacta y bordes **calculados de los
   cambios de id y de normal** (no de la imagen: son exactos) al ControlNet
   del modelo, cuando el motor de ejecución lo soporte; *tile* para
   salidas grandes; *prompt* generado de los materiales y las luces, con un
   negativo fijo ("no cambiar formas, texto ni logotipos"); semilla fija.
3. **Intervención baja**: `strength` acotado (≤ 0,4 en el máximo del
   control), en mosaicos de ~1024² con solape y fusión suave para salidas
   grandes, y relleno a múltiplo de 16 que se recorta después: **la
   resolución de salida es exactamente la del trabajo**.
4. **Guarda determinista**, siempre, de más fuerte a más débil:
   - **Transferencia de sombreado**: la salida es *original ×
     limitar(desenfocar(modelo) / desenfocar(original))* en dominio
     logarítmico, con radio de 8–32 px por megapíxel. Texturas, aristas,
     texto y el desenfoque de la profundidad de campo **se conservan por
     construcción**; el modelo solo aporta luz y color de baja frecuencia.
   - **Separación de frecuencias**: las bandas altas del original se
     mantienen; el microdetalle del modelo (desgaste) solo entra en banda
     media y solo dentro de las regiones de materiales que admiten
     desgaste, con un tope.
   - **Regiones por id**: intervención por región, y límite de cambio de
     color por material (ΔE₀₀ medio y percentil 95; punto de partida ≤ 2–3
     en materiales críticos, a calibrar en X1).
5. **Comprobación y retroceso**: medidas sobre el resultado —tamaño
   exacto; píxeles idénticos fuera de las regiones permitidas; coincidencia
   de bordes en discontinuidades de id y normal (±1–2 px); SSIM sobre la
   banda alta; ΔE₀₀ por región; nitidez por mosaico frente al mapa de
   desenfoque (ni se emborrona lo enfocado ni se enfoca lo desenfocado)—.
   Si alguna falla, la intervención baja sola y se repite hasta que pasen
   todas, y se informa.

Lo que esto garantiza: **resolución, encuadre, texto, aristas, color de
los materiales y profundidad de campo dentro de las tolerancias medidas,
para cualquier modelo**. Lo que no garantiza: que el resultado sea
físicamente correcto; por eso la imagen del motor se conserva siempre.

---

## 4 · Interfaz (en la ventana de render)

Sección **Post-procesado IA** de la ventana de render (`UI.md` §2.7),
plegada y apagada por defecto.

**Interruptor** *Post-procesado IA* con una línea auxiliar del modelo
activo (*Z-Image-Turbo Q4 · Apache-2.0 · descargado*). Si no hay ningún
modelo descargado, el interruptor abre el selector de §2.2 con la
recomendación para el equipo; si el equipo no puede ejecutar ninguno,
aparece deshabilitado con el motivo.

**Configurador**, debajo, con controles de 0 a 100 y una frase cada uno.
A 0, el aspecto correspondiente no cambia:

| Control | Qué hace | Por defecto |
| --- | --- | --- |
| **Intervención** | Cuánto puede cambiar la IA la imagen, en total | 30 |
| **Luz** | Luz más natural: penumbras, brillos suaves, rodillo de altas luces | 50 |
| **Rebotes** | Luz rebotada y color de ambiente entre superficies | 40 |
| **Desgaste y microdetalle** | Micro-variación y huellas creíbles, solo en materiales que admiten desgaste | 20 |
| **Estilo** | Desplegable: *Natural fotográfico* (por defecto), *Catálogo limpio*, *Editorial*, *Cálido*, *Frío*, *Cinematográfico* | Natural |
| **Fuerza del estilo** | Cuánto se aplica el estilo (solo color y ambiente de luz) | 30 |

Debajo, las **protecciones**, como fichas fijas con un candado y sin
interruptor: *Geometría · Materiales · Resolución · Profundidad de campo
· Encuadre · Texto y logotipos*. Un botón **Otra variación** cambia la
semilla.

**Vista previa**, a la derecha del configurador (o debajo en ventanas
estrechas): un fotograma del **modo Rápido** desde la cámara del trabajo,
a 384–512 px, con la IA aplicada, y un **divisor deslizable** para ver
antes y después. Se actualiza **al soltar** un control (no mientras se
arrastra: cada vista previa cuesta segundos), con el tiempo medido en
auxiliar (*≈ 9 s por cambio en este equipo*) y la nota *La vista previa
parte del modo Rápido; el resultado final parte del render completo*.
Opción *Usar el motor completo para la vista previa (más lento)*.

**Al terminar** el trabajo, el visor de resultados (`UI.md` §2.8) abre
las dos imágenes con el divisor deslizable, y el informe de la guarda en
una línea: *Comprobado: geometría ✓ · materiales ✓ (ΔE máx 1,8) ·
resolución ✓ · enfoque ✓*, más *La IA se limitó al 23 % para respetar
las protecciones* cuando ocurra. Se pueden guardar las dos imágenes; la
cola y el historial muestran las dos miniaturas.

---

## 5 · Ajustes ▸ Post-procesado IA

En la ventana de **Ajustes** (`UI.md` §2.9), sección *Post-procesado IA*,
con sus apartados *Modelo activo*, *Modelos* y *Equipo*:

- **Lista de modelos**: el de origen (*Z-Image-Turbo*, marcado *De
  origen*), las alternativas ofrecidas, y los importados; por fila
  nombre, arquitectura, licencia, tamaño, estado (*No descargado ·
  Descargando 42 % · Listo · En uso*), y acciones *Usar*, *Descargar*,
  *Eliminar*.
- **Importar modelo…**: acepta `.safetensors` (carpeta *diffusers* con
  `model_index.json` o fichero único), `.gguf` y ONNX con fragmentos y
  manifiesto; **rechaza** formatos *pickle* (`.ckpt`, `.pt`, `.bin`).
  Exige un fichero `model.repackshot.json` al lado (o lo pide rellenando
  un formulario en línea): licencia SPDX y su URL, si permite uso
  comercial, arquitectura base (`z-image`, `flux2-klein`,
  `qwen-image-edit`, `sdxl`, `sd15`), papel (*img2img*, edición,
  ControlNet, LoRA, VAE, codificador), cuantización, ficheros
  acompañantes, capacidades (`strength`, edición por referencia, tipos de
  control), `sha256` y origen. Un modelo de licencia desconocida o no
  comercial se puede usar en local, queda marcado *no apto para uso
  comercial* y nunca es el de por defecto.
- **Equipo**: GPU detectada, memoria disponible estimada, WebGPU sí o no,
  y el aviso si el modelo activo no cabe.
- **Almacenamiento**: espacio usado por modelos y resultados, y *Liberar*.

---

## 6 · Fases (detalle en `ROADMAP.md`)

| Fase | Responsable | Qué |
| --- | --- | --- |
| **X1** | **Fable** (Sonnet prepara) | **Parte A, hecha** (la necesitaba U6): ficheros exactos, URL, tamaños y `sha256` de cada clave de §2.4 en `src/data/ai-models.json` y licencias releídas al pie de la letra. **Parte B**, tras X3c: confirmar el modelo y calibrar la tabla de §2.4 (pico de memoria y tiempo por entrada en GPU y CPU) con una comparación propia Z-Image-Turbo frente a FLUX.2 klein 4B (8 renders × 3 intervenciones, métricas de la guarda) que genera una herramienta y se ejecuta **en el equipo del usuario** (aquí no hay GPU); Vulkan frente a CPU en stable-diffusion.cpp |
| **X2** | Opus | Pases del motor (§7.4): albedo, normal, profundidad, id de pieza y de material, mapa de desenfoque, en `rt-core`, el RSB, el wasm, el lanzador y el lado TypeScript. **Tras fusionar E5** (los dos tocan el integrador) |
| **X3a** | Opus | `engine/crates/rt-post` y `post.wasm` (§7.2): condicionamiento, mosaicos, relleno y recorte, **guarda determinista** con comprobaciones y la máquina de pasos con retroceso; envoltura TypeScript y el *prompt* de la escena (`src/ai/`). Probado con el "modelo" sintético |
| **X3b** | Opus | stable-diffusion.cpp en escritorio (§7.1): `src/data/ai-runtimes.json` fijado, descarga e instalación desde *Ajustes*, proceso auxiliar en `rt-app`, `/api/ai/runtime` y `/api/ai/run` (una inferencia sin guarda), con un proceso auxiliar falso en los tests |
| **X3c** | Opus | La tubería completa de escritorio (§7.3), tras X2, X3a y X3b: `/api/ai/post` en el lanzador (mosaicos → stable-diffusion.cpp → `rt-post` → retroceso), el servicio de escritorio en `src/io/`, integración en la cola con las dos imágenes y el informe, `AI_AVAILABLE` real |
| **X3d** | Opus | La web, tras X3c: ONNX Runtime Web con WebGPU en workers, **exportar el codificador del VAE a ONNX** para que exista `ZIMAGE_WEB`, conductor en worker con `post.wasm`, caché OPFS con `sha256` y fragmentos de ≤ 1 GiB |
| **X4** | Sonnet | **Hecha.** La interfaz de §4 contra `AiPostService` (`src/core/ai.ts`), con un servicio sintético hasta X3c: sección de la ventana de render, configurador, fichas, vista previa en modo Rápido con los pases dibujados por three.js y divisor, informe de la guarda y divisor en el visor de resultados, dos miniaturas en la cola, ajustes en el *store* (`ROADMAP.md` X4) |
| ~~X5~~ | — | **Absorbida en U6** (ventana de Ajustes, `ROADMAP.md`): el gestor de modelos de §5 y el selector de §2.2–§2.4 no necesitan la tubería, así que llegan antes. Lo que queda para después de X3 (comprobar en vivo que el modelo activo cabe y una prueba de una imagen) entra en X4 |

---

## 7 · Construcción: decisiones y contratos (líder, 2026-10-13)

Lo que fija el líder para que X2, X3a, X3b y X4 avancen en paralelo sin
pisarse. Los contratos de código están en `src/core/ai.ts` y
`src/core/passes.ts`: las fases **añaden**, no cambian lo que hay; si algo
no encaja, se anota en el PR y se sigue (regla 12).

### 7.1 · En escritorio todo es nativo

La interfaz es lo único HTML. En escritorio, la inferencia, la guarda y
todo el trabajo con píxeles se ejecutan fuera de la página, en código
nativo que gobierna el lanzador.

- **Inferencia: stable-diffusion.cpp** (MIT, sobre ggml, MIT) como
  **proceso auxiliar**: un ejecutable aparte, nunca enlazado, nunca
  copiado a `engine/`, que el lanzador arranca, alimenta y para. Lee
  directamente los GGUF que ya fija `ai-models.json`.
- Sus compilaciones se fijan como los modelos, en
  **`src/data/ai-runtimes.json`**: versión de la *release* oficial, URL,
  tamaño, `sha256`, licencia citada y qué claves de §2.4 carga de verdad
  (`supports`, comprobado en X3b; lo no comprobado no se marca). Dos por
  sistema (Windows y Linux x86_64): **Vulkan** (NVIDIA, AMD e Intel, con
  el controlador de la tarjeta) y **CPU** (AVX2). La regla elige Vulkan
  cuando hay GPU y CPU si no; el usuario puede forzar una en *Ajustes*.
- **No van en el instalador ni en los portables**: se descargan desde
  *Ajustes ▸ Post-procesado IA* la primera vez que se activa la IA (o
  junto al modelo elegido en el instalador), con progreso, reanudación y
  `sha256`, a `<datos>/ai/runtimes/<sha256>/`, igual que los modelos.
  El paquete sigue pequeño y la compilación depende del equipo. **CUDA**
  queda anotado como mejora (sus bibliotecas pesan cientos de MB).
- Una clave que la compilación instalada no carga aparece en *Ajustes*
  como *No disponible con este motor de ejecución*, con el motivo.
- **Hecho en X3b** (2026-10-13): *release* `master-959-d637cfb`, el modo
  servidor (`sd-server`, el modelo queda cargado), la API `/api/ai/runtime`
  y `/api/ai/run` (`engine/crates/rt-app/README.md`). **No encajó**: la
  descarga no la puede hacer la página como la de los modelos, porque las
  descargas de *releases* de GitHub no mandan cabeceras CORS; la hace el
  lanzador con el `curl` del sistema (mismo progreso, pausa, reanudación y
  `sha256`, misma carpeta), con *Instalar desde un archivo…* de respaldo.
  Las compilaciones de Windows necesitan el entorno de Visual C++
  2015–2022, que no traen.

### 7.2 · La guarda y los píxeles: el *crate* `rt-post`

Todo el trabajo determinista con imágenes de §3.2 vive en
**`engine/crates/rt-post`**: condicionamiento (bordes calculados de los
cambios de id y de normal, profundidad normalizada), plan de mosaicos con
solape y fusión suave, relleno a múltiplo de 16 y recorte, la **guarda**
(transferencia de sombreado, separación de frecuencias, regiones por id
con ΔE₀₀), las comprobaciones y la decisión de retroceso. Rust desde
cero, solo `std`, `f32`, sin `unsafe`, determinista, con las mismas
reglas y puertas que el motor. `rt-core` no lo usa ni sabe que existe.
En escritorio lo enlaza `rt-app`; en la web es un **módulo wasm aparte**
(`rt-post-wasm` → `public/engine/post.wasm`, generado como `rt.wasm` y
sin subirse al repositorio), para que el wasm del motor no crezca.

Es una **máquina de pasos**, no un bucle con *callbacks*:

1. `plan(trabajo) → Plan`: mosaicos, tamaño con relleno, fuerza del
   intento (Intervención × `MAX_STRENGTH`, por `RETRY_FACTOR` en cada
   reintento).
2. `conditioning(plan, pases) → imágenes de control` por mosaico.
3. `accept(plan, original, pases, salidas de los mosaicos, intento) →
   Aceptado{imagen, informe} | Repetir{fuerza} | Rechazado{informe}`.

El conductor que llama al modelo entre pasos es trivial y existe dos
veces: en Rust en `rt-app` (escritorio) y en TypeScript en un worker
(web). Todo lo que decide está en `rt-post` y se prueba una vez.
Máximo `MAX_ATTEMPTS` = 4 intentos; si ninguno pasa, se entrega la
imagen del motor **sin cambios** con el informe `REJECTED` y el motivo.
Con Intervención 0 la salida es la entrada bit a bit, sin llamar al
modelo.

### 7.3 · La tubería de escritorio vive en el lanzador

Los píxeles no hacen viajes de ida y vuelta. El lanzador guarda la imagen
lineal y los pases del render final de cada trabajo (por id del render,
en memoria y en `<datos>/cache/ai/`), y **`POST /api/ai/post`** recibe
solo `{renderId, ajustes, prompt, negativo, modelo}`; para la vista
previa del modo Rápido, la imagen y los pases van en línea (≤
`PREVIEW_MAX_SIDE` = 512 px de lado). Mosaicos → stable-diffusion.cpp →
`rt-post` → reintentos ocurren en nativo, y el progreso y el resultado se
publican como los trabajos de render (`GET /api/ai/post/<id>`,
cancelar con `DELETE`). La página construye el *prompt* con los
materiales y las luces del *store* (`src/ai/prompt.ts`), lo envía con
los ajustes y recibe las dos imágenes y el informe. El modelo se carga
una vez y queda cargado mientras se use (vista previa tras vista previa);
se descarga al cerrar *Post-procesado IA* o tras un rato sin uso, para
devolver la memoria.

### 7.4 · Pases (X2)

Formato único para el motor, el wasm, el lanzador y la vista previa de
three.js (`src/core/passes.ts`): un plano por pase, `ancho × alto`, por
filas desde arriba a la izquierda, como la imagen.

| Pase | Tipo | Contenido | Fondo |
| --- | --- | --- | --- |
| `albedo` | 3 × f32 lineal | Color base del material del primer impacto, sin seguir rebotes especulares (un difuso: su color; un vidrio: su tinte), promediado sobre las muestras del píxel | 0 |
| `normal` | 3 × f32 | Normal de sombreado unitaria del primer impacto, en el espacio del mundo (Z arriba), vuelta hacia la cámara (cuentan las dos caras del triángulo) | 0 |
| `depth` | f32 | Distancia a lo largo del eje de la cámara, en unidades de escena | +∞ |
| `partId` | u32 | Índice de instancia del RSB + 1: `io/rsb.ts` lo traduce a la pieza, como `pick`; el suelo del estudio, `FLOOR_ID` | 0 |
| `materialId` | u32 | Índice de material del RSB + 1; el suelo, `FLOOR_ID` | 0 |
| `coc` | f32 | Diámetro del círculo de confusión en píxeles de salida, de la lente fina | 0 (también sin DoF) |

**Corrección del líder (tras X4, 2026-10-13).** El albedo es el del
primer impacto, sin seguir rebotes especulares (como lo dibuja la vista
previa de three.js y más simple de igualar), y la normal se vuelve hacia
la cámara. **El suelo del estudio no es fondo**: lleva `FLOOR_ID`
(`0xFFFFFFFF`) en los dos ids, porque sus sombras de contacto y su luz
rebotada son justo lo que mejoran *Luz* y *Rebotes*; el fondo (0) es el
entorno, la imagen de fondo, la transparencia y los paneles de luz vistos
por la cámara, y no cambia nunca. El círculo de confusión sigue la misma
fórmula que `src/core/lens-coc.ts` (X4), que reproduce
`Camera::generate_ray`. X2 lo emite así en el motor; X3c ajusta la guarda
(`rt-post`), el servicio sintético y los pases de three.js a `FLOOR_ID`.

`normal`, `depth`, `partId` y `materialId` salen de **un rayo por el
centro del píxel, sin *jitter***: son exactos y nunca mezclan dos lados de
una arista, que es lo que necesita la guarda. Los pases se piden con una
máscara en `RNDR` (bit *i* = `PASS_KEYS[i]`), se acumulan como la imagen,
no cambian ni un píxel de la imagen (la paridad y el *hash* de
determinismo siguen iguales) y salen por `rt-wasm` y por el lanzador
(`/api/render` con `passes=…` en los trabajos finales, que los guarda
para §7.3, y `GET /api/render/<id>/passes` en binario con cabecera).

- **Hecho en X2** (2026-10-13): `rt_core::passes`, `rt_render_tile_passes`
  y `rt_render_tile_albedo` en `rt.wasm`, `PassAccumulator` en el pool y
  `parsePasses` para el fichero `RPP1` del lanzador
  (`src/render/pass-planes.ts`), `passes=` y `GET /api/render/<id>/passes`
  con el almacén de los cuatro últimos renders (`<datos>/cache/ai/` para
  los de más de 64 MiB). Detalle en `ARCHITECTURE.md` §5.2 y §5.5 y en
  `engine/crates/rt-app/README.md`. Decisiones de X2 donde el contrato no
  decía nada: el albedo de un emisor es su `base_color` (no su emisión);
  el del suelo, `FLOR.color` también en el atrapasombras; con
  profundidad de campo el albedo sigue el rayo de cada muestra por la
  lente (se emborrona como la imagen); un recorte o un vidrio paran el
  rayo de los pases como paran `pick`; una instancia con un índice de
  material fuera de rango lleva `materialId` 0. Los pases de three.js
  coinciden con los del motor en ids y profundidad salvo en el suelo, que
  sigue siendo fondo para ellos hasta X3c
  (`tests/ai-passes-browser.test.ts`).

### 7.5 · Ajustes en el *store* (X4)

`RenderSettings.ai` (`src/core/render.ts`) pasa de `{ enabled }` a
`{ enabled, previewFullEngine } & AiPipelineSettings`, con los valores
por defecto de `DEFAULT_AI_PIPELINE`; los proyectos antiguos se abren con
esos valores. Cambiar un control es una acción del *store* y se deshace;
cada trabajo copia sus ajustes. `AI_AVAILABLE` deja de ser una
constante en X3c: lo dice `AiPostService.status()`.

### 7.6 · Orden

**Ya**: X3a, X3b y X4 en paralelo (cada uno en sus ficheros nuevos; donde
tocan ficheros comunes —`server.rs`, `ports.ts`, `strings.ts`, la
ventana de render— lo mínimo, para que la fusión sea mecánica). **X2**
en cuanto se fusione E5. **X3c** cuando estén X2, X3a y X3b; **X3d** y
**X1 parte B** detrás. Dependencias nuevas, en `ARCHITECTURE.md` §1:
stable-diffusion.cpp (escritorio, proceso aparte, X3b) y ONNX Runtime
Web (web, X3d).
