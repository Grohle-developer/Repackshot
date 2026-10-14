# Publicar un plugin: el `.rpk` como *asset* y su clave

Cómo sale un plugin de Repackshot (P6, `ARCHITECTURE.md` §9) con una release: el
paquete cifrado se sube como *asset* de la release, el registro
(`src/data/plugins.json`) lo fija por su tamaño y su `sha256`, y la clave de
activación **nunca** entra en el repositorio. El primero es el de película de
aintfilm, en la **v0.1.6**.

## 1 · Construir el paquete

Desde la raíz del repositorio, con un *checkout* de aintfilm al lado (solo se
lee):

```bash
# Un plugin nuevo: una clave nueva, escrita solo en --key-out (fuera del repositorio).
node tools/plugins/build-film.mjs --aintfilm ../aintfilm --rpk ~/plugins/film-0.1.0.rpk --key-out ~/plugins/film-activation-key.txt

# Una versión nueva del mismo plugin: la misma clave, para que quien lo tiene lo actualice sin teclear otra.
node tools/plugins/build-film.mjs --aintfilm ../aintfilm --rpk ~/plugins/film-0.1.1.rpk --key-file ~/plugins/film-activation-key.txt --version 0.1.1
```

La salida tiene que decir *no listed mark, product name or retired id in the
manifest, the recipes, the glue, the logo, the licence or Repackshot's strings*:
si la comprobación de marcas (D112 de aintfilm) encuentra algo en lo que ve el
público, el *build* falla. Las líneas *the checkout's own tags* son las
etiquetas internas del motor (en el módulo y en los ajustes de los *presets*),
que aintfilm renombra en sus M38-07 y M38-08; se cuentan, no paran el *build*.
Al final imprime la versión, los **bytes** y el **sha256** del paquete.

Cada empaquetado usa un *nonce* nuevo: el mismo contenido da otro `sha256`. El
registro tiene que fijar el archivo que se sube, no otro construido después.

## 2 · Fijarlo en el registro

En `src/data/plugins.json`, la entrada del plugin (su `id` no cambia nunca):

- `version`: la del paquete;
- `url`: `https://github.com/Grohle-developer/Repackshot/releases/download/v<release>/film-<versión>.rpk`
  (el nombre del *asset* tiene que ser exactamente ese);
- `sha256` y `bytes`: los que imprimió el *build*;
- `keyUrl`: vacío mientras el desarrollador no aloje la clave (entonces se pide
  al instalar; ver §4).

`npm run qa` comprueba la forma de la entrada y que la `url` sea la de la
release. Después, la comprobación de navegador con el paquete de verdad:

```bash
npm run engine:build && npm run build
node tools/plugins-check.mjs --film ~/plugins/film-0.1.0.rpk --film-key ~/plugins/film-activation-key.txt
```

Su punto `d_registry_pins_this_package` falla si el archivo no es el que fija el
registro. Deja `docs/ui/settings-plugins.png` y `docs/ui/render-plugins-film.png`.

## 3 · Subirlo con la release

Con la release ya creada (`packaging/release.mjs`), el paquete como un *asset*
más:

```bash
gh release upload v0.1.6 ~/plugins/film-0.1.0.rpk
```

Antes de anunciarla, descárgalo desde la página de la release y comprueba que
es el mismo: `sha256sum film-0.1.0.rpk` tiene que dar el `sha256` del registro.
Y ábrelo con la clave, sin escribir nada en claro más que en una carpeta
temporal: `node tools/plugin-unpack.mjs film-0.1.0.rpk --header` (la cabecera,
comprobada) y `node tools/plugin-unpack.mjs film-0.1.0.rpk /tmp/film --key-file
~/plugins/film-activation-key.txt`.

## 4 · La clave

- **No va en el repositorio**, ni en un *commit*, ni en el registro, ni en las
  notas de la release, ni en un *issue*: el anfitrión es de código disponible y
  no puede guardar secretos. La guarda el desarrollador.
- Mientras `keyUrl` esté vacío, *Ajustes ▸ Plugins ▸ Instalar* la pide: el
  desarrollador la da a quien vaya a instalar el plugin (un mensaje, la página
  del proyecto).
- Para no pedirla: alojarla en una dirección https del desarrollador cuya
  respuesta sea el texto de la clave (con CORS para el origen de la web, y sin
  caché), y poner esa dirección en `keyUrl` en la siguiente versión. El
  desarrollador puede rotarla o condicionarla más adelante: una clave nueva va
  con un paquete nuevo (otra versión, otra entrada del registro); quien tiene el
  anterior lo conserva.
- Lo que protege el cifrado y lo que no: `ARCHITECTURE.md` §9.1.

## 5 · Para las notas de la v0.1.6

Un párrafo para *Qué hay de nuevo*:

> **Plugins, y el primero: aintfilm · simulación de película.** *Ajustes ▸
> Plugins* instala herramientas de otros programas, cada una con su licencia. La
> primera es el motor de película de **aintfilm**, la app de edición de fotos y
> simulación de película del mismo desarrollador, en desarrollo (un adelanto):
> en la ventana de render, la sección *Plugins* tiene sus recetas (51 películas,
> su color solo, granos, filtros de difusión y objetivos), los mandos de su
> editor (formato del negativo, exposición y forzado, color, grano, halación,
> difusión, copia o escaneo, semilla), una vista previa del último resultado y
> *Aplicar*, que deja un resultado nuevo en el visor. **Su licencia es cerrada**:
> la de Repackshot no lo cubre. Se activa con una clave que da su desarrollador.

Y una fila para *Descargas*:

> **film-0.1.0.rpk**: el plugin de película (1,8 MB). No se abre a mano: se
> instala desde *Ajustes ▸ Plugins ▸ Instalar*, que lo descarga de aquí y
> comprueba su `sha256`, o con *Instalar desde archivo…*; pide la clave de
> activación.

Y para la lista de comprobación en Windows (WebView2):

1. [ ] *Ajustes ▸ Plugins ▸ aintfilm · simulación de película ▸ Instalar*: baja,
   pide la clave, una clave mal escrita se dice, la buena lo instala; sale su
   logo y se abren su licencia y sus avisos.
2. [ ] Cierra y abre la aplicación: sigue instalado.
3. [ ] Un render, y en la ventana de render la sección *Plugins*: la vista
   previa con una receta (*CN-01*), la línea del plugin y el tiempo; *Aplicar*
   deja un resultado nuevo con su procedencia y su archivo `_aintfilm-film.png`.
4. [ ] *Quitar*: se borra, y el proyecto conserva sus ajustes.
