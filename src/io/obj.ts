// Wavefront OBJ reader (own, no dependency). Reads `v`, `vn`, `vt` and `f`
// (triangles, quads and n-gons fan-triangulated, negative indices, the
// `v`, `v/vt`, `v//vn` and `v/vt/vn` forms); `o` and `g` start parts;
// `usemtl` names the material a face takes. Comments, blank lines, `s`
// and every other statement are skipped. CRLF and LF both work.
//
// OBJ has no up axis and no units: the numbers are kept as the file has them
// and the import options decide (Y up is the detected default, like glTF;
// the units come from the size heuristic, `import-options.ts`).
// `.mtl` libraries are read by io/obj-materials.ts when they are dropped with
// the file (M2a); here the reader only lists them and notes they were not read.

import { buildMesh, FloatBuffer, type ImportMessage, type MaterialRange, type ParsedModel, type ParsedPart, type RawMesh } from './mesh-common';

/** A part being filled: a triangle soup plus what each triangle uses. */
class PartAcc {
  positions = new FloatBuffer(512);
  normals = new FloatBuffer(512);
  uvs = new FloatBuffer(512);
  /** Per triangle, an index into the file's material table. */
  materials: number[] = [];
  /** Corners with a normal / with a uv; compared with `corners` to see if it is all or nothing. */
  withNormal = 0;
  withUv = 0;
  corners = 0;
  constructor(readonly name: string) {}
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  // A trailing backslash continues the statement on the next line.
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (line.endsWith('\\') && i + 1 < lines.length) line = line.slice(0, -1) + ' ' + lines[++i];
    out.push(line);
  }
  return out;
}

function growInts(a: Int32Array): Int32Array {
  const out = new Int32Array(a.length * 2);
  out.set(a);
  return out;
}

/** Resolves a 1-based (or negative, relative) OBJ index to a 0-based one, or -1. */
function resolveIndex(token: string, count: number): number {
  const n = Number.parseInt(token, 10);
  if (!Number.isFinite(n) || n === 0) return -1;
  const i = n > 0 ? n - 1 : count + n;
  return i >= 0 && i < count ? i : -1;
}

export function parseObj(text: string, fileName: string): ParsedModel {
  const warnings: ImportMessage[] = [];
  const notes: ImportMessage[] = [];
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'Part';

  // Pools, in the axes of the file.
  const v = new FloatBuffer(1024);
  const vn = new FloatBuffer(1024);
  const vt = new FloatBuffer(1024);

  const parts = new Map<string, PartAcc>();
  let pendingName: string | null = null;
  let current: PartAcc | null = null;
  let material: string | null = null;
  const libraries: string[] = [];
  let badFaces = 0;

  const acc = (): PartAcc => {
    if (current) return current;
    const name = pendingName ?? baseName;
    let part = parts.get(name);
    if (!part) {
      part = new PartAcc(name);
      parts.set(name, part);
    }
    current = part;
    return part;
  };

  // Material names in order of first use; triangles hold indices into it (0 is "no material").
  const materialNames: (string | null)[] = [null];
  let materialIndex = 0;
  // Corner indices of the face being read, reused between faces.
  let cv: Int32Array = new Int32Array(16);
  let ct: Int32Array = new Int32Array(16);
  let cn: Int32Array = new Int32Array(16);

  /** Reads three numbers after the keyword (`v`, `vn`) into `out`, skipping blanks. */
  const read3 = (line: string, from: number, out: number[]): void => {
    let p = from;
    for (let k = 0; k < 3; k++) {
      while (p < line.length && line.charCodeAt(p) <= 32) p++;
      let e = p;
      while (e < line.length && line.charCodeAt(e) > 32) e++;
      out[k] = e > p ? Number(line.substring(p, e)) : NaN;
      p = e;
    }
  };
  const xyz = [0, 0, 0];

  for (const raw of splitLines(text)) {
    const c0 = raw.charCodeAt(0);
    const c1 = raw.charCodeAt(1);
    // Fast paths for the statements that make up almost every file.
    if (c0 === 118 /* v */ && c1 === 32) {
      read3(raw, 1, xyz);
      v.push3(xyz[0], xyz[1], xyz[2]);
      continue;
    }
    if (c0 === 118 && c1 === 110 /* vn */ && raw.charCodeAt(2) <= 32) {
      read3(raw, 2, xyz);
      vn.push3(xyz[0], xyz[1], xyz[2]);
      continue;
    }
    const line = raw.trim();
    if (line === '' || line.charCodeAt(0) === 35 /* # */) continue;
    const sp = line.search(/\s/);
    const key = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    switch (key) {
      case 'v': {
        read3(line, 1, xyz);
        v.push3(xyz[0], xyz[1], xyz[2]);
        break;
      }
      case 'vn': {
        read3(line, 2, xyz);
        vn.push3(xyz[0], xyz[1], xyz[2]);
        break;
      }
      case 'vt': {
        const t = rest.split(/\s+/);
        vt.push2(Number(t[0]), Number(t[1] ?? 0));
        break;
      }
      case 'o':
      case 'g':
        pendingName = rest || null;
        current = null;
        break;
      case 'usemtl': {
        material = rest || null;
        let i = materialNames.indexOf(material);
        if (i < 0) i = materialNames.push(material) - 1;
        materialIndex = i;
        break;
      }
      case 'mtllib':
        if (rest) libraries.push(rest);
        break;
      case 'f': {
        const nv = v.length / 3;
        const nvt = vt.length / 2;
        const nvn = vn.length / 3;
        let count = 0;
        let ok = true;
        let p = 0;
        while (p < rest.length) {
          while (p < rest.length && rest.charCodeAt(p) <= 32) p++;
          let e = p;
          while (e < rest.length && rest.charCodeAt(e) > 32) e++;
          if (e === p) break;
          // One corner: v, v/vt, v//vn or v/vt/vn.
          const s1 = rest.indexOf('/', p);
          const hasSlash = s1 >= 0 && s1 < e;
          const s2 = hasSlash ? rest.indexOf('/', s1 + 1) : -1;
          const hasSecond = s2 >= 0 && s2 < e;
          const iv = resolveIndex(rest.substring(p, hasSlash ? s1 : e), nv);
          const it = hasSlash && s1 + 1 < (hasSecond ? s2 : e) ? resolveIndex(rest.substring(s1 + 1, hasSecond ? s2 : e), nvt) : -2;
          const inn = hasSecond && s2 + 1 < e ? resolveIndex(rest.substring(s2 + 1, e), nvn) : -2;
          if (iv < 0 || it === -1 || inn === -1) {
            ok = false;
            break;
          }
          if (count === cv.length) {
            cv = growInts(cv);
            ct = growInts(ct);
            cn = growInts(cn);
          }
          cv[count] = iv;
          ct[count] = it;
          cn[count] = inn;
          count++;
          p = e;
        }
        if (!ok || count < 3) {
          badFaces++;
          break;
        }
        const part = acc();
        const emit = (i: number) => {
          part.positions.push3(v.at(3 * cv[i]), v.at(3 * cv[i] + 1), v.at(3 * cv[i] + 2));
          if (cn[i] >= 0) {
            part.normals.push3(vn.at(3 * cn[i]), vn.at(3 * cn[i] + 1), vn.at(3 * cn[i] + 2));
            part.withNormal++;
          } else part.normals.push3(0, 0, 0);
          if (ct[i] >= 0) {
            part.uvs.push2(vt.at(2 * ct[i]), vt.at(2 * ct[i] + 1));
            part.withUv++;
          } else part.uvs.push2(0, 0);
          part.corners++;
        };
        for (let i = 1; i + 1 < count; i++) {
          emit(0);
          emit(i);
          emit(i + 1);
          part.materials.push(materialIndex);
        }
        break;
      }
      default:
        // s, l, p, cstype, curv, surf, maplib, usemap and anything unknown: skipped.
        break;
    }
  }

  if (badFaces > 0) warnings.push({ code: 'badFace', params: { count: badFaces } });
  if (libraries.length > 0) notes.push({ code: 'mtlIgnored', params: { files: libraries.join(', ') } });

  const out: ParsedPart[] = [];
  for (const part of parts.values()) {
    const triangles = part.materials.length;
    if (triangles === 0) continue;
    const complete = part.withNormal === part.corners;
    if (!complete && part.withNormal > 0) warnings.push({ code: 'partialNormals', params: { part: part.name } });
    const rawMesh: RawMesh = {
      positions: part.positions.toArray(),
      normals: complete ? part.normals.toArray() : null,
      uvs: part.withUv > 0 ? part.uvs.toArray() : null,
    };
    const built = buildMesh(rawMesh);
    if (!built) {
      warnings.push({ code: 'degenerate', params: { part: part.name, count: triangles } });
      continue;
    }
    if (built.dropped > 0) warnings.push({ code: 'degenerate', params: { part: part.name, count: built.dropped } });
    const mats = Array.from(built.source, (s) => materialNames[part.materials[s]]);
    const initial = mats[0] ?? null;
    const ranges: MaterialRange[] = [];
    for (let i = 0; i < mats.length; i++) {
      if (mats[i] === initial) continue;
      const last = ranges[ranges.length - 1];
      if (last && last.material === mats[i] && last.start + last.count === i) last.count++;
      else ranges.push({ start: i, count: 1, material: mats[i] });
    }
    out.push({ name: part.name, mesh: built.data, material: initial, ranges });
  }
  if (out.length === 0) throw new Error('no faces found');
  return { parts: out, warnings, notes, libraries };
}
