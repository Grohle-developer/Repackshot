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
| `ui-state.ts` | Estado de interfaz (pestañas, cajones, anchos…); lo que se recuerda va a `localStorage` con `try/catch`. Incluye `library`, la biblioteca propia (U4): estado de usuario, fuera del proyecto y de deshacer; `main.ts` la guarda con `io/library.ts` |
| `commands.ts` | Lo que hacen botones, paleta y teclado; devuelve una confirmación en línea cuando hace falta |
| `shortcuts.ts` | El único mapa de atajos: teclado, paleta y *tooltips* |
| `components/` | `NumberField`, `Slider`, `Segmented`, `Toggle`, `Select`, `Section`, miniaturas, confirmación en línea, menús, *tooltip*, paleta; `library.ts`: campo de nombre en línea, tarjetas y filas de *Míos* con renombrar y eliminar, pie Exportar / Importar |
| `panels/` | Cabecera, escena, visor, inspector, barra de render (cajones Animación y Cola), estado, guía |

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

Ejemplos usados para las capturas de `docs/ui/`:

```
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark
?example=1&theme=light&select=cap&catalog=1
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&drawer=animation&sequence=HERO&t=2
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&select=cap&tool=move
```

`#app[data-ready="1"]` aparece cuando la interfaz ha pintado, el visor ha
dibujado su primer fotograma y las esferas de material visibles están
renderizadas (con un tope de 9 s).
