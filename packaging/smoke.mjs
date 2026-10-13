#!/usr/bin/env node
// Smoke test of a built launcher: starts it with --serve-only (under wine for
// the .exe), checks that it serves the interface and the API only with its
// token and its own Host, renders the engine's example scene at 4 samples per
// pixel through /api/render and checks the film against the hash rt-core pins
// (PINNED_EXAMPLE_4SPP: the same as `rt` and the wasm pool). Then stops it.
//
//   node packaging/smoke.mjs <repackshot or repackshot.exe> [--port N]
//
// Needs `cargo` for `rt --write-example`.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const exe = argv.find((a) => !a.startsWith('--'));
const port = Number(argv[argv.indexOf('--port') + 1]) || 18000 + Math.floor(Math.random() * 2000);
if (!exe) {
  console.error('usage: node packaging/smoke.mjs <repackshot[.exe]> [--port N]');
  process.exit(2);
}

const fail = (m) => {
  throw new Error(m);
};

function exampleScene() {
  const dir = mkdtempSync(join(tmpdir(), 'repackshot-smoke-'));
  const file = join(dir, 'example.rsb');
  const r = spawnSync('cargo', ['run', '-q', '--release', '--manifest-path', join(ROOT, 'engine', 'Cargo.toml'), '-p', 'rt-cli', '--', '--write-example', file], { stdio: 'inherit' });
  if (r.status !== 0) fail('rt --write-example failed');
  const rsb = new Uint8Array(readFileSync(file));
  rmSync(dir, { recursive: true, force: true });
  // RNDR.max_samples = 4 (the pinned hash is of 4 samples per pixel).
  const v = new DataView(rsb.buffer);
  let pos = 8 + v.getUint32(4, true);
  while (pos + 8 <= rsb.length) {
    const tag = String.fromCharCode(...rsb.subarray(pos, pos + 4));
    const len = v.getUint32(pos + 4, true);
    if (tag === 'RNDR') v.setUint32(pos + 8 + 8, 4, true);
    pos += 8 + len;
  }
  return rsb;
}

function pinned() {
  const src = readFileSync(join(ROOT, 'engine', 'crates', 'rt-core', 'src', 'render.rs'), 'utf8');
  const m = /PINNED_EXAMPLE_4SPP: u32 = 0x([0-9a-f_]+);/.exec(src);
  if (!m) fail('pinned hash not found');
  return Number.parseInt(m[1].replaceAll('_', ''), 16) >>> 0;
}

function fnv1a(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}

async function main() {
  const wine = exe.endsWith('.exe') && process.platform !== 'win32';
  const dataDir = mkdtempSync(join(tmpdir(), 'repackshot-data-'));
  const cmd = wine ? 'wine' : exe;
  const args = [...(wine ? [exe] : []), '--serve-only', '--port', String(port), '--data-dir', dataDir];
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WINEDEBUG: '-all' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', () => {});
  try {
    const t0 = Date.now();
    while (!/#token=[0-9a-f]{32}/.test(out)) {
      if (Date.now() - t0 > 90_000) fail(`no URL printed: ${out}`);
      if (child.exitCode !== null) fail(`exited with ${child.exitCode}`);
      await new Promise((r) => setTimeout(r, 200));
    }
    const url = out.trim().split(/\s+/)[0];
    const token = url.split('#token=')[1];
    const base = `http://127.0.0.1:${port}`;
    const api = (path, init = {}) => fetch(base + path, { ...init, headers: { 'X-Repackshot-Token': token, ...(init.headers ?? {}) } });
    const page = await fetch(`${base}/`);
    if (page.status !== 200 || !(page.headers.get('content-type') ?? '').startsWith('text/html')) fail(`GET / -> ${page.status}`);
    console.log(`GET / -> 200 ${page.headers.get('content-type')}`);
    const info = await (await api('/api/info')).json();
    if (info.app !== 'repackshot') fail('/api/info');
    console.log(`GET /api/info -> ${info.app} ${info.version}, engine ${info.engineVersion}, ${info.os} ${info.arch}, ${info.threads} threads, ${info.isa}`);
    const noToken = (await fetch(`${base}/api/info`)).status;
    if (noToken !== 401) fail(`no token -> ${noToken}`);
    console.log('GET /api/info without the token -> 401');
    const rsb = exampleScene();
    const posted = await api('/api/render?kind=final', { method: 'POST', body: rsb });
    if (!posted.ok) fail(`POST /api/render -> ${posted.status} ${await posted.text()}`);
    const { id } = await posted.json();
    const started = Date.now();
    let frame = null;
    let pass = 0;
    for (;;) {
      const buf = await (await api(`/api/render/${id}?after=${pass}`)).arrayBuffer();
      const v = new DataView(buf);
      const flags = v.getUint32(28, true);
      if (flags & 16) {
        pass = v.getUint32(8, true);
        frame = { samples: v.getUint32(12, true), sums: new Float32Array(buf, 48) };
      }
      if (flags & 7) break;
      if (Date.now() - started > 300_000) fail('render timeout');
    }
    const inv = Math.fround(1 / frame.samples);
    const rgb = new Float32Array((frame.sums.length / 4) * 3);
    for (let p = 0, o = 0; p < frame.sums.length; p += 4) for (let c = 0; c < 3; c++) rgb[o++] = Math.fround(frame.sums[p + c] * inv);
    const hash = fnv1a(rgb);
    const expect = pinned();
    console.log(`render: example at ${frame.samples} spp in ${((Date.now() - started) / 1000).toFixed(1)} s, film hash 0x${hash.toString(16)}, rt-core pins 0x${expect.toString(16)}`);
    if (hash !== expect) fail('the native film differs from rt');
    console.log('smoke test passed');
  } finally {
    child.kill();
    if (wine) spawnSync('wineserver', ['-k']);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`smoke: ${e.message}`);
  process.exit(1);
});
