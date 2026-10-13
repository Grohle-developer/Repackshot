// ZIP and tar.gz writers for the release packages, with Node's zlib only (no
// npm dependency). Entries are sorted and carry one fixed time, so the same
// files give the same archive bytes.

import { deflateRawSync, gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Every file and folder under `dir`, as archive entries under `prefix/` (sorted). */
export function collect(dir, prefix, modeOf = () => null) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const p = join(abs, name);
      const rel = `${prefix}/${relative(dir, p).split(sep).join('/')}`;
      const st = statSync(p);
      if (st.isDirectory()) {
        out.push({ name: `${rel}/`, dir: true, mode: 0o755 });
        walk(p);
      } else if (st.isFile()) {
        out.push({ name: rel, path: p, mode: modeOf(rel) ?? (st.mode & 0o111 ? 0o755 : 0o644) });
      }
    }
  };
  out.push({ name: `${prefix}/`, dir: true, mode: 0o755 });
  walk(dir);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ISO-HDLC), as ZIP wants it. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

/** A ZIP archive (deflate, UTF-8 names, Unix modes in the external attributes). */
export function zip(entries, mtime) {
  const { time, day } = dosTime(mtime);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.dir ? Buffer.alloc(0) : readFileSync(e.path);
    const deflated = e.dir ? data : deflateRawSync(data, { level: 9 });
    const stored = !e.dir && deflated.length >= data.length;
    const body = stored || e.dir ? data : deflated;
    const crc = e.dir ? 0 : crc32(data);
    const method = stored || e.dir ? 0 : 8;
    if (offset > 0xfffffff0 || data.length > 0xfffffff0) throw new Error('zip: file too large for a ZIP without ZIP64');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, ZIP 2.0
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(day, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    const unixMode = (e.dir ? 0o040000 : 0o100000) | e.mode;
    c.writeUInt32LE(((unixMode << 16) | (e.dir ? 0x10 : 0)) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  if (entries.length > 0xffff) throw new Error('zip: too many entries');
  return Buffer.concat([...parts, centralBytes, end]);
}

function octal(n, width) {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

/** A ustar header block. */
function tarHeader(name, size, mode, mtime, type) {
  const h = Buffer.alloc(512);
  let base = name;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
    if (cut <= 0 || Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`tar: path too long: ${name}`);
  }
  h.write(base, 0, 'utf8');
  h.write(octal(mode, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 'ascii');
  h.write('        ', 148, 'ascii');
  h.write(type, 156, 'ascii');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  h.write('root', 265, 'ascii');
  h.write('root', 297, 'ascii');
  h.write(prefix, 345, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 'ascii');
  return h;
}

/** A gzip-compressed ustar archive (modes kept, owner root). */
export function targz(entries, mtime) {
  const blocks = [];
  for (const e of entries) {
    if (e.dir) {
      blocks.push(tarHeader(e.name, 0, e.mode, mtime, '5'));
      continue;
    }
    const data = readFileSync(e.path);
    blocks.push(tarHeader(e.name, data.length, e.mode, mtime, '0'), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}
