// The ZIP writer of phase N2 (src/io/zip.ts): the store method, with CRC-32, written by us and read back by
// fflate (the reader three.js ships and the 3MF importer uses), which checks nothing we wrote for it: a name,
// a size or a checksum that is off makes it throw or hand back other bytes. Plus the bytes of one known package,
// the names (told apart, made safe) and the limits.

import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/io/image';
import { dosDateTime, uniqueNames, zipName, zipStore, ZIP_MAX_FILES } from '../src/io/zip';
import { zipStored } from './zip';

const DATE = new Date(2026, 9, 17, 14, 30, 42);
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const text = (s: string) => new TextEncoder().encode(s);

describe('zipStore', () => {
  it('is read back by an independent reader: names, order of content, every byte', async () => {
    const png = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31 + 7) & 0xff);
    const zip = await zipStore(
      [
        { name: 'Bottle_Camera 1_Studio A.png', data: new Blob([png]) },
        { name: 'Bottle_Camera 1_Studio B.png', data: png.subarray(100) },
        { name: 'notes/ñandú — ✓.txt', data: text('hola') },
        { name: 'empty.bin', data: new Uint8Array(0) },
      ],
      { date: DATE },
    );
    expect(zip.type).toBe('application/zip');
    const files = unzipSync(await bytesOf(zip));
    expect(Object.keys(files).sort()).toEqual(['Bottle_Camera 1_Studio A.png', 'Bottle_Camera 1_Studio B.png', 'empty.bin', 'notes/ñandú — ✓.txt']);
    expect(files['Bottle_Camera 1_Studio A.png']).toEqual(png);
    expect(files['Bottle_Camera 1_Studio B.png']).toEqual(png.subarray(100));
    expect(new TextDecoder().decode(files['notes/ñandú — ✓.txt'])).toBe('hola');
    expect(files['empty.bin'].length).toBe(0);
  });

  it('writes the known package byte for byte: headers, the CRC-32 of 123456789, the central directory and the end record', async () => {
    const zip = await bytesOf(await zipStore([{ name: 'a.txt', data: text('123456789') }], { date: DATE }));
    const v = new DataView(zip.buffer);
    const { date, time } = dosDateTime(DATE);
    // Local header at 0: signature, version 2.0, UTF-8, stored, time, date, crc, sizes, name length.
    expect([v.getUint32(0, true), v.getUint16(4, true), v.getUint16(6, true), v.getUint16(8, true), v.getUint16(10, true), v.getUint16(12, true)]).toEqual([0x04034b50, 20, 0x0800, 0, time, date]);
    expect(v.getUint32(14, true)).toBe(0xcbf43926);
    expect([v.getUint32(18, true), v.getUint32(22, true), v.getUint16(26, true), v.getUint16(28, true)]).toEqual([9, 9, 5, 0]);
    expect(new TextDecoder().decode(zip.subarray(30, 35))).toBe('a.txt');
    expect(new TextDecoder().decode(zip.subarray(35, 44))).toBe('123456789');
    // Central directory at 44: its own signature, the same checksum and sizes, the offset of the local header (0).
    const c = 44;
    expect([v.getUint32(c, true), v.getUint32(c + 16, true), v.getUint32(c + 20, true), v.getUint32(c + 24, true), v.getUint16(c + 28, true), v.getUint32(c + 42, true)]).toEqual([0x02014b50, 0xcbf43926, 9, 9, 5, 0]);
    // End record: one file, the directory's size and where it starts, no comment.
    const e = c + 46 + 5;
    expect(zip.length).toBe(e + 22);
    expect([v.getUint32(e, true), v.getUint16(e + 8, true), v.getUint16(e + 10, true), v.getUint32(e + 12, true), v.getUint32(e + 16, true), v.getUint16(e + 20, true)]).toEqual([0x06054b50, 1, 1, 51, 44, 0]);
  });

  it('stores the data as it is: the package is the headers plus the files, nothing smaller', async () => {
    const data = new Uint8Array(5000).fill(7);
    const zip = await zipStore([{ name: 'flat.bin', data }]);
    expect(zip.size).toBe(30 + 8 + 5000 + 46 + 8 + 22);
  });

  it('agrees with the test fixtures writer on the same files (same headers but the flags and the time)', async () => {
    const files: [string, string][] = [
      ['one.txt', 'first'],
      ['two.txt', 'second file'],
    ];
    const mine = unzipSync(await bytesOf(await zipStore(files.map(([name, d]) => ({ name, data: text(d) })))));
    const theirs = unzipSync(zipStored(files));
    expect(Object.keys(mine)).toEqual(Object.keys(theirs));
    for (const [name] of files) expect(mine[name]).toEqual(theirs[name]);
  });

  it('checksums with the polynomial of ZIP and PNG', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('refuses what the classic format cannot hold', async () => {
    await expect(zipStore(Array.from({ length: ZIP_MAX_FILES + 1 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0) })))).rejects.toThrow(/too many/);
    // A Blob that claims 5 GB without having them.
    const big = { size: 5 * 1024 ** 3, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    await expect(zipStore([{ name: 'big.exr', data: big }])).rejects.toThrow(/4 GiB/);
  });
});

describe('names', () => {
  it('keeps them inside the package: separators, no root, no parent, never empty', () => {
    expect(zipName('a\\b\\c.png')).toBe('a/b/c.png');
    expect(zipName('/etc/passwd')).toBe('etc/passwd');
    expect(zipName('../../x.png')).toBe('x.png');
    expect(zipName('C:\\Users\\me\\x.png')).toBe('Users/me/x.png');
    expect(zipName('./a/./b.png')).toBe('a/b.png');
    expect(zipName('..')).toBe('file');
    expect(zipName('')).toBe('file');
  });

  it('tells repeats apart before the extension, whatever the case, and counts on past a name that is taken', () => {
    expect(uniqueNames(['a.png', 'a.png', 'A.PNG', 'b.png', 'a_2.png'])).toEqual(['a.png', 'a_2.png', 'A_3.PNG', 'b.png', 'a_2_2.png']);
    expect(uniqueNames(['dir.v2/x', 'dir.v2/x'])).toEqual(['dir.v2/x', 'dir.v2/x_2']);
    expect(uniqueNames([])).toEqual([]);
  });

  it('puts the repeats in the package under their new names', async () => {
    const files = unzipSync(await bytesOf(await zipStore([{ name: 'a.png', data: text('1') }, { name: 'a.png', data: text('2') }])));
    expect(Object.keys(files).sort()).toEqual(['a.png', 'a_2.png']);
    expect(new TextDecoder().decode(files['a_2.png'])).toBe('2');
  });
});

describe('the DOS time', () => {
  it('packs local time with two-second steps and never goes before 1980', () => {
    const { date, time } = dosDateTime(new Date(2026, 9, 17, 14, 30, 43));
    expect([(date >> 9) + 1980, (date >> 5) & 15, date & 31]).toEqual([2026, 10, 17]);
    expect([time >> 11, (time >> 5) & 63, (time & 31) * 2]).toEqual([14, 30, 42]);
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
  });
});
