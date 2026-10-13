# Interfaz (`src/ui/`)

La interfaz de `docs/UI.md`: HTML + CSS + TypeScript sin framework. Habla
con el modelo solo a través del *store* (`src/core/store.ts`); nunca
importa de `render/` ni de `io/` (eso lo conecta `src/main.ts` mediante
`AppServices`, ver `ports.ts`).

| Fichero | Qué |
| --- | --- |
| `strings.ts` | Todas las cadenas, en `en` y `es` lado a lado; `t()`, `L()` (las dos lenguas, para etiquetas de deshacer) |
| `theme.css` | *Tokens* de color (acromáticos, test `ui-achromatic`), tipografía y medidas |
| `layout.css`, `components.css`, `panels.css` | Regiones, controles y paneles |
| `reactive.ts` | `Scope.watch(selector, fn)`: actualizaciones finas por referencia, sin DOM virtual |
| `prefs.ts` | El documento de ajustes (U6, `core/settings.ts`) en `localStorage` bajo `repackshot.settings` (`{schema, settings, layout}`): migra las claves sueltas de antes (`repackshot.lang`, `.theme`, `.ui.*`) y las borra; uno dañado se aparta en `.corrupt` |
| `settings-effects.ts` | Lo que un ajuste cambia fuera de la ventana (U6): tamaño de interfaz y de texto, contraste, movimiento, foco, retardo de *tooltips*, navegación y rejilla del visor, motor, límites del historial, anuncios para lector de pantalla |
| `settings.css` | La ventana de Ajustes |
| `ui-state.ts` | Estado de interfaz (pestañas, cajones, anchos…); la parte que se recuerda (`Layout`) va al documento de ajustes con `try/catch`. Incluye `library`, la biblioteca propia (U4): estado de usuario, fuera del proyecto y de deshacer; `main.ts` la guarda con `io/library.ts` |
| `commands.ts` | Lo que hacen botones, paleta y teclado; devuelve una confirmación en línea cuando hace falta. Proyecto (U2): `saveProject` (con `saveAs`), `openProject`, `openProjectFile`, `requestNewProject`, `dropFiles`; preguntan por los cambios sin guardar con `ui.prompt`, que la cabecera pinta bajo el nombre del proyecto |
| `shortcuts.ts` | El único mapa de atajos: teclado, paleta y *tooltips* |
| `render-queue.ts` | La cola en marcha (U5): *Render* solo sus trabajos, *Iniciar cola* todos en orden, *Pausar*, detener, fotogramas de una animación, guardado y historial; siempre con el trazador (`renderFrame`) |
| `components/` | `NumberField`, `Slider`, `Segmented`, `Toggle`, `Select`, `Section`, miniaturas, confirmación en línea, menús, *tooltip*, paleta; `library.ts`: campo de nombre en línea, tarjetas y filas de *Míos* con renombrar y eliminar, pie Exportar / Importar; `split-compare.ts`: dos imágenes cualesquiera con un divisor deslizable (U5; X3 lo reutiliza); `material-drag.ts`: arrastrar un material con eventos de puntero (U7: fantasma, zonas donde soltar, `Esc`, `Alt` = copia) |
| `updates.ts` | Las actualizaciones tal como las corre la interfaz: pedir la última versión publicada a `services.updates`, guardar la respuesta (`updateCheckedAt`, `updateLatest`, en el `layout` de los ajustes), anunciar una versión nueva una sola vez (aviso discreto en la barra de estado, nunca una ventana) y abrir la descarga o las notas |
| `panels/settings-*.ts` | La ventana de Ajustes (U6, UI.md §2.9): `settings-window.ts` (ventana, búsqueda, enlaces profundos, teclado), `settings-rows.ts` (filas desde los metadatos), `settings-sections.ts` (filas propias: medir rendimiento, almacenamiento, escritorio, Acerca de con las licencias), `settings-ai.ts` (modelo activo, gestor de modelos, licencias, importar, equipo y recomendación), `settings-updates.ts` (Actualizaciones: versión, *Buscar actualizaciones* con su resultado, *Comprobar al iniciar*, última comprobación) |
| `panels/` | Cabecera, escena, visor, inspector, barra inferior (cajones Animación y Cola, último resultado, *Render…*), ventana de render (`render-window.ts`), visor de resultados (`results-viewer.ts`), estado, guía |

## Parámetros de URL (demos y capturas)

Todos pasan por los mismos comandos que usaría una persona, así que el
resultado es un estado normal y deshacible.

| Parámetro | Efecto |
| --- | --- |
| `example=1` | Carga la pieza de ejemplo |
| `preset=JEWELLERY` | Elige ese tipo de producto (`STUDIO_PRESETS`) y crea el estudio |
| `setup=REMBRANDT` | Elige ese montaje de luz (`LIGHT_SETUPS` o `PRESET`) y muestra su estilo en el catálogo |
| `theme=dark\|light\|system` | Tema (si no, el guardado o el del sistema; oscuro salvo que el sistema pida claro) |
| `lang=en\|es` | Idioma |
| `drawer=animation\|queue` | Abre ese cajón de la barra de render |
| `panels=collapsed` | Pliega los dos paneles laterales (modo imagen) |
| `select=cap` | Selecciona un nodo por su clave de ejemplo (`model`, `closure`, `base`, `body`, `label`, `collar`, `cap`) o por su nombre |
| `catalog=1` | Abre el catálogo de materiales (en la categoría del material seleccionado) |
| `material=GOLD` | Asigna ese material a la selección (o a todo) |
| `sequence=HERO` | Aplica ese preset de animación (`SEQUENCE_PRESETS`) |
| `t=2` | Pone el cursor de animación en ese segundo |
| `guide=1..6` | Abre la guía en ese paso |
| `tool=select\|orbit\|pan\|zoom\|move` | Activa esa herramienta del visor (`move`: la herramienta de mover, con el *gizmo* sobre la selección) |
| `mode=fast\|full` | Modo del visor (*Rápido* o *Completo*); *Completo* entra en cuanto el motor ha cargado |
| `render=image\|animation` | Abre la ventana de render (U5) en *Imagen* o en *Animación* |
| `settings=general\|ai.models\|…` | Abre Ajustes en esa sección o en esa fila o parte (enlace profundo: `openSettings`) |

Ejemplos usados para las capturas de `docs/ui/`:

```
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark
?example=1&theme=light&select=cap&catalog=1
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&drawer=animation&sequence=HERO&t=2
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&select=cap&tool=move
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&mode=full
```

`#app[data-ready="1"]` aparece cuando la interfaz ha pintado, el visor ha
dibujado su primer fotograma y las esferas de material visibles están
renderizadas (con un tope de 9 s).
