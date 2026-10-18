# Publishing a plugin: the `.rpk` as an asset and its key

How a Repackshot plugin (P6, `ARCHITECTURE.md` §9) ships with a release: the
encrypted package is uploaded as a release *asset*, the registry
(`src/data/plugins.json`) pins it by its size and its `sha256`, and the
activation key **never** goes into the repository. The first one is aintfilm’s
film plugin, in **v0.1.6**.

## 1 · Build the package

From the repository root, with an aintfilm checkout alongside (it is only read)
and the plugin owner’s logo image (white dots on black, the cartridge with the
three greys of the tongue; the developer keeps it, like the key, and it does not
go into the repository):

```bash
# A new plugin: a new key, written only to --key-out (outside the repository).
node tools/plugins/build-film.mjs --aintfilm ../aintfilm --logo ~/plugins/aintfilm-logo.png --rpk ~/plugins/film-0.1.0.rpk --key-out ~/plugins/film-activation-key.txt

# A new version of the same plugin: the same key, so whoever has it can update without typing another.
node tools/plugins/build-film.mjs --aintfilm ../aintfilm --logo ~/plugins/aintfilm-logo.png --rpk ~/plugins/film-0.1.1.rpk --key-file ~/plugins/film-activation-key.txt --version 0.1.1
```

The *logo:* line says where the logo came from: *15×15 dots from …* (121 dots,
the inks `#808080`, `#BFBFBF`, `#E0E0E0` and `#FFFFFF`) with `--logo`; without
it, the checkout’s `LOGO` grid, which is not the owner’s logo (another shape and
a single grey): it is not published like that.

The base image of the recipe cards, `tools/plugins/film/thumb-base.png`, is in
the repository (it is ours); if the scene changes, it is redone with:

```bash
cd engine
cargo run --release -p rt-cli -- --write-film-thumb film-thumb.rsb
cargo run --release -p rt-cli -- film-thumb.rsb -o ../tools/plugins/film/thumb-base.png --samples 512 --denoise
```

A new version of the plugin redoes the card images on each machine (they are
stored per version): with the same version and another package, the earlier ones
would stay.

The output has to say *no listed mark, product name or retired id in the
manifest, the recipes, the glue, the logo, the licence or Repackshot's strings*:
if the trademark check (D112 of aintfilm) finds something in what the public
sees, the build fails. The *the checkout's own tags* lines are the engine’s
internal labels (in the module and in the presets’ settings), which aintfilm
renames in its M38-07 and M38-08; they are counted, they do not stop the build.
At the end it prints the version, the **bytes** and the **sha256** of the
package.

Each packaging uses a fresh *nonce*: the same content gives another `sha256`.
The registry has to pin the file that is uploaded, not another one built later.

## 2 · Pin it in the registry

In `src/data/plugins.json`, the plugin’s entry (its `id` never changes):

- `version`: the package’s;
- `url`: `https://github.com/Grohle-developer/Repackshot/releases/download/v<release>/film-<version>.rpk`
  (the asset’s name has to be exactly that);
- `sha256` and `bytes`: the ones the build printed;
- `keyUrl`: empty while the developer does not host the key (then it is asked
  for at install time; see §4).

`npm run qa` checks the shape of the entry and that the `url` is the release’s.
Then, the browser check with the real package:

```bash
npm run engine:build && npm run build
node tools/plugins-check.mjs --film ~/plugins/film-0.1.0.rpk --film-key ~/plugins/film-activation-key.txt
```

Its `d_registry_pins_this_package` point fails if the file is not the one the
registry pins. It leaves `docs/ui/settings-plugins.png` and
`docs/ui/render-plugins-film.png`.

## 3 · Upload it with the release

With the release already created (`packaging/release.mjs`), the package as one
more asset:

```bash
gh release upload v0.1.6 ~/plugins/film-0.1.0.rpk
```

Before announcing it, download it from the release page and check that it is
the same: `sha256sum film-0.1.0.rpk` has to give the registry’s `sha256`. And
open it with the key, writing nothing in the clear except in a temporary folder:
`node tools/plugin-unpack.mjs film-0.1.0.rpk --header` (the header, checked) and
`node tools/plugin-unpack.mjs film-0.1.0.rpk /tmp/film --key-file
~/plugins/film-activation-key.txt`.

## 4 · The key

- **It does not go in the repository**, nor in a commit, nor in the registry, nor
  in the release notes, nor in an issue: the host is source-available and cannot
  keep secrets. The developer keeps it.
- While `keyUrl` is empty, *Settings ▸ Plugins ▸ Install* asks for it: the
  developer gives it to whoever is going to install the plugin (a message, the
  project page).
- To avoid asking for it: host it at an https address of the developer whose
  response is the key’s text (with CORS for the web origin, and no cache), and
  put that address in `keyUrl` in the next version. The developer can rotate it
  or make it conditional later: a new key goes with a new package (another
  version, another registry entry); whoever has the previous one keeps it.
- What the encryption protects and what it does not: `ARCHITECTURE.md` §9.1.

## 5 · Text for the v0.1.6 notes

A paragraph for *What's new*:

> **Plugins, and the first one: aintfilm · film simulation.** *Settings ▸
> Plugins* installs tools from other programs, each with its own licence. The
> first is the film engine of **aintfilm**, the photo-editing and film
> simulation app from the same developer, in development (a preview): in the
> render window, the *Plugins* section has its recipes (51 films, their colour
> alone, grains, diffusion filters and lenses), the controls of its editor
> (negative format, exposure and push, colour, grain, halation, diffusion, print
> or scan, seed), a preview of the last result and *Apply*, which leaves a new
> result in the viewer. **Its licence is closed**: Repackshot’s does not cover
> it. It is activated with a key that its developer provides.

And a row for *Downloads*:

> **film-0.1.0.rpk**: the film plugin (1.9 MB). It is not opened by hand: it is
> installed from *Settings ▸ Plugins ▸ Install*, which downloads it from here and
> checks its `sha256`, or with *Install from a file…*; it asks for the
> activation key.

For testers, the manual Windows test plan for plugins (WebView2) is in the
*Plugin installation* section of
[docs/testing/windows-checklist.md](https://github.com/Grohle-developer/Repackshot/blob/main/docs/testing/windows-checklist.md).
