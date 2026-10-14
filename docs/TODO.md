# TODO diferido — especificación guardada tal cual (14-10-2026)

Trabajo pedido para **después** de terminar todo lo que está en curso (ver `ROADMAP.md` y `SESSION-STATE.md`). No se implementa todavía; cuando toque, cada apartado se convierte en fases del `ROADMAP.md` con brief y veredictos del responsable. Guardado por petición del usuario sin cambios.

---

# Repackshot — Room Builder + Paseos: especificación futura

**Estado: DIFERIDO.** Pedido por Berto el 2026-10-14 para **después de terminar todo lo que está en curso** (v0.1–v0.3 y resto de trabajo abierto). No implementar todavía. Este documento es la especificación guardada tal cual la pidió, para retomarla cuando toque.

## 1. Room Builder estilo Los Sims 4

Constructor de habitaciones con la misma forma de montar una habitación que en Los Sims 4: dibujar / levantar paredes de forma directa e intuitiva, no por parámetros sueltos.

### Elementos constructivos / decorativos (catálogo de modelos)
- Ventanas (modelos varios).
- Rodapiés.
- Pinturas / cuadros de pared.
- (Catálogo ampliable con el mismo funcionamiento: cada tipo es un modelo colocable sobre la habitación.)

### Presets (mismo funcionamiento del builder, habitaciones ya montadas)
- **Habitación cuadrada** — habitación base genérica, punto de partida vacío.
- **Sala tipo estudio de fotografía** — incluye:
  - Fondo blanco de tela de estudio dejándose caer (curva de ciclorama: cae de arriba y se extiende por el suelo, sin arista pared-suelo).
  - Focos.
  - Soporte de la tela (estructura / pie del fondo).
- Más presets bajo este mismo funcionamiento (pendiente definir la lista cuando se retome).

### Notas de diseño (a confirmar cuando se implemente)
- El builder trabaja sobre la escena del render: la habitación es geometría de la escena, no un overlay.
- Los presets deben ser editables tras cargarlos (mover / quitar / añadir elementos), no escenas cerradas.

## 2. Material madera: corrección de los nudos

Defecto actual a corregir (observación de Berto sobre el render de madera):

1. **Rayas oscuras rectas raras que salen de los nudos sin sentido.** Los nudos generan trazos rectos oscuros que no siguen la lógica de la veta.
2. **Color de los nudos no del todo logrado.** Ajustar el color (más fiel a un nudo real: centro más oscuro, transición gradual, no mancha plana).
3. **Posición: los nudos suelen estar entre medias de dos vetas, no solo "pegados a una".** El generador debe colocar los nudos en el espacio entre dos vetas, no anclados a una sola veta.

Especificación del comportamiento deseado:
- El nudo nace **entre dos vetas** (en el intersticio), no adosado a una.
- Las vetas vecinas se **desvían / rodean** el nudo (flujo de veta deformado alrededor del nudo), no lo atraviesan en recto ni salen de él en rayas rectas.
- Anillos concéntricos del nudo deformados por el flujo de la veta, con caída de color gradual centro → borde.
- Sin trazos rectos oscuros espurios saliendo del nudo.

## 3. Paseos a pie (walkthroughs)

### Acceso: el muñeco estilo Street View
- **Fácilmente accesible:** se deja caer un "muñeco" estilo el de Google Street View sobre un punto del mapa del render.
- **Al agarrar el muñeco, se pasa a una vista aérea de planta** (plano cenital de la escena) para elegir el punto de caída con precisión.
- **El muñeco deja una sombra de dónde caería** mientras se arrastra sobre la planta: marcador de suelo que indica el punto exacto de aterrizaje antes de soltar.
- **Al caer (soltar), se pasa a la vista del muñeco** = se entra en modo paseo en ese punto, en primera persona desde la cámara asignada.
- Arrastrar y soltar el muñeco en cualquier punto transitable de la escena = entrar en modo paseo en ese punto.
- **El muñeco es siempre invisible** (nunca se renderiza, nunca aparece en la grabación). Es solo el punto de entrada / marcador de posición. La sombra de caída es un indicador de UI en la vista de planta, no el muñeco renderizado.

### Salida del modo paseo
- **Se puede salir del modo "paseo" en cualquier momento.**
- **Al salir, se puede elegir si se guarda esta nueva posición en la cámara seleccionada** (diálogo / opción guardar / descartar): si se guarda, la cámara seleccionada adopta la posición (y orientación) donde terminó el paseo; si no, la cámara queda como estaba.

### Cámara del muñeco
- El muñeco lleva **una cámara asignada encima**.
- **Por defecto: la cámara que esté en vista actual** en el momento de soltar el muñeco.
- **Configurable también en el panel:** se puede cambiar la cámara asignada al muñeco desde el panel (no solo la actual).
- **Altura del muñeco completamente configurable** (= altura del ojo / de la cámara sobre el suelo). Sin valor fijo: el usuario la ajusta libremente.
- **El slider de altura ha de estar en la UI como un slider vertical en los bordes de la parte del canvas** (pegado al borde del viewport, no en un panel flotante lejano ni solo en Settings). Ajuste directo mientras se está en / preparando el paseo.

### Movimiento y sensación
- **WASD** para moverse + **ratón** para mover la cámara (first-person, estilo videojuego).
- **Simulación de pasos:** con o sin ella (toggle). Con ella: balanceo / bobbing de cámara al caminar. Sin ella: cámara estable, deslizamiento limpio.
- **Suavidad configurable** con más o menos intensidad, por separado para:
  - Movimiento de cámara.
  - Zoom.
  - Pasos (frecuencia / amplitud del bobbing cuando la simulación está activa).
- El paseo debe sentirse ajustable: de respuesta seca e inmediata a movimiento suavizado / con inercia, según los controles de suavidad.

### Grabación
- **Botón REC claramente visible en la UI** para grabar el paseo. Tiene que verse a primera vista, no escondido en un menú.
- El paseo **se graba como una mera animación de cámara** (no como vídeo plano, no como path bloqueado).
- Consecuencia: la grabación es **editable frame a frame la posición de la cámara** — cada frame es un keyframe de posición (y orientación) de cámara que se puede corregir / retocar en el editor de animación después de grabar.

### Notas de diseño (a confirmar cuando se implemente)
- Colisión / límites del paseo: por definir (¿atravesar paredes libremente, o colisión con la geometría de la habitación?).
- La grabación debe reutilizar el sistema de animación de cámara de v0.3 (turntable / animación), no un sistema paralelo.
- El botón REC debe tener estado visible grabando / parado, y la grabación debe poder pausarse sin perder lo grabado.

## 4. Paneles del canvas: ocultar, plegar, mover y configurar (click derecho)

Los pequeños paneles superpuestos al canvas deben ser personalizables, no fijos.

### Paneles afectados
- Panel de **progreso de render**.
- Panel de los **ejes X, Y y Z** (gizmo / indicador de ejes).
- Paneles **de arriba** (barra(s) superior(es) del canvas).

### Ocultar / plegar
- Se pueden **ocultar** los pequeños paneles del canvas: progreso de render, ejes X/Y/Z, etc.
- **Los de arriba lo único que han de poder es plegarse con un botón, en vez de ocultarse:** la barra superior no desaparece del todo; se pliega / despliega con su botón de plegado, quedando siempre recuperable desde el propio canvas.

### Mover y configurar (click derecho)
- **Todos los paneles han de poder moverse de sitio arrastrándolos** (drag & drop a otra posición del canvas).
- **Todo esto con click derecho sobre estos paneles:** el menú de click derecho sobre un panel permite:
  - Configurar los **botones** del panel (cuáles se muestran).
  - Configurar su **posición**.
  - Elegir **cuáles quitar o poner** (qué botones / elementos del panel están visibles).
- Es decir: click derecho = menú de personalización del panel (botones, posición, elementos visibles), no un menú genérico.

### Volver a mostrar
- Los paneles ocultos **se han de poder volver a mostrar desde Settings, en el panel de interfaz** (Settings → Interfaz: lista de paneles con mostrar / ocultar, y restauración de los que se quitaron).

### Notas de diseño (a confirmar cuando se implemente)
- La disposición de paneles debe persistir entre sesiones (layout guardado).
- El plegado de las barras de arriba debe dejar un tirador / botón visible para desplegar, nunca un estado sin salida.
- El click derecho no debe entrar en conflicto con el click derecho de órbita / menú contextual del viewport: el click derecho sobre un panel actúa sobre el panel; sobre el canvas vacío, lo habitual del viewport.

## 5. Física + efectos ambientales + viento + fuzz

### Física en los efectos ambientales
- **Las físicas se han de aplicar a todos los efectos ambientales.** Ningún efecto de ambiente queda fuera del sistema de físicas: todos responden a las mismas fuerzas.
- **Gravedad realista:** la gravedad que actúa sobre los efectos es realista (valor terrestre por defecto, no gravedad de videojuego exagerada).
- **Aire:** el aire también actúa (resistencia / arrastre aerodinámico sobre las partículas y elementos de los efectos). La física es gravedad + aire, no gravedad sola.

### Partículas
- **Tiempo de generación de partículas configurable:** cuánto tiempo se generan partículas (ventana / duración de la emisión) es un parámetro ajustable por el usuario, por efecto.
- (A definir al implementar: si el control cubre también cadencia de emisión y vida de cada partícula, o solo la duración de la generación.)

### Fuzz
- **El fuzz tiene un toggle de activar físicas realistas también.**
  - OFF: fuzz estático / decorativo, sin simulación física (comportamiento actual / barato).
  - ON: las fibras del fuzz responden a la física realista (gravedad + aire + viento, ver abajo), como el resto de efectos ambientales.

### Combinación de efectos de ambiente
- **En Ambiente se pueden combinar varios efectos de ambiente.**
- **Máximo dos a la vez por defecto, para evitar cloggeos** (saturación / atasco de rendimiento por acumulación de simulaciones).
- El límite de 2 es el valor por defecto (a confirmar al implementar si se puede subir en Settings, con aviso de rendimiento).

### Simulador de viento
- **Se podrá añadir un simulador de viento** (como un efecto / emisor más del sistema de ambiente).
- Parámetros del viento:
  - **Dirección.**
  - **Volumen** (cantidad / caudal de aire).
  - **Velocidad.**
  - **Densidad** (del aire).
  - (… = lista abierta, esos cuatro como mínimo.)
- **Esto afectará a las físicas claramente:** el viento es una fuerza del sistema de físicas — empuja / desvía partículas de los efectos ambientales, mueve el fuzz con físicas activas, y en general modifica cualquier efecto sometido a física.

### Previsualización
- **Cuando se active la previsualización de efectos de ambiente simulados, por defecto siempre se verán en fast** (modo de previsualización rápida / baja calidad, para no atascar el viewport). El render final no queda en fast; el fast es solo el modo por defecto de la preview de efectos simulados.

### Notas de diseño (a confirmar cuando se implemente)
- La física debe ser un único sistema compartido (gravedad + aire + viento) del que beban todos los efectos, no una física por efecto.
- El límite de 2 efectos simultáneos debe aplicarse a efectos simulados (con física/partículas), no a efectos estáticos de ambiente si los hay — confirmar.
- El modo fast de la preview debe ser conmutable (si el usuario quiere preview en calidad completa, que pueda cambiarlo; el por defecto es fast).

## 6. Servidor MCP integrado: manejo de la aplicación completa

### Servidor MCP en la aplicación
- **Añadir un servidor MCP a la aplicación** (Model Context Protocol, integrado en Repackshot, no un proceso externo aparte).
- **Que maneje la aplicación completa:** el servidor MCP expone herramientas para operar toda la aplicación — escena, materiales, luces, cámaras, Room Builder, renders, paseos / animación de cámara, efectos de ambiente / física, paneles e interfaz, Settings — no solo un subconjunto (lectura o render).
- Cualquier cosa que el usuario pueda hacer en la UI debe poder hacerse vía MCP, siempre que el permiso correspondiente esté activado (ver abajo).

### Permisos con toggle — Settings > MCP
- **Cada permiso será activable o desactivable con un toggle en el menú.**
- Ubicación: **Settings > MCP** — ahí vive la lista completa de permisos, cada uno con su toggle.
- Apagar un permiso = el servidor MCP deja de exponer / deniega esa capacidad (no la ejecuta aunque el cliente la pida). Encenderlo = la vuelve a permitir. El cambio aplica sin reiniciar la app (a confirmar al implementar si algún permiso exige reinicio del servidor).
- La granularidad es **por permiso**, no un único on/off global: el usuario puede dejar activas p. ej. las lecturas y desactivadas las escrituras / acciones destructivas, o activar solo la familia de herramientas que necesita.

### Notas de diseño (a confirmar cuando se implemente)
- Lista exacta de permisos por definir al implementar (propuesta: agrupar por dominio — escena, materiales, cámaras, render, animación/paseos, ambiente/física, UI/paneles, Settings — y dentro de cada uno separar lectura de escritura/acción).
- Estado por defecto de cada permiso por definir (pendiente decisión de Berto; el criterio a aplicar: lo destructivo / que borra o sobrescribe debe ser conservador por defecto).
- Transporte y acceso por definir: ¿solo local (stdio / localhost) o también HTTP remoto? ¿Con autenticación / token? El servidor no debe quedar abierto a la red sin permiso explícito del usuario.
- El panel Settings > MCP debe mostrar el estado del servidor (corriendo / parado, puerto / transporte si aplica) y qué cliente está conectado, si lo hay.
- Log / auditoría: que quede registro de las acciones ejecutadas vía MCP (qué herramienta, cuándo), para poder revisar qué hizo un agente externo.

## 7. Materiales líquidos: emisor y desagüe de líquido

### Estado existente (según Berto, ya existe)
- En Materiales **ya tenemos líquidos**, y tienen un **toggle para activar sus físicas realistas en función de varios parámetros**.
- Alternativa por click derecho: **click derecho sobre un sólido y activar Físicas > Líquido** (si el material se crea como líquido) **o Tela** (si es tela).
- Es decir: la física de líquido / tela ya se puede activar desde el panel del material o desde el menú contextual Físicas del sólido.

### Nuevos materiales: emisor y desagüe de líquido
- Añadir un material que sea **"emisor" de líquido** (suelta / genera líquido en la escena).
- Añadir otro material que sea **"desagüe" de líquido** (elimina / recoge el líquido que lo toca / entra en su volumen).
- **Ambos configurables** (parámetros propios de cada uno; lista exacta a definir al implementar: p. ej. tipo de líquido, caudal, dirección / radio de acción, activo o no, etc.).
- **Finalidad:** de esta manera **se podría evitar que desborde el agua en algún contexto si no interesa** — el desagüe equilibra al emisor: el líquido generado no se acumula indefinidamente, sino que desaparece al llegar al desagüe.

### Asignación a un sólido
- **Este material se podrá asignar a un sólido con otras propiedades por sí mismo** (el sólido puede tener sus propias propiedades de material / física / aspecto y además comportarse como emisor o desagüe).
- **Aunque al asignarlo a un sólido, preguntar si desea borrar otras propiedades y hacerlo invisible** (diálogo de confirmación en la asignación):
  - **Sí:** se borran las otras propiedades del sólido y se hace **invisible** — queda como un volumen emisor / desagüe puro, funcional pero sin renderizarse (no se ve en la escena ni en el render).
  - **No:** el sólido conserva sus otras propiedades y además actúa como emisor / desagüe (visible y con su aspecto / física anteriores + la función de emisor / desagüe).
- El comportamiento invisible es el del sólido al que se asigna, no un objeto aparte.

### Notas de diseño (a confirmar cuando se implemente)
- El líquido emitido debe entrar en el sistema de físicas compartido de la sección 5 (gravedad realista + aire + viento).
- El desagüe debe eliminar líquido de forma controlada (sin parpadeos ni borrados bruscos visibles cuando el líquido lo toca).
- Si hay varios emisores / desagües, el balance total (emitido − drenado) es lo que evita el desborde; a definir si hay un indicador de nivel / caudal neto en la UI.
- La pregunta de borrar propiedades + invisibilidad debe aparecer en cada asignación de emisor / desagüe a un sólido que ya tenga propiedades, no solo la primera vez.

## 8. Vídeo: render + postprocesado IA con consistencia entre frames

### Render de vídeo: fps y resolución independientes
- **En el vídeo, al renderizar, quiero elegir fps aparte de resolución:** fps y resolución son dos controles independientes (cambiar uno no arrastra al otro).
- **Con límite en 16K por arriba:** la resolución máxima de render de vídeo es **16K** (techo superior; no se puede pedir por encima de 16K).
- (A confirmar al implementar: si el límite 16K es por lado mayor, y qué valores de fps se ofrecen — presets + valor libre.)

### Aspect ratio: Open Gate
- **En Aspect Ratio quiero meter Open Gate:** una opción más en el selector de Aspect Ratio, junto a los ratios fijos (16:9, 9:16, 1:1, etc.).
- **Open Gate = usar el cuadro completo, sin recorte:** no se recorta a ningún ratio; se renderiza todo el gate / encuadre completo de la cámara virtual, con toda la información del frame.
- Finalidad: poder **reencuadrar después** a cualquier ratio en post (vertical, cuadrado, panorámico…) sin haber perdido imagen por un recorte en el render, igual que el Open Gate de cámara real (sensor completo).
- Open Gate convive con lo anterior: fps independiente, límite 16K por arriba (el frame Open Gate también respeta el techo 16K), y la IA + plugins trabajan sobre el frame completo.

### Postprocesado IA en vídeo: consistencia temporal
- **A la IA de postprocesado en vídeo se le dará los anteriores frames mejorados por IA y el siguiente sin modificar.**
  - Entrada de la IA para el frame N: los frames anteriores ya mejorados por IA (N−1, N−2, …) + el frame siguiente sin modificar (N+1 en bruto).
  - Es decir: contexto temporal hacia atrás (versiones mejoradas) + un frame de anticipo en bruto hacia adelante.
- **La idea es generar consistencia entre frames** en cuanto a:
  - Luces.
  - Texturas.
  - Colores.
  - Reflejos.
  - (… = cualquier atributo visual que tienda a parpadear / cambiar entre frames si se procesa cada frame aislado.)
- **De tal manera que cada frame respete con mucha precisión el anterior o anteriores frames:** el frame N no se mejora aislado; debe mantenerse fiel, con mucha precisión, a lo que la IA ya decidió en el/los frames anteriores (sin derivas de luz / color / textura / reflejo de un frame a otro).
- (A definir al implementar: cuántos frames anteriores se le dan exactamente — mínimo 1, ideal N configurable — y cómo se trata el primer frame, que no tiene anteriores.)

### Orden del pipeline: IA siempre antes que los plugins
- **El procesado IA siempre será previo a los plugins.**
- Orden fijo: render en bruto → postprocesado IA (con consistencia temporal) → plugins (filtros / postprocesados).
- Ningún plugin se aplica antes de la IA; la IA trabaja sobre el render en bruto, y los plugins trabajan sobre el resultado de la IA.

### Guardado: todas las versiones o solo la final
- **Quiero poder elegir si se guardan todas las versiones o solamente la final con todos los filtros y postprocesados.**
  - **Todas las versiones:** se guardan las etapas intermedias (p. ej. render en bruto, tras IA, tras plugins) además de la final.
  - **Solo la final:** se guarda únicamente la versión final con todos los filtros y postprocesados aplicados; las intermedias se descartan.
- La opción es del usuario por render / proyecto, no un comportamiento fijo.

### Notas de diseño (a confirmar cuando se implemente)
- La consistencia temporal es el objetivo principal de la IA de vídeo, por encima de la mejora aislada de un frame: mejor un frame ligeramente menos "perfecto" pero consistente que un frame perfecto que parpadea respecto al anterior.
- Si la IA recibe frames anteriores mejorados + siguiente en bruto, hay que definir la ventana de latencia (hay que esperar a tener N+1 en bruto antes de emitir N mejorado).
- El guardado de "todas las versiones" debe etiquetar cada versión (bruto / IA / final) para no confundirlas en disco.

## Orden de trabajo
1. Terminar todo lo que está en curso (v0.1–v0.3 y resto de trabajo abierto).
2. Después: Room Builder + presets.
3. Madera / nudos: puede ir con el Room Builder (es material de la habitación) o como corrección del shader de madera cuando se retome — decidir al retomarlo.
4. Paseos: después del Room Builder (necesita habitaciones donde pasear).
5. Paneles del canvas (ocultar / plegar / mover / configurar con click derecho, restaurar desde Settings → Interfaz): puede ir con los paseos o antes, es UI del canvas — decidir al retomarlo.
6. Física + efectos ambientales + viento + fuzz: sistema de físicas compartido (gravedad realista + aire + viento), límite 2 efectos simultáneos por defecto, preview de efectos simulados en fast por defecto — decidir al retomarlo si va con el Room Builder / Ambiente.
7. Servidor MCP integrado (Settings > MCP): maneja la aplicación completa, cada permiso con su toggle en Settings > MCP — decidir al retomarlo el listado exacto de permisos, sus valores por defecto, transporte y autenticación.
8. Materiales líquidos emisor / desagüe (configurables, para evitar desbordes; al asignar a un sólido preguntar si borrar otras propiedades y hacerlo invisible).
9. Vídeo: fps independiente de resolución con límite 16K; Aspect Ratio con Open Gate (cuadro completo sin recorte, para reencuadrar en post); IA de postprocesado con frames anteriores mejorados + siguiente en bruto para consistencia (luces, texturas, colores, reflejos), IA siempre antes que los plugins, opción guardar todas las versiones o solo la final.

---
*Guardado 2026-10-14 desde los mensajes de Berto. Actualizado el mismo día con: vista aérea de planta al agarrar el muñeco + sombra de caída, salida del paseo con opción de guardar posición en la cámara, slider vertical de altura en el borde del canvas, paneles del canvas personalizables, física + efectos ambientales (gravedad realista + aire, tiempo de generación de partículas, toggle de físicas en el fuzz, máx. 2 efectos por defecto, simulador de viento, preview en fast), servidor MCP integrado con permisos por toggle en Settings > MCP, materiales emisor / desagüe de líquido configurables, vídeo (fps + 16K, IA con consistencia entre frames, IA antes que plugins, guardar todas las versiones o solo la final), y Aspect Ratio con Open Gate. No se ha implementado nada: es especificación diferida.*
