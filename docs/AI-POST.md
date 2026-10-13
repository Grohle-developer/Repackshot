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
- **Escritorio (P2)**: **ONNX Runtime** nativo con los mismos ficheros
  (CUDA, DirectML, CoreML, etc.) si pasa la prueba de X1; si no,
  **stable-diffusion.cpp** (MIT, ggml: CUDA, Vulkan, Metal, CPU) como
  proceso auxiliar, que además lee los GGUF que importe el usuario.
- **Separado del motor de render.** El post-procesado vive en `src/ai/`
  (y en un proceso aparte en escritorio). El motor en Rust sigue sin
  dependencias y no sabe que la IA existe; su única aportación son los
  **pases** (§3.1).
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
| **X1** | **Fable** (Sonnet prepara) | **Parte A, adelantada** (la necesita U6): ficheros exactos, URL, tamaños y `sha256` de cada clave de §2.4 en `src/data/ai-models.json` y licencias releídas al pie de la letra. **Parte B**, tras X3: confirmar el modelo y calibrar la tabla de §2.4 (pico de memoria y tiempo por entrada en GPU y CPU); comparación visual propia Z-Image-Turbo frente a FLUX.2 klein 4B sobre 8 renders × 3 intervenciones con las métricas de la guarda; prueba de ONNX Runtime nativo frente a stable-diffusion.cpp para escritorio |
| **X2** | Opus | Pases del motor para la IA: albedo, normal, profundidad, id de pieza y de material, mapa de desenfoque, en `rt-core`, el RSB, el wasm y el lado TypeScript |
| **X3** | Opus | La tubería: `src/ai/` con ONNX Runtime Web en workers, **exportar el codificador del VAE a ONNX** para que exista `ZIMAGE_WEB`, descarga y caché con `sha256`, mosaicos, *prompt* de la escena, condicionamiento, **guarda determinista** con comprobación y retroceso, integración en la cola con las dos imágenes |
| **X4** | Sonnet | La interfaz de §4 en la ventana de render, la vista previa en modo Rápido, el informe de la guarda y el divisor en el visor de resultados |
| ~~X5~~ | — | **Absorbida en U6** (ventana de Ajustes, `ROADMAP.md`): el gestor de modelos de §5 y el selector de §2.2–§2.4 no necesitan la tubería, así que llegan antes. Lo que queda para después de X3 (comprobar en vivo que el modelo activo cabe y una prueba de una imagen) entra en X4 |
