# Repackshot — punto de entrada para agentes y personas

Repackshot es un renderizador de producto al estilo KeyShot, de código
disponible y gratuito para uso no comercial (PolyForm Noncommercial 1.0.0),
escrito **desde cero en sala limpia**, que corre en el navegador: importa
un modelo, asigna materiales, ilumina con un estudio y renderiza una
imagen bonita, rápido. Toma sus ideas de EZ Packshot (addon de Blender del
mismo autor): tipos de producto, catálogo de montajes de luz por estilos,
materiales con desgaste procedural, Doctor, selección por niveles,
lenguaje de fotógrafo.

## Lee esto en este orden

1. `README.md` — reglas de sala limpia. **Innegociables.**
2. `docs/ROADMAP.md` — qué hay que hacer, en qué fase, y **qué modelo
   ejecuta cada fase** (Fable decide; Opus construye; Sonnet porta y
   mecaniza; Haiku hace las tareas de mantenimiento). Busca tu fase y
   lee solo lo que necesita.
3. `docs/SPEC.md` — qué hace el producto (comportamiento, modelo de datos).
4. `docs/ARCHITECTURE.md` — stack, mapa de módulos, *store*, motores.
5. `docs/UI.md` — la interfaz, control por control.
6. `docs/INTERIORS.md` — interiores y mobiliario: decisión de integración,
   fuentes y fases K1–K8. Solo si tu fase es una de esas.
7. `docs/AI-POST.md` — post-procesado IA opcional: modelo, protecciones,
   interfaz y fases X1–X5. Solo si tu fase es una de esas.

## Antes de tocar nada

```bash
npm ci
npm run qa            # tipos + tests + build de la interfaz. Tiene que estar en verde.
npm run engine:test   # cargo test del motor. También en verde.
npm run screenshot    # deja out/screenshot.png con el Chromium local
```

Para tocar el motor (`engine/`), además: `cargo fmt --all -- --check`,
`cargo clippy --workspace --all-targets -- -D warnings` y
`cargo build -p rt-wasm --target wasm32-unknown-unknown --release`, desde
`engine/`.

## Reglas de trabajo (no negociables)

1. **Sala limpia.** Nada derivado de binarios de KeyShot. Fuentes: literatura
   pública, código abierto con licencia compatible, observación de caja
   negra. Ni un nombre de archivo con "keyshot": el `.gitignore` lo
   ignoraría en silencio.
2. **Una fase del roadmap por PR**, con `npm run qa` en verde antes de
   abrirlo y la fase marcada como hecha en `docs/ROADMAP.md` con un párrafo
   de qué se hizo y qué no encajó con el plan.
3. **Todo bug corregido lleva su test**, y se comprueba que el test falla
   si se reintroduce el bug. Si un bug se escapó porque un test o un
   *mock* era más permisivo que la realidad, se arregla también el test.
4. **El cromo de la interfaz es acromático.** Blanco, negro y grises, en
   los dos temas. El color solo está en el contenido (render, miniaturas).
5. **Toda cadena de la interfaz existe en `es` y en `en`** en
   `src/ui/strings.ts`. Inglés por defecto.
6. **Toda mutación pasa por el *store*** (`src/core/store.ts`) y es
   deshacible. `ui → core`, `render → core`, `io → core`; nunca al revés.
7. **Claves de catálogo estables** (`src/data/`): se añade, no se renombra.
8. **Licencia y dependencias**: el proyecto es **PolyForm Noncommercial
   1.0.0** (`LICENSE`; resumen en el `README`): gratis para fines no
   comerciales, ningún uso comercial sin licencia aparte del titular.
   Por eso las dependencias de la interfaz solo pueden ser permisivas
   (MIT/Apache/BSD/ISC/CC0), nunca copyleft (GPL, AGPL) ni no comerciales,
   y llevan una línea en `docs/ARCHITECTURE.md` §1. Única excepción:
   `occt-import-js` (LGPL-2.1) para STEP e IGES, aislada con las
   condiciones de ese apartado. **En el motor, ninguna**:
   `engine/` es Rust desde cero, solo `std`; nada de crates.io, nada
   copiado de otros renderizadores. CI lo comprueba.
8b. **El motor es portable y determinista**: sin APIs del sistema en
   `rt-core`, sin `unsafe` fuera del módulo `simd`, del *shim* de wasm y
   de `rt-app/src/platform/` (la ventana nativa: Win32 y WebView2),
   `f32` en todo, y la misma escena con la misma semilla da los mismos
   píxeles en cualquier arquitectura y con cualquier número de hilos.
   `clippy -D warnings` y `cargo fmt` limpios.
9. Código, identificadores y comentarios en **inglés**; documentación en
   **español**; la interfaz en los dos idiomas.
10. **No se inventan números en la interfaz**: el medidor del visor pinta
    lo que el motor dice. Lo que no está hecho se marca *próximamente*.
11. Las decisiones marcadas **Fable** en el roadmap (fotográficas, de
    criterio visual, de arquitectura) no las toma otro modelo por su
    cuenta: se preparan los datos y se deja anotado.
12. Cuando algo no encaje con los documentos, se anota en el PR y se sigue
    con lo que sí encaja; no se "arregla" el contrato por cuenta propia.

## Trampas conocidas

- `npm run screenshot` captura el `dist/` (hay que hacer `npm run build`
  antes) y usa `--use-gl=swiftshader`: la captura sale, pero lenta.
- `src/main.ts` tiene que dejar `#app[data-ready="1"]` cuando la interfaz
  ha pintado, o la captura se toma antes de tiempo.
- three.js es Y-arriba y el modelo es Z-arriba: la conversión vive solo en
  `src/render/preview.ts` (`toThree`).
- `pkill -f "vite"` mata la propia shell que lo lanza. Usa
  `pgrep -f "[v]ite"`.
- En este entorno crates.io está bloqueado (403). No importa: el motor no
  tiene dependencias. `rustup target add wasm32-unknown-unknown` sí
  funciona.
- `rt.wasm` no se sube al repositorio: `npm run engine:build` lo genera en
  `public/engine/`; la interfaz tiene que arrancar sin él (solo con la
  vista previa) y decirlo en el medidor.
