// Base64 for big buffers (embedded meshes in .repack.json). Both directions work in chunks, so the cost is
// linear in the size: no string is grown one character (or one chunk) at a time, and no argument list of
// millions of numbers is built.

/** Bytes per encoded chunk: a multiple of 3, so every chunk but the last has no padding. */
const ENCODE_CHUNK = 3 * 4096;
/** Characters per decoded chunk: a multiple of 4. */
const DECODE_CHUNK = 4 * 16384;

/** The standard alphabet with `=` padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    // `apply` takes the typed array as the argument list (no copy into an Array).
    parts.push(btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + ENCODE_CHUNK) as unknown as number[])));
  }
  return parts.join('');
}

/** The bytes of a base64 text (whitespace is ignored). Throws on anything that is not base64. */
export function base64ToBytes(text: string): Uint8Array {
  // Line-wrapped text (some tools do it) would shift the chunks: take the whitespace out first.
  const clean = /\s/.test(text) ? text.replace(/\s+/g, '') : text;
  if (clean.length % 4 !== 0) throw new Error('not base64');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  try {
    for (let i = 0; i < clean.length; i += DECODE_CHUNK) {
      const bin = atob(clean.slice(i, i + DECODE_CHUNK));
      for (let k = 0; k < bin.length; k++) out[o++] = bin.charCodeAt(k);
    }
  } catch {
    // atob refuses characters outside the alphabet and padding anywhere but the end.
    throw new Error('not base64');
  }
  return out;
}
