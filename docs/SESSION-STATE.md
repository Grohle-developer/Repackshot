# Estado de la sesión (16-10-2026) — cómo reanudar sin perder nada

Este archivo lo escribe el responsable (Fable) para que cualquier sesión
nueva pueda seguir donde se quedó esta. Lo que cuenta es lo que hay en
`origin`: la rama de sesión `ccr-8df3f848-6ukiky` (los PR #7 a #11 están
fusionados en `main` por el usuario; el #11, con E9, E6 y las 88 miniaturas,
en `72e4f79`; v0.1.6 salió de `c413669`; el PR abierto ahora es el **#12**,
rama de sesión → `main`, con el triaje del reporte, B1 y O2 cuando entren) y las ramas `wip/ccr-8df3f848/<fase>` con el trabajo en curso
de cada agente (se empujan tras cada *commit* de su agente; un *commit*
«WIP» puede tener tests en rojo). Los árboles de trabajo locales
(`/home/user/Repackshot-<fase>`) y el *scratchpad* son efímeros.

## Fusionado en la rama de sesión

M2a texturas · P5 actualizar desde la app · L6 sets de estudio · U12
TIFF/DNG · O1 lente fina y bokeh · U13 proporción en la cámara · P6
plugins + plugin de película · E12 elección de luz por punto · P6b
carrusel con deslizador y filtros · N6 despieces y línea de tiempo · M3a
editor de materiales por nodos (modelo, compilador, editor, vista Rápido) ·
S2 cuerpos rígidos (Dejar caer, barra de físicas, clips `PHYSICS`) · S4a
partículas de ambiente (ocho efectos, sección Ambiente, `FXAM`) · U11 denoise
en directo · U11b intensidad del denoise · E11 suavizado de bordes (Fino por
defecto). Cada fase está marcada «hecha» en
`ROADMAP.md` con su párrafo *Hecho / Qué no encajó*.

## En curso (rama `wip/ccr-8df3f848/<fase>`; brief en `ROADMAP.md`)

| Fase | Rama | Estado y siguiente paso |
| --- | --- | --- |
| U11 + U11b + E11 | `u11` | **Fusionadas en la rama de sesión** (`1ed4157`; el agente fusionó la cabeza paso a paso hasta `71521bc`, re-fijó los hashes que E12 movió —preset de visor `0x17514303`/`0x6db6039b`, bordes E11 `0x3d8f85de`—, reescribió `o1.rsb`/`ambient.rsb` por el `RNDR` de 64 B y los 88 hashes de escena del manifiesto de L6, y pasó todas las puertas). Árbol `Repackshot-u11` borrado. Pendiente aparte: re-renderizar las 88 miniaturas de L6 tras E12 (punto 2 de abajo), ahora con E9 dentro. |
| E9 (a, a2, b, c) | `e9` | **Fusionada en la rama de sesión** (`d0f6373`, 16-10; el agente fusionó la cabeza hasta el merge del PR #10 en `55b7fab` con todas las puertas en verde y re-fijó los pins: ejemplo `0x75ba4cb4`, O1 `0x087d1276`, E11 `0xd01702ce`, O3a `0x21e43bb1`, E9 `0x5b5ea281`, ambiente `0xeb60bea2`). El único rojo que dejó, el contraste de `GRADIENT_POOL` (1,96 < 2 con la energía de E9a), lo arregló el responsable subiendo el charco de 0,70 a 0,85 y re-renderizando las 88 miniaturas (`PRESET` y `GRADIENT_POOL` cambian). Árbol `Repackshot-e9` borrable. |
| E6 (bisel, madera, tela) | `e6` | **Fusionada en la rama de sesión** (`563086d`, 16-10; el agente nuevo fusionó la cabeza `cdd4486` en `11e3442` resolviendo `MATL` con el bisel de E6 en el byte 72 y los campos de E9 detrás, el integrador, `rt-cli`, `engine.yml` y las docs, y re-fijó los tres pins de E6 que movió E9a: bisel `0x2f228634` → `0xeacaae75`, madera `0x6fbc91f7` → `0x5ed1bf32`, tela `0x5604ec69` → `0x53e6a855`; puertas en verde en `e143e59` salvo el manifiesto de miniaturas). **Veredicto**: las 88 miniaturas se rehacen con el bisel del Doctor (la escena que construye el código) y se re-fija el PNG de `STRIP_EDGE`. Árbol `Repackshot-e6` borrable. |
| O3a → O2 | `o1` | **Fusionadas en la rama de sesión**: O3a (`1ea775c`) y **O2** (`57b2c90`, 16-10; su commit final `593d480`: lente trazada, rayos de cámara por lotes —13,7 % del render del ejemplo, antes 29,1 %—, *Cámara ▸ Lente*, el pico a través de la distorsión de *Rápido*; `PINNED_O2_TRACED_4SPP = 0x8f7d0ef8`). **Pendiente de Fable** (regla 11): el veredicto de la hoja (`out/lens-sheet.html`, regenerable con `tools/lens-sheet.mjs`; entregada al usuario en imágenes), el muestreo por máscara, las constantes del adaptador y las focales de los gráficos (`ROADMAP.md` §O2, punto 11). Árbol `Repackshot-o1` borrable. |
| S4a partículas de aire | `s4a` | **Fusionada en la rama de sesión** (`af63f6f` + líneas de CI en `abca87b`; el agente fusionó antes M3a, S2 y la cabeza en `6e5799d` y pasó todas las puertas; hash de la escena de ambiente re-fijado tras E12 a `0x415d7d74`, partículas `0xe38b8480`). Árbol `Repackshot-s4a` borrado. **S4b** en cola (brief en `ROADMAP.md` tras S4a). |
| S2 cuerpos rígidos | `s2` | **Fusionada en la rama de sesión** (`e0ce931`; el agente fusionó antes la cabeza con M3a en `cb4de73` y pasó todas las puertas). Árbol `Repackshot-s2` borrado; la rama `s2` y `wip/ccr-8df3f848/s2` quedan. |
| M3a editor por nodos | `m3a` | **Fusionada en la rama de sesión** (5e898cb, trailers reescritos al fusionar; veredicto en `ROADMAP.md` §M3a). Si una sesión nueva ve esta fila es que la fusión está ya en `origin`; el árbol `Repackshot-m3a` se puede borrar. |

## Corte por límite de uso (14-10, ~12:40 UTC) y puntos de control

El límite de uso cortó a la vez a los seis agentes en marcha. Antes de
reanudarlos (el límite se restableció a las 13:50 UTC) el responsable dejó
cada árbol de trabajo en un *commit* y empujó todas las ramas `wip/`:

| Agente | Dónde estaba | Punto de control |
| --- | --- | --- |
| S2 | fusión de la cabeza hecha (`a5e8f1f`) y `physics-check` sobre la línea de tiempo de N6 (`9f7bcad`); le falta fusionar M3a y el párrafo de veredicto | árbol limpio |
| S4a | fusión de la cabeza resuelta, puertas sin correr | `70573e3` (merge commit WIP) |
| U11 | documentación de E11 | árbol limpio en `89c82f7` |
| E9 | ediciones del integrador de E9b (paredes, bandera *exact*, MIS) | `146edb0` (1 archivo) |
| E6 | razonamiento de la madera en el ROADMAP y huecos; tela por empezar | `fb247b7` (3 archivos + 1 nuevo) sobre `0c4095f` |
| O3a/O2 | párrafo final de O3a en el ROADMAP; O2 empezada (exportar la lente trazada en rt-wasm) | `304696f` (2 archivos + 1 nuevo) |

Reanudados los seis con `SendMessage` (mismos ids de agente; no se crean
agentes nuevos). Si una sesión nueva no tiene esos agentes, cada rama `wip/`
contiene todo: crear el árbol de trabajo (receta al final) y lanzar un agente
nuevo con el brief de la fase del ROADMAP y la orden de seguir desde el último
*commit* (el mensaje de cada WIP dice dónde estaba).

## Reporte de errores: triaje y B1 (16-10)

El triaje del reporte del usuario está en `docs/TRIAGE.md` (17 puntos: dos
*bugs* confirmados —el enfoque con clic que deshace el mismo clic y el color
de la tela al pasar a nodos—, faltas que ya tienen fase y decisiones para
Fable). `ROADMAP.md`, sección «Reporte de errores del usuario», define **B1**
(Sonnet: enfoque con clic, tela a nodos, extensión `.repack`, intentos de la
IA contados y la vista previa que no se reinicia), **U14** (Opus, tras B1:
vista en vivo en la cola), 1.4 tras O2, y la lista de decisiones para Fable.
B1 está **fusionada** (`01edd43`, commit final `75f3a88`; las cuatro correcciones con sus tests y la comprobación de navegador `tools/focus-click-check.mjs`). Pendiente del usuario: el registro del lanzador de
una pasada de IA con intentos (2.2) y una escena donde el *denoise* lave
colores (4.2).

## Corte por límite semanal (15-10) y reanudación (16-10, 10:00 UTC)

El límite **semanal** cortó la sesión el 15-10 con dos agentes vivos (E6 y
O2) y al responsable a medias del retoque de `GRADIENT_POOL`. Al volver
(16-10, el límite se restableció a las 10:00 UTC) los agentes ya no existen
(no se reanudan con `SendMessage`): el responsable dejó `o1` en `5a576de`
con el árbol de O2 tal cual, empujó `wip/ccr-8df3f848/o1` y
`wip/ccr-8df3f848/e6` (`1dc375e`, limpio), terminó el retoque (charco 0,85,
44 tests de sets en verde), guardó el reporte de errores del usuario en
`docs/TODO.md` y abrió el PR #11. E6 y O2 siguen con agentes nuevos (lanzados el 16-10 a las 10:30 UTC) desde
esos *commits*, con el brief de su fase y los veredictos de abajo. El bucle
de empuje de las ramas `wip/` no está en marcha: cada agente empuja su rama
tras cada *commit* (o el responsable).

## Veredictos dados a S2 y S4a (14-10, por si la sesión corta antes de que lleguen a `ROADMAP.md`)

- **S2.** El cabezal en 0: confirmado como está hecho (los nodos que sostiene una simulación grabada enseñan su fotograma también en 0, visor y foto fija, y el *gizmo* se oculta sobre ellos): el fotograma 0 de una animación renderizada tiene que ser el inicio de la caída, y la foto fija sigue al cabezal, que la simulación deja al final. Densidades por familia: aceptadas como valores típicos (revisar en M4). Decisión 2 a medias (los clips crecen por el *store* dentro del único paso de deshacer): aceptada. El resto de «no encajó»: aceptado y anotado.
- **S4a.** Criterio 5 (coste ≤ 1,3×) se aplica a las densidades de los presets, no al tope de 200 000: S4b lo mide primero (escena de coste al número del preset en `tools/ambient-sheet.mjs`); la BVH de partículas se queda; la rejilla en pantalla para rayos de cámara solo si una escena de preset medida pasa de 1,3×. Densidades fotográficas: aceptadas. Polvo a contraluz: S4b da a polvo, polen y polvareda un lóbulo hacia delante (Henyey–Greenstein, g ≈ 0,7). Moteado de la lluvia bajo la clave lateral: S4b, las gotas no hacen cáusticas (el rayo de sombra pasa con su cobertura, sin refracción). Colocación (Ambiente tras Entorno, tope en el bloque del motor), ensanchado por probabilidad, `FXAM` de 192 bytes, conjuntos tras la BVH de instancias: aceptados. **S4b** queda en cola con esos cuatro puntos (brief que escribe el agente de S4a en su fusión, tras S4a).

## Pendiente del responsable (orden)

0. Hecho: con el wasm reconstruido tras E12 (`npm run engine:build`),
   `REPACK_REQUIRE_POST_WASM=1 npx vitest run tests/optics.test.ts` pasa
   entero (14 tests): la miniatura de bokeh (`PINNED_BOKEH_THUMB`) no se
   movió y la escena O1 da el hash re-fijado también en el wasm. Nada
   pendiente aquí.
1. Fusionar lo que entregue cada agente en la rama de sesión: resolver
   conflictos (CHANGELOG/ROADMAP/ARCHITECTURE por secciones añadidas;
   `MATL`: bisel E6, campos E9, bloque de texturas M2a), `npm run check`,
   `npx vitest run --maxWorkers=2`, `npm run build`; si toca el motor,
   `cargo fmt/clippy/test` y `npm run engine:build` (el wasm de
   `public/engine/` no se sube: recompilarlo antes de los tests de
   paridad). Empujar solo a `ccr-8df3f848-6ukiky`. Actualizar la
   descripción del PR #7.
2. Hecho (16-10): las 88 miniaturas de L6 renderizadas con el motor de E9
   por el agente de E9 y, tras su fusión, el retoque de `GRADIENT_POOL`
   (charco 0,85) con `node tools/setup-thumbs.mjs` entero;
   `tests/sets.test.ts` en verde (44). La hoja `tools/sets-sheet.mjs` no se
   rehízo (no cambia ningún veredicto).
3. Fases en cola (briefs ya escritos en `ROADMAP.md`): M2b texturas en
   motor (tras E6 y E9), M3b motor evalúa grafos (tras M2b y M3a), M4
   capa de realismo, E10 adaptativo, E13 MNEE, S3 lluvia/polvo y cristal
   frontal (tras S4a y S2), S9 telas, S7 líquidos, M5 tejido y pelusa
   (tras S8), O2.
4. **Release v0.1.7** (16-10, con E9, E6, O3a, las miniaturas, **B1** —fusionada en `01edd43`— y **O2** —fusionada en `57b2c90`, con el veredicto de Fable de la hoja pendiente—; petición del usuario: «haz el release en cada cambio»): commit de versión en la rama de sesión, PR a `main`, y `release.yml` lanzado en `main` con `tag` = `v0.1.7` y `commit` = el merge. Notas en `docs/release-notes/v0.1.7.md` (lista de Windows, puntos 65 a 73). A partir de aquí, **cada cambio que entre en `main` sale en una release** (B1 → v0.1.8, O2 → la siguiente, o juntas si llegan a la vez); las líneas de CHANGELOG de los agentes van a un `## Sin publicar` nuevo encima de la última versión.
5. **Release v0.1.6 publicada** (14-10, run 38600597560 sobre `c413669`, etiqueta `v0.1.6`, release 412955577): los cuatro *assets* subidos por el workflow (portable Windows 11 329 872 B, portable Linux 11 158 342 B, instalador 9 426 684 B, `SHA256SUMS.txt`). El primer intento (run 38599628176) falló en el *smoke test* porque leía la trama del lanzador con cabecera de 48 B (U11 la subió a 52): arreglo en `packaging/smoke.mjs` (PR #8). **Falta `film-0.1.0.rpk` como asset**: el proxy de GitHub de la sesión rechaza cuerpos binarios (solo JSON), así que lo sube el usuario a mano (el archivo se le entregó en el chat; sha `a60dd9ed…3d8a`, 1 956 072 B); hasta entonces *Ajustes ▸ Plugins ▸ Instalar* del registro falla la descarga (instalar desde archivo sí funciona).
   (procedimiento en `ROADMAP.md` P1 y `release-notes/`): subir además
   `film-0.1.0.rpk` reconstruido por P6b (sha256
   `a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`,
   1 956 072 B; entregado al usuario en el chat) como *asset*
   de la release; la clave de activación la tiene el usuario (no está en
   ningún repositorio). La primera actualización desde la app es de esta
   versión a la siguiente.
6. `docs/TODO.md` guarda dos documentos del usuario tal cual: la especificación diferida (Room Builder, paseos, paneles del canvas, físicas de ambiente y viento, servidor MCP, emisor/desagüe de líquido, vídeo con IA consistente y Open Gate; nudos de la madera) y, desde el 16-10, el **reporte de errores graves** (mapeado, tamaño y desplazamiento de texturas en el editor de materiales; gota y geometrías variadas en Ambiente; elección de lentes con distorsión y bokeh visibles, ventana de elementos al pasar por la lente y editor de lentes; maderas y nodos que no pilotan el material; focal como *toggle* cámara/objeto; enfoque en el píxel exacto del clic; Render IA que no hace casi nada y se queda en bucle de intentos; vista previa en vivo en la cola; extensión `.repack`; denoise que lava luces y colores; materiales que no se ajustan al tamaño del sólido; presets de estudio dentro de Estudios con sus luces como añadidos desactivables; y, aparte, una doble barra en el carrusel de LUTs de aintfilm). **El reporte va antes que la especificación**: son regresiones y faltas de lo publicado; se convierte en fases del `ROADMAP.md` (brief y veredictos del responsable) en cuanto terminen E6 y O2.

## Para reanudar una fase

```bash
git fetch origin
git worktree add /home/user/Repackshot-<fase> -b <fase> origin/wip/ccr-8df3f848/<fase>
ln -s /home/user/Repackshot/node_modules /home/user/Repackshot-<fase>/node_modules
```

Con ese enlace en el árbol, **nunca** `git add -A` sin mirar antes `git status`:
el `.gitignore` ya cubre `node_modules` con y sin barra (desde `1cdefb0`),
pero un *checkpoint* anterior (`70573e3`) llegó a seguir el enlace y cada
*checkout* de la rama sustituía el `node_modules` real por un enlace a sí
mismo; si pasa, `git rm --cached node_modules`, borrar el enlace y `npm ci`.

Lanzar un agente (Opus para motor/UI grandes, Sonnet para lo mecánico)
con: el brief de la fase en `ROADMAP.md`, los veredictos de arriba, las
reglas de `CLAUDE.md`, los dos *trailers* de *commit* de esta sesión, y
la orden de no empujar. Las decisiones marcadas **Fable** las toma el
responsable con hojas de contacto (regla 11).
