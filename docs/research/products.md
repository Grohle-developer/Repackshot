# Investigación: cuatro add-ons como inspiración (2026-10-13)

> Resumen del líder del informe de investigación de Sonnet (fuentes: solo
> páginas públicas de producto, documentación, preguntas frecuentes,
> registros de cambios y reseñas; ningún código ni asset de los
> productos). Las decisiones están en `docs/STUDIO-TOOLS.md`.

## Herramienta de luces (Light Wrangler, de pago, Superhive)

- Colocación por cursor en tres modos: **reflejo** (el brillo cae donde
  apuntas), **directo** y **órbita**; normal suavizada con modo preciso;
  evitar obstáculos; ajuste de potencia, tamaño, distancia y apertura con
  la rueda; tamaño inicial según la selección; potencia automática al
  cambiar tamaño o distancia.
- Modos por luz: textura sobre la luz, *scrim* procedural (pluma,
  inclinación, imperfección, sesgo), gobos (115, con animación), IES (30
  incluidos), banderas y reflectores con *mantener vertical*; equilibrio
  difuso/especular por luz (hecho con luces auxiliares); enlazado de luz
  y de sombra por objeto; solo; falso color por zonas; *hornear el
  montaje a HDRI* para otros motores; parpadeo.
- Quejas: faltan presets de montaje y control fino del enlazado; IES solo
  en un motor; texturas descargadas en línea.
- Fuentes: https://superhivemarket.com/products/light-wrangler ,
  https://blenderlighting.com/light-wrangler/docs/ ,
  https://blenderlighting.com/light-wrangler/changelog/

## "HDRI Studio Pro" y los editores de entorno por formas

- El producto con ese nombre es **un pack de 35 HDRI estáticos**, no una
  herramienta (https://superhivemarket.com/products/hdri-studio-pro). Lo
  de pintar formas en la esfera y hornear lo hacen otros: editores por
  *pines* (softbox, tira, foco, degradado, *scrim* con punto caliente,
  imagen, bandera que quita luz; brillo o temperatura de 1.000 a
  12.000 K, tamaño, giro, suavidad del borde; *colocar brillo* con un
  clic; exportar EXR de 32 bits hasta 4k), pinceles sobre la esfera y
  softboxes matemáticos en el shader del mundo. El editor de HDRI de
  KeyShot Pro trabaja con la misma idea de pines.
- Fuentes: https://superhivemarket.com/products/latitude/docs ,
  https://extensions.blender.org/add-ons/hdri-lightbrush/ ,
  https://superhivemarket.com/products/procedural-studio-hdri

## Simulación de lentes (Lens Sim)

- Traza cada rayo por una prescripción real (superficies, vidrio, diafragma)
  en un shader de cámara (versiones anteriores: geometría real con
  portales); salen aberración cromática (una longitud de onda por rayo, con
  ruido), viñeteo, distorsión, blandura, respiración de foco y bokeh
  natural. Unas 65 lentes construidas desde patentes, de todas las
  familias (ojos de pez, anamórficos, macro, blandos, zooms, Petzval,
  Gauss, teleobjetivos); herramientas de *tilt-shift*, *split diopter*,
  suciedad de lente, distorsión extra, contra-zoom, filtro de color,
  bloom, remolino del bokeh, imagen de diafragma, CA en pantalla,
  desestiramiento anamórfico; visor esquemático de la lente.
- Quejas: sin flare, más ruido con CA, cambia la resolución al cambiar de
  lente, viñeteo que estropea los pases.
- Fuentes: https://superhivemarket.com/products/lens-sim ,
  https://superhivemarket.com/products/lens-sim/docs

## Movimientos de cámara prefabricados (Cinepack)

- Más de 110 movimientos en categorías (cinemáticos, pans, rampas de
  velocidad, empujes y alejamientos, vuelos, zooms, cámara en mano,
  acción), vista previa en vídeo, velocidad, duración, escala y campo de
  visión ajustables, dibujar el recorrido, bloqueo de objetivo, vuelo
  grabado con el ratón, proporciones de salida.
- Quejas: torpe de editar (restricciones), escala de escena a mano.
- Fuentes: https://superhivemarket.com/products/cinepack-pre-animated-camera-moves ,
  https://garagefarm.net/blog/how-to-move-cameras-in-blender-like-a-cinematographer-using-cinepack
