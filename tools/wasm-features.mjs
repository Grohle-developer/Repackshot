// The features an rt.wasm reports, patched (phase S3c): `withFeatures(wasm, mask)` returns a copy of the module whose
// `rt_features` answers its own value ANDed with `mask`, everything else byte for byte the same. The browser check of
// S3c (tools/s3c-check.mjs) serves it to see what the interface says of an engine without a bit, as an older engine
// (an older desktop launcher) would report it.
//
// `rt_features` compiles to `i32.const FEATURES; end` without locals. The patch rewrites the constant's LEB128 in place
// with the same number of bytes (a padded encoding, which WebAssembly accepts), so no size or offset changes.

/** Reads an unsigned LEB128 at `at`: [value, bytes]. */
function uleb(b, at) {
  let v = 0;
  let shift = 0;
  let n = 0;
  for (;;) {
    const byte = b[at + n++];
    v += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if ((byte & 0x80) === 0) return [v, n];
  }
}

/** The value `v` as an LEB128 of exactly `len` bytes (signed, as i32.const takes it; `v` small and positive). */
function lebOf(v, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    const last = i === len - 1;
    out.push((v & 0x7f) | (last ? 0 : 0x80));
    v = Math.floor(v / 128);
  }
  if (v !== 0) throw new Error('the value does not fit');
  return out;
}

/** A copy of `wasm` (Uint8Array) whose rt_features reports its value & `mask`; also the value before and after. */
export function withFeatures(wasm, mask) {
  const b = new Uint8Array(wasm);
  if (b[0] !== 0 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) throw new Error('not a WebAssembly module');
  let at = 8;
  let importedFuncs = 0;
  let exportIndex = -1;
  let code = -1;
  while (at < b.length) {
    const id = b[at];
    const [size, n] = uleb(b, at + 1);
    const body = at + 1 + n;
    if (id === 2) {
      // Imports: count the functions.
      let p = body;
      const [count, c] = uleb(b, p);
      p += c;
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 2; k++) {
          const [len, l] = uleb(b, p);
          p += l + len;
        }
        const kind = b[p++];
        if (kind === 0) {
          importedFuncs++;
          p += uleb(b, p)[1];
        } else if (kind === 1) {
          p += 1;
          const flags = b[p++];
          p += uleb(b, p)[1];
          if (flags & 1) p += uleb(b, p)[1];
        } else if (kind === 2) {
          const flags = b[p++];
          p += uleb(b, p)[1];
          if (flags & 1) p += uleb(b, p)[1];
        } else if (kind === 3) p += 2;
        else throw new Error(`import kind ${kind}`);
      }
    } else if (id === 7) {
      let p = body;
      const [count, c] = uleb(b, p);
      p += c;
      for (let i = 0; i < count; i++) {
        const [len, l] = uleb(b, p);
        const name = new TextDecoder().decode(b.subarray(p + l, p + l + len));
        p += l + len;
        const kind = b[p++];
        const [index, x] = uleb(b, p);
        p += x;
        if (kind === 0 && name === 'rt_features') exportIndex = index;
      }
    } else if (id === 10) code = body;
    at = body + size;
  }
  if (exportIndex < 0 || code < 0) throw new Error('no rt_features in this module');
  let p = code;
  const [count, c] = uleb(b, p);
  p += c;
  const local = exportIndex - importedFuncs;
  if (local < 0 || local >= count) throw new Error('rt_features is not defined here');
  for (let i = 0; i < local; i++) {
    const [size, s] = uleb(b, p);
    p += s + size;
  }
  const [, s] = uleb(b, p);
  p += s;
  if (b[p] !== 0 || b[p + 1] !== 0x41) throw new Error('rt_features is not `i32.const; end`');
  const [value, len] = uleb(b, p + 2);
  if (b[p + 2 + len] !== 0x0b) throw new Error('rt_features is not `i32.const; end`');
  const patched = value & mask;
  b.set(lebOf(patched, len), p + 2);
  return { wasm: b, before: value, after: patched };
}
