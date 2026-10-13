# Registro de cambios

Cada versión lista lo que trae, agrupado por áreas. Entre paréntesis, la
fase del roadmap (`ROADMAP.md`) de donde sale cada línea.

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
