# Estado de la sesión (14-10-2026) — cómo reanudar sin perder nada

Este archivo lo escribe el responsable (Fable) para que cualquier sesión
nueva pueda seguir donde se quedó esta. Lo que cuenta es lo que hay en
`origin`: la rama de sesión `ccr-8df3f848-6ukiky` (PR #7; CI: `suite` en
verde; `engine` con el hash de la lente O1 re-fijado tras E12 en el último
*commit*: `PINNED_O1_LENS_4SPP = 0x1439a1a8`) y las ramas `wip/ccr-8df3f848/<fase>` con el trabajo en curso
de cada agente (se empujan tras cada *commit* de su agente; un *commit*
«WIP» puede tener tests en rojo). Los árboles de trabajo locales
(`/home/user/Repackshot-<fase>`) y el *scratchpad* son efímeros.

## Fusionado en la rama de sesión (PR #7)

M2a texturas · P5 actualizar desde la app · L6 sets de estudio · U12
TIFF/DNG · O1 lente fina y bokeh · U13 proporción en la cámara · P6
plugins + plugin de película · E12 elección de luz por punto · P6b
carrusel con deslizador y filtros · N6 despieces y línea de tiempo. Cada fase está marcada «hecha» en
`ROADMAP.md` con su párrafo *Hecho / Qué no encajó*.

## En curso (rama `wip/ccr-8df3f848/<fase>`; brief en `ROADMAP.md`)

| Fase | Rama | Estado y siguiente paso |
| --- | --- | --- |
| U11 + U11b + E11 | `u11` | U11 (denoise en directo) y U11b (intensidad) confirmados; E11 (suavizado de bordes) aceptado con **Fino** por defecto en proyectos nuevos; falta el *commit* de E11 y la entrega conjunta. Fusionar los tres de una vez. |
| E9 (a, a2, b, c) | `e9` | (a)+(a2) confirmados (`d736374`: horno 1,000; +13–16 % de luminancia difusa). (b) medios dispersores: estimador de salida (Chiang 2016) en verde; decididos: ruleta por el peso del camino desde la entrada, regla de **pared fina** para líquidos en vidrio (sesgo medido), test de leche por acuerdo con el camino exacto; falta la hoja a 64/256 spp, el *commit* de (b) y (c) dispersión. |
| E6 (bisel, madera, tela) | `e6` | Bisel confirmado (`59656ed`, `977307e`). Madera con nudos: veredicto dado (desviación 1,5–3 radios, bulto 0,35 R, nudos solo con incidencia ≥ 30°, nota «6 pedidos · 3 caben»); falta el *commit* de madera y la tela (hilos/cm realistas: algodón 40, vaquero 26, lona 12, punto 5…). |
| O3a → O2 | `o1` | O1 fusionado. O3a (filtros de lente) hecho en borrador del agente: motor, interfaz, previa WebGL; hoja renderizando; para estrella/rayas/brillo con fuentes pequeñas, medir MIS entre dispersión de pupila y NEE a través de la PSF. Después O2 (lente trazada). |
| S4a partículas de aire | `s4a` | **Entregada** (`6a7c096`; hoja `out/ambient-sheet.html`, capturas `docs/ui/ambient-*.png`). Veredictos dados (ver abajo); el agente está fusionando la cabeza de la rama de sesión en `s4a` (conflictos con E12 en la selección de luz desde partículas, `cli.rs`, inspector, `rsb.ts`, Doctor, docs) y re-fijando sus hashes (E12 los mueve). Al recibirla: fusionar, añadir a `.github/workflows/engine.yml` las líneas `--write-ambient-example` + `wasm-parity.mjs --particles --expect-particles <hash>` y `tests/effects-rsb.test.ts` en el paso del `rt.wasm` real. |
| S2 cuerpos rígidos | `s2` | **Entregada** (`cb862bc`; capturas `docs/ui/physics-*.png`; puertas del motor en verde). Veredictos dados (ver abajo); el agente está fusionando la cabeza de la rama de sesión en `s2` (23 archivos: el panel de animación es el de N6 entero con el clip `PHYSICS` portado; `playheadPose` respeta `poseActive` de N6; Doctor: 14 + `aspect` + `physics`). Al recibirla: fusionar antes que S4a. |
| M3a editor por nodos | `m3a` | Programas de material, intérprete de referencia y vista previa; sigue con el editor (ventana, lienzo) y los diez grafos. |

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
2. Tras E9 + E12: recompilar `rt` (`cargo build -p rt-cli --release` →
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
4. Release v0.1.6 desde `main` cuando el usuario fusione el PR #7
   (procedimiento en `ROADMAP.md` P1 y `release-notes/`): subir además
   `film-0.1.0.rpk` reconstruido por P6b (sha256
   `a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`,
   1 956 072 B; entregado al usuario en el chat) como *asset*
   de la release; la clave de activación la tiene el usuario (no está en
   ningún repositorio). La primera actualización desde la app es de esta
   versión a la siguiente.

## Para reanudar una fase

```bash
git fetch origin
git worktree add /home/user/Repackshot-<fase> -b <fase> origin/wip/ccr-8df3f848/<fase>
ln -s /home/user/Repackshot/node_modules /home/user/Repackshot-<fase>/node_modules
```

Lanzar un agente (Opus para motor/UI grandes, Sonnet para lo mecánico)
con: el brief de la fase en `ROADMAP.md`, los veredictos de arriba, las
reglas de `CLAUDE.md`, los dos *trailers* de *commit* de esta sesión, y
la orden de no empujar. Las decisiones marcadas **Fable** las toma el
responsable con hojas de contacto (regla 11).
