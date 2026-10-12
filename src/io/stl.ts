// STL reader (own, no dependency): binary and ASCII.
//
// Binary: an 80-byte header, a little-endian u32 facet count and 50-byte
// facets (normal, three vertices, a u16 attribute). It is binary exactly when
// the size is `84 + 50 n`; some exporters start the header with "solid", so
// the size check comes first. ASCII is accepted only when that check fails
// and the text starts with `solid` and has a `facet`.
//
// STL has no up axis (CAD and printing are Z up, like the model) and no
// units: the numbers are kept as millimetres. One part per file; an ASCII
// file with several `solid` blocks gives one part per block. Vertices are
// welded and normals come from the geometry (30 degree smoothing); the
// facet normal in the file is only a fallback.

import { buildMesh, FloatBuffer, FACET_BYTES, HEADER_BYTES, isBinaryStl, looksLikeAsciiStl, type ImportMessage, type ParsedModel, type ParsedPart } from './mesh-common';

interface Solid {
  name: string;
  positions: FloatBuffer;
  facetNormals: FloatBuffer;
}

function parseBinary(bytes: Uint8Array): Solid {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(HEADER_BYTES, true);
  const positions = new FloatBuffer(9 * n);
  const facetNormals = new FloatBuffer(3 * n);
  let o = HEADER_BYTES + 4;
  for (let i = 0; i < n; i++, o += FACET_BYTES) {
    facetNormals.push3(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
    for (let k = 0; k < 3; k++) {
      const p = o + 12 + 12 * k;
      positions.push3(dv.getFloat32(p, true), dv.getFloat32(p + 4, true), dv.getFloat32(p + 8, true));
    }
  }
  return { name: '', positions, facetNormals };
}

function parseAscii(text: string, warnings: ImportMessage[]): Solid[] {
  const solids: Solid[] = [];
  let solid: Solid | null = null;
  let normal: [number, number, number] = [0, 0, 0];
  let corners = 0;
  let badFacets = 0;
  const open = (name: string): Solid => {
    const s: Solid = { name, positions: new FloatBuffer(), facetNormals: new FloatBuffer() };
    solids.push(s);
    return s;
  };
  // A facet that ends with one or two vertices is dropped, so triangles stay aligned.
  const closeFacet = () => {
    if (corners === 0) return;
    badFacets++;
    if (solid) solid.positions.truncate(solid.positions.length - 3 * corners);
    corners = 0;
  };
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (line === '') continue;
    const t = line.split(/\s+/);
    switch (t[0].toLowerCase()) {
      case 'solid':
        closeFacet();
        solid = open(t.slice(1).join(' '));
        break;
      case 'facet':
        closeFacet();
        // `facet normal nx ny nz`
        normal = [Number(t[2]), Number(t[3]), Number(t[4])];
        break;
      case 'vertex': {
        if (!solid) solid = open('');
        solid.positions.push3(Number(t[1]), Number(t[2]), Number(t[3]));
        corners++;
        if (corners === 3) {
          solid.facetNormals.push3(normal[0], normal[1], normal[2]);
          corners = 0;
        }
        break;
      }
      case 'endfacet':
      case 'endsolid':
        closeFacet();
        if (t[0].toLowerCase() === 'endsolid') solid = null;
        break;
      default:
        break;
    }
  }
  closeFacet();
  if (badFacets > 0) warnings.push({ code: 'badFace', params: { count: badFacets } });
  return solids;
}

export function parseStl(bytes: Uint8Array, fileName: string): ParsedModel {
  const warnings: ImportMessage[] = [];
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'Part';
  let solids: Solid[];
  if (isBinaryStl(bytes)) solids = [parseBinary(bytes)];
  else if (looksLikeAsciiStl(bytes)) solids = parseAscii(new TextDecoder('utf-8').decode(bytes), warnings);
  else throw new Error('not a binary or ASCII STL');
  solids = solids.filter((s) => s.positions.length >= 9);
  if (solids.length === 0) throw new Error('no facets found');

  const parts: ParsedPart[] = [];
  solids.forEach((solid, i) => {
    const name = solids.length === 1 ? baseName : solid.name || `${baseName} ${i + 1}`;
    const triangles = solid.positions.length / 9;
    const built = buildMesh({ positions: solid.positions.toArray(), facetNormals: solid.facetNormals.toArray() });
    if (!built) {
      warnings.push({ code: 'degenerate', params: { part: name, count: triangles } });
      return;
    }
    if (built.dropped > 0) warnings.push({ code: 'degenerate', params: { part: name, count: built.dropped } });
    parts.push({ name, mesh: built.data, material: null, ranges: [] });
  });
  if (parts.length === 0) throw new Error('no facets found');
  return { parts, warnings, notes: [] };
}
