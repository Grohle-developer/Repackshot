// A test plugin for Repackshot's host (ABI v1): no WebAssembly, it inverts the colours of what it is given. It runs
// as an ES module in a worker without DOM and speaks only by messages (src/plugins/abi.ts): `init` with its files,
// then `info`, `presets`, `render` and `cancel`. Linear planes are encoded to display bytes with the sRGB curve first.

let recipes = [];
let categories = [];
let manifest = null;
/** Renders waiting their turn: one runs per task, so a `cancel` that arrives before its turn drops it. */
const queue = [];

const toByte = (v) => {
  const x = v > 0 ? (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) : 0;
  return x >= 1 ? 255 : Math.round(x * 255);
};

function render(msg) {
  const { width, height, pixels, recipe, controls } = msg;
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const scale = recipes.find((r) => r.id === recipe)?.scale ?? 1;
  const amount = Math.max(0, Math.min(1, Number(controls.amount ?? 1))) * scale;
  const chan = controls.channel ?? 'all';
  const which = chan === 'r' ? [0] : chan === 'g' ? [1] : chan === 'b' ? [2] : [0, 1, 2];
  for (let i = 0; i < n; i++) {
    const rgb = pixels.kind === 'rgba8' ? [pixels.data[4 * i], pixels.data[4 * i + 1], pixels.data[4 * i + 2]] : [toByte(pixels.data[i]), toByte(pixels.data[n + i]), toByte(pixels.data[2 * n + i])];
    for (const c of which) rgb[c] = Math.round(rgb[c] + (255 - 2 * rgb[c]) * amount);
    if (controls.mono === true) {
      const y = Math.round(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
      rgb[0] = rgb[1] = rgb[2] = y;
    }
    out[4 * i] = rgb[0];
    out[4 * i + 1] = rgb[1];
    out[4 * i + 2] = rgb[2];
    out[4 * i + 3] = 255;
  }
  return {
    rgba8: out,
    info: {
      items: [
        { key: 'pixels', label: { en: 'Pixels', es: 'Píxeles' }, value: n },
        { key: 'input', label: { en: 'Input', es: 'Entrada' }, value: pixels.kind },
        { key: 'amount', label: { en: 'Inverted', es: 'Invertido' }, value: Math.round(amount * 100), unit: '%' },
      ],
    },
  };
}

function pump() {
  const msg = queue.shift();
  if (!msg) return;
  try {
    const { rgba8, info } = render(msg);
    self.postMessage({ type: 'render', id: msg.id, width: msg.width, height: msg.height, rgba8, info }, [rgba8.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      manifest = msg.manifest;
      const text = new TextDecoder().decode(new Uint8Array(msg.files['recipes.json']));
      const data = JSON.parse(text);
      recipes = data.recipes;
      categories = data.categories;
      self.postMessage({ type: 'ready', abi: 1 });
    } else if (msg.type === 'info') {
      self.postMessage({ type: 'info', id: msg.id, info: { name: manifest.name, version: manifest.version, engine: 'JavaScript' } });
    } else if (msg.type === 'presets') {
      self.postMessage({ type: 'presets', id: msg.id, categories, presets: recipes.map((r) => ({ id: r.id, name: r.name, category: r.category })) });
    } else if (msg.type === 'render') {
      queue.push(msg);
      setTimeout(pump, 0);
    } else if (msg.type === 'cancel') {
      const at = queue.findIndex((q) => q.id === msg.id);
      if (at >= 0) {
        queue.splice(at, 1);
        self.postMessage({ type: 'cancelled', id: msg.id });
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id ?? null, message: err instanceof Error ? err.message : String(err) });
  }
});
