# public/assets: assets generados

Todo lo de esta carpeta sale de **un generador propio y determinista** del
repositorio (`tools/assets/`), nunca de un modelo de imagen por IA, de una
fotografía ni de ninguna biblioteca de terceros (sala limpia, `docs/STUDIO-TOOLS.md`
§0). Cada fichero se guarda como **receta** (tipo y parámetros), **semilla** y
**hash** del resultado; el `index.json` de cada carpeta lo lista.

| Carpeta | Qué | Generador | Tamaño |
| --- | --- | --- | --- |
| `aperture/` | 45 máscaras de diafragma y texturas de pupila: polígonos de 3 a 18 láminas (rectas y curvas), estrellas de 4, 5, 6 y 8 puntas, corazón, varios agujeros (7 y 19), anillos con obstrucción 0,3 y 0,5, anillos de cebolla, polvo, rayas y malla de filtro | `tools/assets/aperture-masks.mjs` | 512 × 512, gris de 8 bits |
| `gobo/` | 12 patrones de gobo: ventanas (2×3, 3×4, en arco), persianas (rectas e inclinadas), hojas (dos densidades), luz moteada, puntos, líneas, ráfaga radial y rotura suave | `tools/assets/gobos.mjs` | 1024 × 1024, gris de 8 bits |

## Cómo se regeneran y se comprueban

```bash
node tools/assets/aperture-masks.mjs           # escribe public/assets/aperture/
node tools/assets/gobos.mjs                    # escribe public/assets/gobo/
node tools/assets/aperture-masks.mjs --check   # regenera en memoria y compara con lo que hay en disco
node tools/assets/gobos.mjs --check
```

`tests/assets.test.ts` lo hace en cada `npm run qa`: regenera cada fichero con
las funciones puras del generador y exige el mismo *hash*. Un fichero tocado a
mano, una receta cambiada sin regenerar o un generador que deje de ser
determinista fallan ahí.

## Qué dice el `index.json`

Por cada fichero: `id` (clave estable, se añade, no se renombra), `file`,
`recipe` (los parámetros de los que depende el resultado), `seed`, `size`,
`bytes` y dos *hashes* SHA-256:

- `pixelsSha256`: de los píxeles en bruto (gris de 8 bits). **Es el canónico**:
  no depende de nada más que de la receta y la semilla.
- `sha256`: del PNG tal como está escrito, para comprobar su integridad. Los bytes
  de un flujo comprimido pueden cambiar entre versiones de zlib, los píxeles no.

## Determinismo

El generador usa solo `+ − × ÷` y `sqrt` (que IEEE 754 fija al bit) y funciones
propias (`sin`, `cos`, ruido de valor por *hash* entero, `mulberry32`); nunca
`Math.sin`, `Math.exp`, `Math.pow` ni `Math.random`. Las semillas están en la receta.

## Convenciones

- **Máscaras de diafragma.** La imagen cubre [−1, 1]², con v hacia arriba y el
  círculo unidad inscrito. El gris es la **transmisión de la pupila** (255 abierto,
  0 cerrado). Las formas tienen el radio circunscrito en 1 (los vértices tocan el
  círculo); el primer vértice mira hacia arriba. Las láminas curvas usan redondez
  0,5 (`docs/research/optics.md` §1: κ = radio inscrito / radio del arco de la
  lámina; 1 es un círculo, 0 láminas rectas). Las texturas (polvo, rayas, malla,
  anillos de cebolla) se dibujan dentro del disco unidad y valen 0 fuera: el motor
  las multiplica por la forma del diafragma. Los anillos de cebolla son una
  modulación de amplitud 1: el motor la escala con su amplitud.
- **Gobos.** La imagen cubre [−1, 1]², con v hacia arriba; el gris es la luz que
  pasa (255 abierto). La luz lo proyecta en su propio espacio.

## Qué usa estos ficheros

`src/data/bokeh.json` apunta a las máscaras por su `id` (un test comprueba que
todos existen y que se usan todas las que no son polígonos); los gobos los usará
la fase L7. Si se añade un asset: se añade su receta al generador, se regenera y
se sube con el `index.json`.
