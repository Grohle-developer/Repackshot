// Wavefront OBJ reader (own, no dependency). Reads `v`, `vn`, `vt` and `f`
// (triangles, quads and n-gons fan-triangulated, negative indices, the
// `v`, `v/vt`, `v//vn` and `v/vt/vn` forms); `o` and `g` start parts;
// `usemtl` names the material a face takes. Comments, blank lines, `s`
// and every other statement are skipped. CRLF and LF both work.
//
// OBJ has no up axis: files are taken as Y up and converted to the model's
// Z up (the glTF importer does the same). Units are not declared either, so
// the numbers are kept as millimetres and `import.ts` flags implausible sizes.
// `.mtl` libraries are not read yet: the importer only notes that they exist.

import { buildMesh, FloatBuffer, yUpToZUp, type ImportMessage, type MaterialRange, type ParsedModel, type ParsedPart, type RawMesh } from './mesh-common';

/** A part being filled: a triangle soup plus what each triangle uses. */
class PartAcc {
  positions = new FloatBuffer(512);
  normals = new FloatBuffer(512);
  uvs = new FloatBuffer(512);
  materials: (string | null)[] = [];
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

  // Pools, already in model axes.
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

  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line === '' || line.charCodeAt(0) === 35 /* # */) continue;
    const sp = line.search(/\s/);
    const key = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    switch (key) {
      case 'v': {
        const t = rest.split(/\s+/);
        const p = yUpToZUp(Number(t[0]), Number(t[1]), Number(t[2]));
        v.push3(p[0], p[1], p[2]);
        break;
      }
      case 'vn': {
        const t = rest.split(/\s+/);
        const p = yUpToZUp(Number(t[0]), Number(t[1]), Number(t[2]));
        vn.push3(p[0], p[1], p[2]);
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
      case 'usemtl':
        material = rest || null;
        break;
      case 'mtllib':
        if (rest) libraries.push(rest);
        break;
      case 'f': {
        const tokens = rest.split(/\s+/).filter(Boolean);
        if (tokens.length < 3) {
          badFaces++;
          break;
        }
        const nv = v.length / 3;
        const nvt = vt.length / 2;
        const nvn = vn.length / 3;
        const cv: number[] = [];
        const ct: number[] = [];
        const cn: number[] = [];
        let ok = true;
        for (const tok of tokens) {
          const f = tok.split('/');
          const iv = resolveIndex(f[0], nv);
          const it = f.length > 1 && f[1] !== '' ? resolveIndex(f[1], nvt) : -2;
          const inn = f.length > 2 && f[2] !== '' ? resolveIndex(f[2], nvn) : -2;
          if (iv < 0 || it === -1 || inn === -1) {
            ok = false;
            break;
          }
          cv.push(iv);
          ct.push(it);
          cn.push(inn);
        }
        if (!ok) {
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
        for (let i = 1; i + 1 < cv.length; i++) {
          emit(0);
          emit(i);
          emit(i + 1);
          part.materials.push(material);
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
    const mats = Array.from(built.source, (s) => part.materials[s]);
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
  return { parts: out, warnings, notes };
}
