#!/usr/bin/env node
// The thumbnails of the Bokeh selector (phase O1), rendered by the engine itself: for every type of
// src/data/bokeh.json that the enhanced thin lens can do, and every variant, the kernel scene of tools/bokeh-scene.mjs
// (small lights far behind the focus plane on black) rendered by `rt` and written to public/thumbs/bokeh/, with an
// index.json of the parameters, the RSB's hash and the pixels' hash. Deterministic: the same data give the same files.
//
//   node tools/bokeh-thumbs.mjs                  writes public/thumbs/bokeh/*.png and index.json
//   node tools/bokeh-thumbs.mjs --check          renders again and compares with what is on disk
//   node tools/bokeh-thumbs.mjs --sheet          writes out/bokeh-sheet.html: every type at 480 × 360, 256 spp, and
//        [--samples N] [--only key,key]          a second row of pure kernels (lights of a fifteenth of the blur disc,
//        [--reuse]                               512 spp) for the textures, the chromatic fringes and a plain disc, and
//                                                a third of texture close-ups (one light filling the frame, 1024 spp);
//                                                --reuse keeps the images already in out/bokeh-sheet/ except --only's
//
// It builds `rt` (cargo build --release -p rt-cli in engine/) when needed. The types that need the traced lens or
// wave optics have no thumbnail: the selector says what they wait for.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { decodePng } from './assets/common.mjs';
import { bokehParams, bokehScene, CLOSE_UP, halve, PICTURE_SIZE, PURE_LIGHT_MM, SCENE, SHEET_SIZE, THUMB_SIZE, thumbnails } from './bokeh-scene.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const THUMB_SAMPLES = 1024;
const OUT_DIR = join(ROOT, 'public/thumbs/bokeh');
const data = JSON.parse(readFileSync(join(ROOT, 'src/data/bokeh.json'), 'utf8'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// --- pictures ------------------------------------------------------------------------------------------------------

const cache = new Map();
function picture(id) {
  if (!cache.has(id)) {
    const file = join(ROOT, 'public/assets/aperture', `${id.replace(/_/g, '-')}.png`);
    const { width, pixels } = decodePng(new Uint8Array(readFileSync(file)));
    cache.set(id, width === PICTURE_SIZE ? pixels : halve(pixels, width));
  }
  return cache.get(id);
}

// --- PNG -------------------------------------------------------------------------------------------------------------

/** The RGB pixels of a PNG written by `rt` (8-bit RGB, any filter). */
function decodeRgb(png) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  for (;;) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IHDR') {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
      if (png[o + 16] !== 8 || png[o + 17] !== 2) throw new Error('expected an 8-bit RGB PNG from rt');
    } else if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? px[y * stride + x - 3] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 3 && y > 0 ? px[(y - 1) * stride + x - 3] : 0;
      const r = raw[y * (stride + 1) + 1 + x];
      const p = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (Math.abs(b - c) <= Math.abs(a - c) && Math.abs(b - c) <= Math.abs(a + b - 2 * c) ? a : Math.abs(a - c) <= Math.abs(a + b - 2 * c) ? b : c) : 0;
      px[y * stride + x] = (r + p) & 0xff;
    }
  }
  return { width, height, pixels: px };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An 8-bit RGB PNG, every row with the Sub filter, deflated at level 9. */
function encodeRgb(pixels, width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = (pixels[y * stride + x] - (x >= 3 ? pixels[y * stride + x - 3] : 0)) & 0xff;
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(body).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// --- rendering -------------------------------------------------------------------------------------------------------

function rtBinary() {
  const bin = join(ROOT, 'engine/target/release', process.platform === 'win32' ? 'rt.exe' : 'rt');
  execFileSync('cargo', ['build', '--release', '-p', 'rt-cli', '--quiet'], { cwd: join(ROOT, 'engine'), stdio: 'inherit' });
  if (!existsSync(bin)) throw new Error(`no ${bin}`);
  return bin;
}

const scratch = join(ROOT, 'out/bokeh-tmp');

/** Renders the kernel scene of `thin` with `rt`: the RGB pixels and the RSB. */
function render(rt, thin, size, samples, name, lightMm = SCENE.lightDiameterMm, scene = SCENE) {
  mkdirSync(scratch, { recursive: true });
  const rsb = bokehScene(thin, size, samples, picture, lightMm, scene);
  const rsbPath = join(scratch, `${name}.rsb`);
  const pngPath = join(scratch, `${name}.png`);
  writeFileSync(rsbPath, rsb);
  execFileSync(rt, [rsbPath, '-o', pngPath, '--samples', String(samples)], { stdio: 'pipe' });
  return { rsb, ...decodeRgb(new Uint8Array(readFileSync(pngPath))) };
}

const only = opt('only', null)?.split(',') ?? null;
const reuse = flag('reuse');
const list = thumbnails(data).filter((t) => reuse || !only || only.includes(t.key));
const rt = rtBinary();

/** The pure-kernel row of the sheet: the textures, the chromatic fringes and a plain disc for reference. */
const PURE = ['disc', 'onion_rings', 'textured', 'textured/scratches', 'textured/filter', 'chromatic_fringes'];
const PURE_SAMPLES = 512;
/** The close-up row: the textures with one light filling the frame (CLOSE_UP). */
const CLOSE = ['onion_rings', 'textured/scratches', 'textured/filter'];
const CLOSE_SAMPLES = 1024;

if (flag('sheet')) {
  const samples = Number(opt('samples', 256));
  const dir = join(ROOT, 'out/bokeh-sheet');
  mkdirSync(dir, { recursive: true });
  const neutral = { blades: 0, roundness: 1, rotationDeg: 0, profile: 'uniform', profileParam: 0, obstruction: 0, catsEye: 0, squeeze: 1, streaks: 0, caAmount: 0, swirl: 0, onionAmplitude: 0 };
  const card = (t, file, spp, lightMm, scene = SCENE) => {
    const thin = bokehParams(data, t.key, t.variant);
    const keep = reuse && existsSync(join(dir, file)) && !(only && only.includes(t.key));
    const started = performance.now();
    if (!keep) {
      const img = render(rt, thin, SHEET_SIZE, spp, `sheet-${file.replace(/\.png$/, '')}`, lightMm, scene);
      writeFileSync(join(dir, file), encodeRgb(img.pixels, img.width, img.height));
      console.log(`${file}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
    const type = data.types.find((x) => x.key === t.key);
    const variant = t.variant ? type.variants.find((v) => v.key === t.variant) : null;
    const set = Object.entries(thin).filter(([k, v]) => v !== null && v !== neutral[k]);
    return { t, file, type, variant, set, spp, lightMm };
  };
  const cards = list.map((t) => card(t, t.file, samples, SCENE.lightDiameterMm));
  const pure = PURE.map((name) => {
    const [key, variant = null] = name.split('/');
    const t = thumbnails(data).find((x) => x.key === key && x.variant === variant) ?? { key, variant, file: `${key}.png` };
    return card(t, t.file.replace(/\.png$/, '--pure.png'), PURE_SAMPLES, PURE_LIGHT_MM);
  });
  const close = CLOSE.map((name) => {
    const [key, variant = null] = name.split('/');
    const t = thumbnails(data).find((x) => x.key === key && x.variant === variant) ?? { key, variant, file: `${key}.png` };
    return card(t, t.file.replace(/\.png$/, '--close.png'), CLOSE_SAMPLES, CLOSE_UP.lightDiameterMm, CLOSE_UP);
  });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const figure = (c) =>
    `<figure><img src="bokeh-sheet/${c.file}" alt="${esc(c.type.name.en)}"><figcaption><b>${c.type.n}. ${esc(c.type.name.es)}${c.variant ? ` · ${esc(c.variant.name.es)}` : ''}</b> <span class="k">${esc(c.t.key)}${c.t.variant ? `/${esc(c.t.variant)}` : ''} · luces de ${c.lightMm} mm · ${c.spp} spp</span><br>${esc(c.type.description.es)}<br><code>${c.set.map(([k, v]) => `${k} ${v}`).join(' · ') || 'neutro'}</code></figcaption></figure>`;
  const waiting = data.types.filter((t) => t.requires !== null);
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Bokeh sheet</title>
<style>
body{background:#111;color:#ddd;font:13px/1.4 system-ui,sans-serif;margin:24px}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
p{margin:0 0 16px;color:#999;max-width:960px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:20px}
figure{margin:0}
img{display:block;width:480px;height:360px;background:#000}
figcaption{padding:6px 0;max-width:480px}
b{color:#fff}
code{color:#aaa;font-size:12px}
.k{color:#777}
</style></head><body>
<h1>Bokeh: los ${list.length} núcleos del modo 1 (lente fina mejorada)</h1>
<p>Escena de puntos de luz de <code>tools/bokeh-scene.mjs</code>: un 85 mm a f/${SCENE.fstop} enfocado a ${SCENE.focusMm} mm, doce luces de ${SCENE.lightDiameterMm} mm (un quinto del disco de desenfoque a esa distancia) a ${SCENE.lightDepthMm / 1000} m en una rejilla de 4 × 3 (las de las esquinas a 0,84 de la altura de imagen), fondo negro, curva sRGB, ${samples} muestras por píxel, renderizado por <code>rt</code>. Los valores son los de <code>src/data/bokeh.json</code>, provisionales hasta el veredicto (regla 11). Sin núcleo propio en O1: ${waiting.map((t) => `${esc(t.name.es)} (${t.requires === 'wave' ? 'óptica de ondas, próximamente' : 'lente trazada, O2'})`).join(', ')}.</p>
<div class="grid">
${cards.map(figure).join('\n')}
</div>
<h1 style="margin-top:32px">Núcleo puro</h1>
<p>La misma escena con luces de ${PURE_LIGHT_MM} mm (un quinceavo del disco de desenfoque, la radiancia escalada por la razón de áreas para el mismo brillo) y ${PURE_SAMPLES} muestras: el núcleo casi sin convolucionar con la fuente, para ver las texturas y los flecos. Con fuentes tan pequeñas cada píxel recibe pocas muestras que acierten la luz: el grano es del muestreo, no del núcleo.</p>
<div class="grid">
${pure.map(figure).join('\n')}
</div>
<h1 style="margin-top:32px">Primer plano de las texturas</h1>
<p>Las texturas no se leen en la fila de arriba aunque se suba su amplitud (los anillos de cebolla a amplitud 1, en vez de 0,45, salen igual): sus detalles miden menos que la fuente y casi lo mismo que un píxel (un periodo de los anillos son unos 4 px en un disco de 90 px, la fuente de un quinceavo son 6 px), y cada píxel solo acierta la luz en 1 de cada 225 muestras. Aquí, una sola luz llena el encuadre: un ${CLOSE_UP.focalMm} mm a f/${CLOSE_UP.fstop} (la misma pupila de entrada que el 85 mm a f/1,6, un disco de unos 320 px) y una fuente de ${CLOSE_UP.lightDiameterMm} mm, un cuarentavo del disco, a ${CLOSE_SAMPLES} muestras. Los anillos se adivinan a través del grano; las rayas y la malla, apenas. Cada píxel acierta la luz en 1 de cada 1600 muestras: el grano sigue siendo del muestreo, y para que desaparezca harían falta del orden de 50 000 muestras por píxel. La amplitud no cambia (0,45): que las texturas se lean en un render corriente es cosa de la receta (detalles más gruesos).</p>
<div class="grid">
${close.map(figure).join('\n')}
</div></body></html>
`;
  writeFileSync(join(ROOT, 'out/bokeh-sheet.html'), html);
  console.log(`wrote out/bokeh-sheet.html (${cards.length} + ${pure.length} + ${close.length} images)`);
} else {
  const check = flag('check');
  const indexPath = join(OUT_DIR, 'index.json');
  const known = check ? JSON.parse(readFileSync(indexPath, 'utf8')) : null;
  const entries = [];
  let bad = 0;
  for (const t of list) {
    const thin = bokehParams(data, t.key, t.variant);
    const img = render(rt, thin, THUMB_SIZE, THUMB_SAMPLES, t.file.replace(/\.png$/, ''));
    const entry = { key: t.key, variant: t.variant, file: t.file, width: img.width, height: img.height, samples: THUMB_SAMPLES, thin, rsbSha256: sha256(img.rsb), pixelsSha256: sha256(img.pixels) };
    if (check) {
      const was = known.thumbs.find((e) => e.file === t.file);
      if (!was || was.pixelsSha256 !== entry.pixelsSha256 || was.rsbSha256 !== entry.rsbSha256) {
        console.error(`${t.file}: differs from the committed thumbnail`);
        bad++;
      }
    } else {
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, t.file), encodeRgb(img.pixels, img.width, img.height));
    }
    entries.push(entry);
  }
  if (check) {
    console.log(bad ? `${bad} thumbnails differ` : `all ${entries.length} thumbnails match`);
    process.exit(bad ? 1 : 0);
  }
  const index = {
    generator: 'tools/bokeh-thumbs.mjs',
    scene: 'tools/bokeh-scene.mjs',
    version: 1,
    note: 'Rendered by rt from the kernel scene; pixelsSha256 is of the raw 8-bit RGB pixels (canonical), rsbSha256 of the scene file.',
    thumbs: entries,
  };
  if (only && existsSync(indexPath)) {
    // A partial run keeps the other thumbnails' entries, in the order of the data.
    const old = JSON.parse(readFileSync(indexPath, 'utf8')).thumbs;
    const order = thumbnails(data).map((t) => t.file);
    index.thumbs = order.map((f) => entries.find((e) => e.file === f) ?? old.find((e) => e.file === f)).filter(Boolean);
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  console.log(`wrote ${entries.length} thumbnails to public/thumbs/bokeh/`);
}
rmSync(scratch, { recursive: true, force: true });
