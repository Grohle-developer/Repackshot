// A ZIP writer of our own (phase N2): the "store" method only (no compression), so there is nothing to
// depend on and nothing to get wrong. Renders are PNG, EXR or JPEG already; compressing them again costs time
// and saves nothing worth the wait. The format is PKWARE's APPNOTE.TXT (6.3.x): per file a local header and the
// data, then the central directory, then the end-of-central-directory record.
//
//   - Names are UTF-8 (general purpose bit 11), `/` separated, never absolute and never with `..`.
//   - Every file carries its CRC-32 (the one of the PNG specification: `crc32` of `image.ts`), read from the
//     bytes before they are written, so a reader that checks it passes.
//   - The time stamp is the DOS one, in local time, of the `date` given (default: now).
//   - No ZIP64: a package of 4 GiB or more, or of 65535 files or more, is refused with a clear error (a browser
//     cannot hold such a Blob in memory anyway).
//   - The result is a `Blob` of the headers and the files' own Blobs: the data is not copied.
//
// `tests/zip.test.ts` reads what this writes with fflate (the reader three.js ships, the 3MF importer's) and
// checks the bytes of a known package.

import { crc32 } from './image';

/** One file of a package: its name inside the ZIP and its bytes. */
export interface ZipEntry {
  name: string;
  data: Blob | Uint8Array;
}

/** Largest package the classic format holds (and so this writer): 4 GiB less a safety margin for the directory. */
export const ZIP_MAX_BYTES = 0xffff_ffff - 1024 * 1024;
/** Most files the classic format counts in its end record. */
export const ZIP_MAX_FILES = 0xfffe;

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** Bit 11 of the general purpose flags: names and comments are UTF-8. */
const UTF8 = 0x0800;
/** Version needed to extract (and made by): 2.0, the lowest that names stored files and directories. */
const VERSION = 20;

/** The DOS date and time words of a date (local time; years before 1980 are 1980; seconds in steps of two). */
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/** A name as a ZIP wants it: `/` separators, no leading slash, no drive letter, no `.` or `..` parts, never empty. */
export function zipName(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

/**
 * The names with repeats told apart: the second `a.png` becomes `a_2.png`, the third `a_3.png` (before the
 * extension), and a result that is itself taken goes on counting. Case-insensitive, because the systems that open a
 * ZIP mostly are. Pure and stable: the first of each name keeps it.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((raw) => {
    const name = zipName(raw);
    const slash = name.lastIndexOf('/') + 1;
    const dot = name.lastIndexOf('.');
    const cut = dot > slash ? dot : name.length;
    let out = name;
    for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${name.slice(0, cut)}_${n}${name.slice(cut)}`;
    taken.add(out.toLowerCase());
    return out;
  });
}

async function bytesOf(data: Blob | Uint8Array): Promise<Uint8Array> {
  return data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
}

/**
 * A ZIP of `entries`, in the order given, every file stored. Names that repeat are told apart (`uniqueNames`).
 * Throws a plain error when the package would need ZIP64.
 */
export async function zipStore(entries: readonly ZipEntry[], opts: { date?: Date } = {}): Promise<Blob> {
  if (entries.length > ZIP_MAX_FILES) throw new Error(`a ZIP of ${entries.length} files is too many (at most ${ZIP_MAX_FILES})`);
  const { date, time } = dosDateTime(opts.date ?? new Date());
  const enc = new TextEncoder();
  const names = uniqueNames(entries.map((e) => e.name));
  const parts: BlobPart[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const nameBytes = enc.encode(names[i]);
    const data = entries[i].data;
    const size = data instanceof Uint8Array ? data.length : data.size;
    if (offset + size + 30 + nameBytes.length > ZIP_MAX_BYTES) throw new Error('a ZIP of 4 GiB or more is too large (no ZIP64)');
    // One file's bytes at a time: the checksum needs them, the package keeps the Blob.
    const crc = crc32(await bytesOf(data));
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8, true);
    lv.setUint16(8, 0, true); // method 0: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(nameBytes, 30);
    const entry = new Uint8Array(46 + nameBytes.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, CENTRAL, true);
    ev.setUint16(4, VERSION, true); // made by: MS-DOS-like (host 0), 2.0
    ev.setUint16(6, VERSION, true);
    ev.setUint16(8, UTF8, true);
    ev.setUint16(10, 0, true);
    ev.setUint16(12, time, true);
    ev.setUint16(14, date, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, size, true);
    ev.setUint32(24, size, true);
    ev.setUint16(28, nameBytes.length, true);
    // 30..45: no extra field, no comment, disk 0, no internal or external attributes.
    ev.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    parts.push(local, data as BlobPart);
    directory.push(entry);
    offset += local.length + size;
  }
  const directoryBytes = directory.reduce((n, d) => n + d.length, 0);
  if (offset + directoryBytes + 22 > 0xffff_ffff) throw new Error('a ZIP of 4 GiB or more is too large (no ZIP64)');
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, END, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, directoryBytes, true);
  dv.setUint32(16, offset, true);
  return new Blob([...parts, ...(directory as BlobPart[]), end as BlobPart], { type: 'application/zip' });
}
