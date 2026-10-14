# Estado de la sesión (14-10-2026) — cómo reanudar sin perder nada

Este archivo lo escribe el responsable (Fable) para que cualquier sesión
nueva pueda seguir donde se quedó esta. Lo que cuenta es lo que hay en
`origin`: la rama de sesión `ccr-8df3f848-6ukiky` (**PR #9** hacia `main`; el PR #7
se fusionó en `main` el 14-10 con la release v0.1.6 y el PR #8 llevó el arreglo
del *smoke test* de la release) y las ramas `wip/ccr-8df3f848/<fase>` con el trabajo en curso
de cada agente (se empujan tras cada *commit* de su agente; un *commit*
«WIP» puede tener tests en rojo). Los árboles de trabajo locales
(`/home/user/Repackshot-<fase>`) y el *scratchpad* son efímeros.

## Fusionado en la rama de sesión (PR #7)

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
| E9 (a, a2, b, c) | `e9` | **Entregada entera** (`9e8b075`: (a)+(a2) energía GGX, (b) medios por paseo aleatorio con estimador de salida, pared fina y ruleta, (c) dispersión por número de Abbe con una longitud de onda por camino; receta `CRYSTAL`, 87 recetas; hojas en el *scratchpad* `e9-deliver/`; puertas en verde; `PINNED_E9_MEDIA_4SPP = 0xf693c26b` antes de E12). **Veredicto dado**: aceptada tal cual (sin MIS espectral, una escena de paridad, grano de color a 64 spp aceptado). El agente está fusionando la cabeza (`4613b14`): integrador con E12/O1/S4a, `MATL`, `cli.rs`, pins, inspector, docs, paso de CI de E9. Después de U11 fusiona la cabeza otra vez. E6 fusiona después de E9 (comparten `MATL`). |
| E6 (bisel, madera, tela) | `e6` | **Entregada entera** (`9ca2ff6`: bisel `59656ed`/`977307e`, madera con nudos a 45° `0c4095f`, tela hilo a hilo `9ca2ff6` con escena propia `rt --write-e6-cloth-example` = `0xbb26399f`; hojas en `out/cloth-sheet.html`, `out/cloth-contact-*.png`; puertas en verde). **Veredicto dado**: hilos/cm de la tabla propuesta aceptados; vaquero 3/1 (`TWILL31`); carbono con relieve 0,05 (el barniz que ignore el bulto, para M4); `yarnTwist` sin mando; malla sin agujeros hasta la opacidad de M2b; terciopelo sin brillo hasta S8. El agente fusiona la cabeza (`1ed4157`) y, cuando E9 entre, la fusiona otra vez resolviendo `MATL` con los campos de los dos. |
| O3a → O2 | `o1` | **O3a fusionada en la rama de sesión** (`1ea775c`, tras la release: va al PR #9 / v0.1.7; sus líneas de CHANGELOG en una sección «Sin publicar» nueva sobre la v0.1.6). O2 (lente trazada) en marcha en `o1` con puntos de control; al entregarla, fusionar solo su commit final (no la punta con WIP). |
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
2. Tras E9 (E12 y E11 ya están): recompilar `rt` (`cargo build -p rt-cli --release` →
   `/home/user/bin/rt`) y el wasm; remedir los sets de L6
   (`REPACKSHOT_SET_MEASURES=1 npx vitest run tests/sets.test.ts -t
   measures`; umbrales en `tests/thumb-metrics.ts` `LOOK`), retocar solo
   los EV que crucen un umbral, y renderizar una sola vez las 88
   miniaturas (`node tools/setup-thumbs.mjs`) y la hoja
   (`tools/sets-sheet.mjs`); los sets con chispas (STRIP_EDGE,
   WARM_COOL_CINEMA, BLACK_ON_BLACK, GLASS_DARK_FIELD, SILHOUETTE_GLOW,
   JEWEL_BOX) deben salir limpios con E12.
3. Fases en cola (briefs ya escritos en `ROADMAP.md`): M2b texturas en
   motor (tras E6 y E9), M3b motor evalúa grafos (tras M2b y M3a), M4
   capa de realismo, E10 adaptativo, E13 MNEE, S3 lluvia/polvo y cristal
   frontal (tras S4a y S2), S9 telas, S7 líquidos, M5 tejido y pelusa
   (tras S8), O2.
4. **Release v0.1.6** (14-10): commit `ec67370` en la rama, PR #7 fusionado en `main` (`f6f5ed3`); el primer `release.yml` (run 38599628176) construyó los tres paquetes y falló en el *smoke test* porque leía la trama del lanzador con cabecera de 48 B (U11 la subió a 52): arreglo en `packaging/smoke.mjs` (PR #8, `c413669`), release relanzada desde ese commit (run 38600597560). Queda: comprobar los cuatro *assets* y subir `film-0.1.0.rpk` con `gh release upload v0.1.6 <archivo>` (sha `a60dd9ed…3d8a`, 1 956 072 B). Lo que llegue después (E9, E6, O2) va al PR #9 (v0.1.7).
   (procedimiento en `ROADMAP.md` P1 y `release-notes/`): subir además
   `film-0.1.0.rpk` reconstruido por P6b (sha256
   `a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`,
   1 956 072 B; entregado al usuario en el chat) como *asset*
   de la release; la clave de activación la tiene el usuario (no está en
   ningún repositorio). La primera actualización desde la app es de esta
   versión a la siguiente.
5. Especificación diferida en `docs/TODO.md` (Room Builder, paseos, paneles del canvas, físicas de ambiente y viento, servidor MCP, emisor/desagüe de líquido, vídeo con IA consistente y Open Gate; nudos de la madera): se retoma cuando acabe todo lo anterior.

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
