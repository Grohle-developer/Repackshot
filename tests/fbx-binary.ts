// Turns an ASCII FBX (the hand-written fixture) into a binary FBX, so the same
// scene reaches three's BinaryParser and the reader's binary GlobalSettings
// scan. Only what the fixture uses: nested nodes, strings, integers, doubles
// and int/double arrays (stored raw, no compression). Names written as
// "Class::Name" in ASCII are written as "Name\0\x01Class", the way binary
// files have them. Version 7500 and later use 64-bit record headers.

type Prop = { t: 'S'; v: string } | { t: 'I'; v: number } | { t: 'L'; v: number } | { t: 'D'; v: number } | { t: 'i'; v: number[] } | { t: 'd'; v: number[] } | { t: 'array' };
interface FNode {
  name: string;
  props: Prop[];
  children: FNode[];
}

const INT_ARRAYS = new Set(['PolygonVertexIndex', 'Edges', 'Materials', 'UVIndex', 'NormalsIndex']);
const ID_NODES = new Set(['Model', 'Geometry', 'Material', 'C']);
const INTEGER_TYPES = new Set(['int', 'Integer', 'enum', 'Enum', 'bool', 'Bool', 'KTime']);

function parseProps(name: string, rest: string): Prop[] {
  if (/^\*\d+$/.test(rest)) return [{ t: 'array' }];
  const out: Prop[] = [];
  const tokens = [...rest.matchAll(/"([^"]*)"|(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)/g)];
  const strings = tokens.filter((m) => m[1] !== undefined).map((m) => m[1]);
  for (const m of tokens) {
    if (m[1] !== undefined) {
      // "Model::Body" is "Body\0\x01Model" in binary files.
      const pair = /^(\w+)::(.*)$/.exec(m[1]);
      out.push({ t: 'S', v: pair ? `${pair[2]}\u0000\u0001${pair[1]}` : m[1] });
    } else {
      const v = Number(m[2]);
      if (name === 'P') out.push(INTEGER_TYPES.has(strings[1]) ? { t: 'I', v } : { t: 'D', v });
      else if (ID_NODES.has(name)) out.push({ t: 'L', v });
      else out.push(Number.isInteger(v) ? { t: 'I', v } : { t: 'D', v });
    }
  }
  return out;
}

function parseAscii(text: string): FNode[] {
  const root: FNode = { name: '', props: [], children: [] };
  const stack = [root];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line === '}') {
      stack.pop();
      continue;
    }
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`fbx-binary: cannot read "${line}"`);
    const [, name, tail] = m;
    const opens = tail.endsWith('{');
    const rest = opens ? tail.slice(0, -1).trim() : tail;
    if (name === 'a') {
      // The values of the array that the parent announced with *N.
      const parent = stack[stack.length - 1];
      const values = rest.split(',').map(Number);
      parent.props = [INT_ARRAYS.has(parent.name) ? { t: 'i', v: values } : { t: 'd', v: values }];
      continue;
    }
    const node: FNode = { name, props: parseProps(name, rest), children: [] };
    stack[stack.length - 1].children.push(node);
    if (opens) stack.push(node);
  }
  return root.children;
}

function propBytes(props: Prop[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const p of props) {
    if (p.t === 'array') throw new Error('fbx-binary: array without values');
    let b: Uint8Array;
    if (p.t === 'S') {
      const s = enc.encode(p.v);
      b = new Uint8Array(5 + s.length);
      b[0] = 83; // S
      new DataView(b.buffer).setUint32(1, s.length, true);
      b.set(s, 5);
    } else if (p.t === 'I') {
      b = new Uint8Array(5);
      b[0] = 73;
      new DataView(b.buffer).setInt32(1, p.v, true);
    } else if (p.t === 'L') {
      b = new Uint8Array(9);
      b[0] = 76;
      new DataView(b.buffer).setBigInt64(1, BigInt(p.v), true);
    } else if (p.t === 'D') {
      b = new Uint8Array(9);
      b[0] = 68;
      new DataView(b.buffer).setFloat64(1, p.v, true);
    } else {
      const ints = p.t === 'i';
      const values: number[] = p.v;
      const size = ints ? 4 : 8;
      b = new Uint8Array(13 + values.length * size);
      b[0] = ints ? 105 : 100;
      const dv = new DataView(b.buffer);
      dv.setUint32(1, values.length, true);
      dv.setUint32(5, 0, true); // raw
      dv.setUint32(9, values.length * size, true);
      values.forEach((x, i) => (ints ? dv.setInt32(13 + 4 * i, x, true) : dv.setFloat64(13 + 8 * i, x, true)));
    }
    parts.push(b);
  }
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of parts) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

function writeNode(node: FNode, at: number, wide: boolean): Uint8Array {
  const head = wide ? 25 : 13;
  const name = new TextEncoder().encode(node.name);
  const props = propBytes(node.props);
  const parts: Uint8Array[] = [];
  let pos = at + head + name.length + props.length;
  for (const c of node.children) {
    const b = writeNode(c, pos, wide);
    parts.push(b);
    pos += b.length;
  }
  if (node.children.length > 0) {
    parts.push(new Uint8Array(head));
    pos += head;
  }
  const out = new Uint8Array(pos - at);
  const dv = new DataView(out.buffer);
  if (wide) {
    dv.setBigUint64(0, BigInt(pos), true);
    dv.setBigUint64(8, BigInt(node.props.length), true);
    dv.setBigUint64(16, BigInt(props.length), true);
  } else {
    dv.setUint32(0, pos, true);
    dv.setUint32(4, node.props.length, true);
    dv.setUint32(8, props.length, true);
  }
  out[wide ? 24 : 12] = name.length;
  out.set(name, head);
  out.set(props, head + name.length);
  let o = head + name.length + props.length;
  for (const b of parts) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** The binary FBX of an ASCII FBX text, at the given file version (7400 has 32-bit records, 7500 64-bit). */
export function asciiToBinaryFbx(ascii: string, version = 7400): Uint8Array {
  const wide = version >= 7500;
  const head = wide ? 25 : 13;
  const magic = new Uint8Array(27);
  magic.set(new TextEncoder().encode('Kaydara FBX Binary  '), 0);
  magic[21] = 0;
  magic[22] = 0x1a;
  magic[23] = 0; // placeholder, the version follows at offset 23
  new DataView(magic.buffer).setUint32(23, version, true);
  const parts: Uint8Array[] = [magic];
  let pos = magic.length;
  for (const n of parseAscii(ascii)) {
    const b = writeNode(n, pos, wide);
    parts.push(b);
    pos += b.length;
  }
  parts.push(new Uint8Array(head + 176)); // closing null record and a footer-sized tail
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of parts) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}
