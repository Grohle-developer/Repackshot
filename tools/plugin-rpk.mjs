// The .rpk format for the tools: src/plugins/rpk.ts (the application's own code) through Node's type stripping,
// with Node's WebCrypto. One place for the tools to import it from.

import { webcrypto } from 'node:crypto';
import * as rpk from '../src/plugins/rpk.ts';

export const { readRpk, parseKey, decodeContainer, encodeContainer, RpkError } = rpk;
export const newKeyBytes = () => {
  const key = new Uint8Array(rpk.KEY_BYTES);
  webcrypto.getRandomValues(key);
  return key;
};
export const encodeKeyText = (key) => rpk.toBase64(key);
export const packRpk = (meta, files, key, opts = {}) => rpk.packRpk(meta, files, key, { subtle: webcrypto.subtle, ...opts });
export const unpackRpk = (bytes, key) => rpk.unpackRpk(bytes, key, { subtle: webcrypto.subtle });
export const verifyRpk = (bytes) => rpk.verifyRpk(bytes, webcrypto.subtle);
