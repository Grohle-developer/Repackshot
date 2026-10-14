// The film simulation plugin for Repackshot (ABI v1, src/plugins/abi.ts): glue between the host's messages and the
// film engine's WebAssembly module, which comes in the same encrypted package. Written for Repackshot; the engine,
// its recipes and its words are the plugin's own.
//
// The module's C ABI, as its own documentation states it: every buffer that crosses is allocated in module memory
// with `inf_alloc(len)` and given back with `inf_free(ptr, len)`; settings cross as the engine's JSON; the
// diagnostics of the last render and the last error are read back as UTF-8 (`inf_info_ptr/len`,
// `inf_error_ptr/len`). Any allocation may grow the module's memory, which detaches every view over the old buffer:
// so no view is ever held across a call into the module, and each one is taken from `memory.buffer` at the moment
// it is used. Two renders are used here:
//
//   inf_render_rgba(input, w, h, space, json, jsonLen, output) → 0
//       8-bit RGBA in and out (`w·h·4` bytes); space 0 is sRGB.
//   inf_render_linear_rgba(planes, side, sideLen, w, h, spaceOut, json, jsonLen, out) → 0
//       linear light of the working space (Rec. 709 primaries, values above one kept) as three `f32` planes and the
//       side-data record in, 8-bit RGBA in `spaceOut` out: what a render's EXR light is given to, with no 8-bit
//       round trip. The side record here carries nothing (version 1, no profile, no mask, a count of one, no
//       baseline exposure, an as-shot balance of one, every variance factor one): 4·(14 + 3·36) bytes.
//
// The recipes are the package's presets (recipes.json names them with their public names, presets/ holds the
// engine's settings of each, complete); the controls are the manifest's, and `settings()` below turns a recipe and
// the controls into the engine's settings: a control switches a stage off, chooses a format, a filter or a lens, or
// scales a value the recipe already carries; at its left stop a control marked "Recipe" sends nothing, and the
// recipe's own value stands.

const ABI = 1;
const SIDE_SITES = 36;
const SIDE_BYTES = 4 * (14 + 3 * SIDE_SITES);

let api = null;
let manifest = null;
let engine = null;
let neutral = null;
const recipes = new Map();
let categories = [];
let filters = [];
const presetFiles = new Map();
const presetCache = new Map();
const queue = [];
const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ the module

function alloc(len) {
  const ptr = api.inf_alloc(len);
  if (ptr === 0 && len > 0) throw new Error('the film engine is out of memory');
  return ptr;
}

const bytesAt = (ptr, len) => new Uint8Array(api.memory.buffer, ptr, len);
const floatsAt = (ptr, len) => new Float32Array(api.memory.buffer, ptr, len);
const textAt = (ptr, len) => dec.decode(bytesAt(ptr, len).slice());

function lastError() {
  return textAt(api.inf_error_ptr(), api.inf_error_len()) || 'the film engine failed';
}

function lastInfo() {
  try {
    return JSON.parse(textAt(api.inf_info_ptr(), api.inf_info_len()));
  } catch {
    return null;
  }
}

/** The side-data record that carries nothing. */
function emptySide() {
  const out = new Uint8Array(SIDE_BYTES);
  const v = new DataView(out.buffer);
  v.setUint32(0, 1, true);
  v.setUint32(4, 0, true);
  v.setUint32(4 * 8, 0, true);
  v.setFloat32(4 * 9, 1, true);
  v.setFloat32(4 * 10, 0, true);
  for (let c = 0; c < 3; c++) v.setFloat32(4 * (11 + c), 1, true);
  for (let i = 0; i < 3 * SIDE_SITES; i++) v.setFloat32(4 * (14 + i), 1, true);
  return out;
}

/** One render through the module; every buffer is given back, whatever happens. */
function renderFrame(width, height, pixels, settings) {
  const n = width * height;
  const json = enc.encode(JSON.stringify(settings));
  const owned = [];
  const take = (len) => {
    const ptr = alloc(len);
    owned.push([ptr, len]);
    return ptr;
  };
  try {
    const jsonPtr = take(json.length);
    bytesAt(jsonPtr, json.length).set(json);
    const outPtr = take(4 * n);
    let code;
    if (pixels.kind === 'linear-f32-planes') {
      const side = emptySide();
      const inPtr = take(12 * n);
      const sidePtr = take(side.length);
      floatsAt(inPtr, 3 * n).set(pixels.data);
      bytesAt(sidePtr, side.length).set(side);
      code = api.inf_render_linear_rgba(inPtr, sidePtr, side.length, width, height, 0, jsonPtr, json.length, outPtr);
    } else {
      const inPtr = take(4 * n);
      bytesAt(inPtr, 4 * n).set(pixels.data);
      code = api.inf_render_rgba(inPtr, width, height, 0, jsonPtr, json.length, outPtr);
    }
    if (code !== 0) throw new Error(lastError());
    // Copied out before anything is given back (the view is of this moment's memory).
    const rgba8 = new Uint8ClampedArray(bytesAt(outPtr, 4 * n));
    return { rgba8, info: lastInfo() };
  } finally {
    for (const [ptr, len] of owned.reverse()) api.inf_free(ptr, len);
  }
}

// ------------------------------------------------------------------ recipes and controls

const clone = (v) => JSON.parse(JSON.stringify(v));

function preset(file) {
  let p = presetCache.get(file);
  if (!p) {
    const bytes = presetFiles.get(file);
    if (!bytes) throw new Error(`the package has no ${file}`);
    p = JSON.parse(dec.decode(new Uint8Array(bytes)));
    presetCache.set(file, p);
  }
  return p;
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** A slider whose left stop reads "Recipe": its value, or null at that stop (the recipe's own stands). */
function chosen(controls, key) {
  const c = manifest.controls.find((x) => x.key === key);
  const v = num(controls[key], c ? c.default : 0);
  return c && c.minLabel && v <= c.min ? null : v;
}

/** The engine's settings for a recipe and the controls. */
function settings(recipeId, controls) {
  const r = recipeId ? recipes.get(recipeId) : undefined;
  const s = clone(r ? preset(r.file) : neutral);
  const c = controls;

  // Film: the negative's format, the exposure it is given (push, pull), the seed of its grain.
  if (c.format !== 'recipe' && engine.formats[Number(c.format)]) s.format = engine.formats[Number(c.format)];
  s.frame_coverage = 1;
  s.exposure_ev = num(c.exposure, 0);
  s.seed = Math.max(0, Math.round(num(c.seed, 1)));

  // The diffusion filter and the lens: the recipe's own, none, or another one's block merged in.
  if (c.diffusion === 'none') s.diffusion.enabled = false;
  else if (c.diffusion !== 'recipe' && engine.diffusion[Number(c.diffusion)]) s.diffusion = clone(preset(engine.diffusion[Number(c.diffusion)]).diffusion);
  const grade = chosen(c, 'diffusionGrade');
  if (s.diffusion.enabled && grade !== null) s.diffusion.strength = grade;
  if (c.lens === 'none') s.lens.enabled = false;
  else if (c.lens !== 'recipe' && engine.lens[Number(c.lens)]) s.lens = clone(preset(engine.lens[Number(c.lens)]).lens);
  const k = Math.max(0, num(c.lensIntensity, 1));
  if (s.lens.enabled && Math.abs(k - 1) > 1e-4) {
    s.lens.glow = Math.min(0.9, s.lens.glow * k);
    s.lens.axial_ca_um *= k;
    s.lens.lateral_ca *= k;
    s.lens.veiling_glare = Math.min(0.5, s.lens.veiling_glare * k);
    s.lens.vignette_stops = Math.min(4, s.lens.vignette_stops * k);
  }

  // Colour: the film's contrast (its curves' gamma), its saturation, the warmth and the exposure of the print,
  // and how the positive is made (a print, a scan, the film viewed as it is).
  if (c.colour === false) s.color.enabled = false;
  const contrast = num(c.contrast, 1);
  if (Math.abs(contrast - 1) > 1e-4) s.color.curves = s.color.curves.map((cv) => ({ ...cv, gamma: cv.gamma * contrast }));
  const sat = num(c.saturation, 1);
  if (Math.abs(sat - 1) > 1e-4) s.color.saturation *= sat;
  const warmth = num(c.warmth, 0);
  if (Math.abs(warmth) > 1e-4) s.output.balance = [s.output.balance[0] + warmth, s.output.balance[1], s.output.balance[2] - warmth];
  const print = num(c.printExposure, 0);
  if (Math.abs(print) > 1e-4) s.output.print_exposure += print;
  if (c.output === 'print' || c.output === 'scan' || c.output === 'direct') s.output.mode = c.output;
  s.spectral.enabled = s.color.enabled && c.model === 'spectral';

  // Grain: off, or the recipe's scaled (amount, size), its colour, its tonal bias, its softness, the scanner's
  // focus on it, the light window over the granularity, the scan of the grained negative and the renderer.
  const amount = Math.max(0, num(c.grainAmount, 1));
  if (c.grain === false || amount === 0) s.grain.enabled = false;
  s.grain.strength *= amount;
  const size = num(c.grainSize, 1);
  if (Math.abs(size - 1) > 1e-4) s.grain.radius_um = s.grain.radius_um.map((r) => r * size);
  const chroma = chosen(c, 'grainColour');
  if (chroma !== null) s.grain.chroma = chroma;
  s.grain.tone_bias = num(c.grainBias, 0);
  const soft = chosen(c, 'grainSoftness');
  if (soft !== null) {
    s.grain.film_softness = s.grain.softness;
    s.grain.softness = soft;
  }
  s.grain.sharpen = num(c.scannerFocus, 0);
  s.grain.light_window = c.lightResponse !== false;
  s.grain.renderer = c.renderer === 'stochastic' || c.renderer === 'gaussian' ? c.renderer : 'auto';
  if (s.grain.enabled && c.scan !== false) s.scanner = { ...s.scanner, enabled: true, blur_um: engine.scanBlurUm };

  // Halation: off, or the recipe's with its amount and radius when they are moved off "Recipe".
  if (c.halation === false) s.halation.enabled = false;
  const hal = chosen(c, 'halationAmount');
  if (hal !== null) s.halation.strength = hal;
  const radius = chosen(c, 'halationRadius');
  if (radius !== null) s.halation.radius_um = radius;
  return s;
}

/** What the host's meter shows: the engine's own numbers of this render. */
function infoOf(info) {
  const items = [];
  if (info && typeof info.um_per_px === 'number') items.push({ key: 'umPerPx', label: { en: 'Negative per pixel', es: 'Negativo por píxel' }, value: Math.round(info.um_per_px * 100) / 100, unit: 'µm' });
  if (info && typeof info.grain_renderer === 'string' && info.grain_renderer !== '') items.push({ key: 'grain', label: { en: 'Grain', es: 'Grano' }, value: info.grain_renderer });
  if (info && info.capture && typeof info.capture.push_stops === 'number' && info.capture.push_stops !== 0) items.push({ key: 'push', label: { en: 'Push', es: 'Forzado' }, value: Math.round(info.capture.push_stops * 100) / 100, unit: 'EV' });
  if (info && Array.isArray(info.stages)) items.push({ key: 'stages', label: { en: 'Stages', es: 'Etapas' }, value: info.stages.length });
  items.push({ key: 'engine', label: { en: 'Engine', es: 'Motor' }, value: `wasm ${engine.version}` });
  return { items };
}

// ------------------------------------------------------------------ messages

function pump() {
  const msg = queue.shift();
  if (!msg) return;
  try {
    const { rgba8, info } = renderFrame(msg.width, msg.height, msg.pixels, settings(msg.recipe, msg.controls));
    self.postMessage({ type: 'render', id: msg.id, width: msg.width, height: msg.height, rgba8, info: infoOf(info) }, [rgba8.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
  if (queue.length) setTimeout(pump, 0);
}

async function init(msg) {
  manifest = msg.manifest;
  for (const [name, buf] of Object.entries(msg.files)) presetFiles.set(name, buf);
  const json = (name) => JSON.parse(dec.decode(new Uint8Array(presetFiles.get(name))));
  engine = json('engine.json');
  neutral = json(engine.neutral);
  const list = json('recipes.json');
  categories = list.categories;
  filters = Array.isArray(list.filters) ? list.filters : [];
  for (const r of list.recipes) recipes.set(r.id, r);
  // The host compiled the module and checked it imports nothing; it is instantiated with nothing to import.
  const { instance } = await WebAssembly.instantiate(msg.wasm, {});
  api = instance.exports;
  self.postMessage({ type: 'ready', abi: ABI });
}

self.addEventListener('message', (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      init(msg).catch((err) => self.postMessage({ type: 'error', id: null, message: err instanceof Error ? err.message : String(err) }));
    } else if (msg.type === 'info') {
      self.postMessage({ type: 'info', id: msg.id, info: { name: manifest.name, version: manifest.version, engine: `wasm ${engine.version}` } });
    } else if (msg.type === 'presets') {
      // The filters the app's film search has (its TYPE and ISO rows) and the recipes' groups, each recipe with its tags.
      self.postMessage({ type: 'presets', id: msg.id, categories, filters, presets: [...recipes.values()].map((r) => ({ id: r.id, name: r.name, category: r.category, ...(r.aux ? { aux: r.aux } : {}), ...(r.tags ? { tags: r.tags } : {}) })) });
    } else if (msg.type === 'render') {
      queue.push(msg);
      if (queue.length === 1) setTimeout(pump, 0);
    } else if (msg.type === 'cancel') {
      const at = queue.findIndex((q) => q.id === msg.id);
      if (at >= 0) {
        queue.splice(at, 1);
        self.postMessage({ type: 'cancelled', id: msg.id });
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: typeof msg?.id === 'number' ? msg.id : null, message: err instanceof Error ? err.message : String(err) });
  }
});
