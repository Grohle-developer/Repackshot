// A mark drawn as a dot grid (ROADMAP P6 decision 7): the film plugin's logo, read at build time and written as an
// SVG into the closed bundle; neither the rows nor the picture are ever copied into this repository. It comes from
// one of two places:
//
// - the owner's picture of the logo (`--logo <png>` of build-film.mjs: white dots on black, greys allowed), read
//   dot by dot (`readDotPicture`): the columns and rows of dots found by where there is ink, the ink of each dot its
//   grey, the greys quantised to the levels the picture has; what the user calls the logo, and so what wins;
// - or the cartridge grid of the aintfilm checkout (`LOGO` of its `src/data/marks.ts`), read as text, its cells by
//   the rule the checkout's `DotGrid` draws by:
//
//     `#`  a dot in the ink
//     `.`  nothing, unless the grid is a two-ink one, and then a dot in the dimmer ink
//     ` `  nothing, always
//
//   a grid saying for itself which of the two it is: a grid with a space in it is a two-ink grid (its ground is
//   spaces, so its `.` cells are dots), a grid with none is a grid whose `.` cells are holes.
//
// Each dot is one `rect` in its square cell, centred, as wide as the dots it was read from (0.84 of a cell for the
// checkout's: twice its radius of 0.42), its corners rounded to a circle as the dots of both are.

/** The two greys of the checkout's dark ramp: `INK.on` for `#`, `INK.off` for a two-ink grid's `.`. */
export const INKS = { on: '#FFFFFF', off: '#4A4A4A' };
/** A dot's side as a fraction of its cell: the diameter of the checkout's dots. */
export const DOT = 0.84;

/**
 * The rows of `export const <name> = [ "…", … ] as const;` in a TypeScript source, or null. Read as text (the
 * source is not run): only string literals between the brackets count.
 * @param {string} source
 * @param {string} name
 * @returns {string[] | null}
 */
export function readGrid(source, name) {
  const at = source.indexOf(`export const ${name} = [`);
  if (at < 0) return null;
  const end = source.indexOf(']', at);
  if (end < 0) return null;
  const rows = [...source.slice(at, end).matchAll(/"([^"\\\n]*)"/g)].map((m) => m[1]);
  return rows.length > 0 && rows.every((r) => r.length === rows[0].length && /^[#. ]+$/.test(r)) ? rows : null;
}

/** Whether a grid is a two-ink one: its ground is spaces, so its `.` cells are dots in the dimmer ink. */
export const twoInk = (/** @type {readonly string[]} */ rows) => rows.some((row) => row.includes(' '));

/**
 * The inks of a grid of the checkout's marks by DotGrid's rule: `#` the ink, `.` the dimmer one only in a two-ink grid.
 * @param {readonly string[]} rows
 * @param {{ on?: string, off?: string }} [opts]
 * @returns {Record<string, string>}
 */
export function dotGridInks(rows, opts = {}) {
  return twoInk(rows) ? { '#': opts.on ?? INKS.on, '.': opts.off ?? INKS.off } : { '#': opts.on ?? INKS.on };
}

const n3 = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;

/**
 * The grid as an SVG: a viewBox of one unit a cell, one `rect` a dot, its fill the ink of its character (a
 * character without an ink is no dot). `inks` defaults to DotGrid's rule (`dotGridInks`).
 * @param {readonly string[]} rows
 * @param {{ on?: string, off?: string, dot?: number, inks?: Record<string, string> }} [opts]
 * @returns {string}
 */
export function dotGridSvg(rows, opts = {}) {
  const inks = opts.inks ?? dotGridInks(rows, opts);
  const dot = n3(opts.dot ?? DOT);
  const cols = rows[0]?.length ?? 0;
  const inset = n3((1 - dot) / 2);
  const r = n3(dot / 2);
  const rects = [];
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const fill = Object.prototype.hasOwnProperty.call(inks, cell) ? inks[cell] : null;
      if (fill === null || fill === undefined) return;
      rects.push(`<rect x="${n3(x + inset)}" y="${n3(y + inset)}" width="${dot}" height="${dot}" rx="${r}" ry="${r}" fill="${fill}"/>`);
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${rows.length}" width="${cols * 4}" height="${rows.length * 4}">\n${rects.join('\n')}\n</svg>\n`;
}

// ------------------------------------------------------------------ the owner's picture

/**
 * A PNG as one luminance value a pixel (0…255; alpha over black): 8-bit grey, grey with alpha, RGB or RGBA, any
 * filter, not interlaced.
 * @param {Uint8Array} bytes
 * @param {(data: Uint8Array) => Uint8Array} inflate zlib's inflateSync
 * @returns {{ width: number, height: number, lum: Uint8Array }}
 */
export function decodePngLuminance(bytes, inflate) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  const idat = [];
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at);
    const tag = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (tag === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = bytes[at + 16];
      type = bytes[at + 17];
      interlace = bytes[at + 20];
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    at += 12 + len;
  }
  const per = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !per || interlace !== 0) throw new Error(`a PNG of 8 bits, grey or RGB, not interlaced, is read (this one: depth ${depth}, type ${type})`);
  const joined = new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const b of idat) {
    joined.set(b, o);
    o += b.length;
  }
  const raw = inflate(joined);
  const stride = width * per;
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const lum = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    const f = raw[row];
    for (let i = 0; i < stride; i++) {
      const x = raw[row + 1 + i];
      const a = i >= per ? cur[i - per] : 0;
      const b = prev[i];
      const c = i >= per ? prev[i - per] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`PNG filter ${f}`);
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const p = x * per;
      const alpha = per === 2 ? cur[p + 1] / 255 : per === 4 ? cur[p + 3] / 255 : 1;
      const l = per <= 2 ? cur[p] : 0.2126 * cur[p] + 0.7152 * cur[p + 1] + 0.0722 * cur[p + 2];
      lum[y * width + x] = Math.round(l * alpha);
    }
    prev.set(cur);
  }
  return { width, height, lum };
}

/**
 * Runs of a profile above `threshold`: the dots' columns (or rows), each its start, its end and its middle.
 * @param {Float64Array} profile
 * @param {number} threshold
 */
function runs(profile, threshold) {
  /** @type {{ from: number, to: number, mid: number }[]} */
  const out = [];
  let from = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] > threshold;
    if (on && from < 0) from = i;
    if (!on && from >= 0) {
      out.push({ from, to: i - 1, mid: (from + i - 1) / 2 });
      from = -1;
    }
  }
  return out;
}

/**
 * The dot grid of a picture of white and grey dots on black: one character a cell, `#` for a white dot, `1`, `2`…
 * for the greys from the darkest, ` ` for no dot; the inks of each character as the picture has them (the mean of
 * the dots of that level), the dot's width as a fraction of its cell, and where the grid lies in the picture.
 * Columns and rows of dots are where the picture has ink across; a grid line no dot of the mark falls on (a gap
 * between dots wider than one) would not be found, and none of the marks has one.
 * @param {{ width: number, height: number, lum: Uint8Array }} img
 * @returns {{ rows: string[], inks: Record<string, string>, levels: number[], dot: number, pitch: number, box: { x: number, y: number, w: number, h: number }, centres: { x: number[], y: number[] }, values: number[][] }}
 */
export function readDotPicture(img) {
  const { width, height, lum } = img;
  const INK = 40;
  const colMax = new Float64Array(width);
  const rowMax = new Float64Array(height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = lum[y * width + x];
      if (v > colMax[x]) colMax[x] = v;
      if (v > rowMax[y]) rowMax[y] = v;
    }
  const cols = runs(colMax, INK);
  const rowsR = runs(rowMax, INK);
  if (cols.length < 2 || rowsR.length < 2) throw new Error('no grid of dots in the picture');
  const pitchOf = (/** @type {{ mid: number }[]} */ r) => (r[r.length - 1].mid - r[0].mid) / (r.length - 1);
  const pitch = (pitchOf(cols) + pitchOf(rowsR)) / 2;
  const widths = [...cols, ...rowsR].map((r) => r.to - r.from + 1).sort((a, b) => a - b);
  const dot = widths[widths.length >> 1] / pitch;
  // Each cell's ink: the mean over a disc of a quarter of the pitch about its centre.
  const rad = Math.max(1, Math.floor(pitch / 4));
  const values = rowsR.map((ry) =>
    cols.map((cx) => {
      let sum = 0;
      let n = 0;
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const x = Math.round(cx.mid) + dx;
          const y = Math.round(ry.mid) + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          sum += lum[y * width + x];
          n++;
        }
      return n ? sum / n : 0;
    }),
  );
  // The levels: the dots' values gathered where they lie within 12 of each other.
  const lit = values.flat().filter((v) => v > INK).sort((a, b) => a - b);
  /** @type {number[][]} */
  const groups = [];
  for (const v of lit) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] <= 12) g.push(v);
    else groups.push([v]);
  }
  const levels = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const white = levels.length - 1;
  const charOf = (/** @type {number} */ k) => (k === white ? '#' : String(k + 1));
  const rows = values.map((row) =>
    row
      .map((v) => {
        if (v <= INK) return ' ';
        const k = levels.reduce((best, l, i) => (Math.abs(l - v) < Math.abs(levels[best] - v) ? i : best), 0);
        return charOf(k);
      })
      .join(''),
  );
  const hex = (/** @type {number} */ l) => {
    const b = Math.max(0, Math.min(255, Math.round(l))).toString(16).padStart(2, '0').toUpperCase();
    return `#${b}${b}${b}`;
  };
  /** @type {Record<string, string>} */
  const inks = {};
  levels.forEach((l, k) => (inks[charOf(k)] = k === white ? '#FFFFFF' : hex(l)));
  const box = { x: cols[0].mid - pitch / 2, y: rowsR[0].mid - pitch / 2, w: cols.length * pitch, h: rowsR.length * pitch };
  return { rows, inks, levels, dot, pitch, box, centres: { x: cols.map((c) => c.mid), y: rowsR.map((r) => r.mid) }, values };
}
