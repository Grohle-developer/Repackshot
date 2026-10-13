#!/usr/bin/env node
// The Windows dialogs path of a built repackshot.exe under Wine (phase P3b): Wine has no PowerShell, so a stand-in
// (packaging/fake-powershell.rs, compiled here with rustc) takes its place in a throwaway Wine prefix and checks what
// the launcher sends it: the switches (-NoProfile -NonInteractive -WindowStyle Hidden -STA -EncodedCommand), the
// script, and the page's words as RPX_* environment variables. Then: a granted folder takes new files (numbered,
// names made safe, non-ASCII kept), a save dialog's file is written whole twice, a cancel is a cancel, and the last
// project is remembered. The real dialogs need a real Windows.
//
//   node packaging/wine-dialogs.mjs <repackshot.exe>
//
// Needs wine, rustc and the x86_64-pc-windows-gnu target.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.argv[2];
if (!exe) {
  console.error('usage: node packaging/wine-dialogs.mjs <repackshot.exe>');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'repackshot-wine-dialogs-'));
const prefix = join(work, 'prefix');
// Wine maps Windows names to Unix ones with the locale: without UTF-8, "Cámara" cannot be a file name.
const env = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
};
let ok = true;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
  ok &&= !!cond;
};
const winPath = (p) => `Z:${p.replaceAll('/', '\\')}`;
let child = null;
try {
  const fake = join(work, 'powershell.exe');
  run('rustc', ['--edition', '2021', '-O', '--target', 'x86_64-pc-windows-gnu', '-o', fake, join(ROOT, 'packaging', 'fake-powershell.rs')]);
  run('wineboot', ['-i'], { stdio: 'ignore' });
  const psDir = join(prefix, 'drive_c', 'windows', 'system32', 'WindowsPowerShell', 'v1.0');
  mkdirSync(psDir, { recursive: true });
  copyFileSync(fake, join(psDir, 'powershell.exe'));
  mkdirSync(join(work, 'out'), { recursive: true });
  const answerFile = join(work, 'answer.txt');
  const answer = (p) => writeFileSync(answerFile, p);
  const port = 18700 + Math.floor(Math.random() * 200);
  child = spawn('wine', [exe, '--serve-only', '--port', String(port), '--data-dir', winPath(join(work, 'data'))], { env: { ...env, FAKE_PS_LOG: winPath(join(work, 'ps.log')), FAKE_PS_ANSWER_FILE: winPath(answerFile) }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const t0 = Date.now();
  while (!/#token=([0-9a-f]{32})/.test(out)) {
    if (Date.now() - t0 > 120000) throw new Error('the launcher printed no URL');
    await new Promise((r) => setTimeout(r, 300));
  }
  const token = /#token=([0-9a-f]{32})/.exec(out)[1];
  const api = (p, init = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'X-Repackshot-Token': token } });
  const lastCall = () => readFileSync(join(work, 'ps.log'), 'utf8').split('--- call').pop();

  answer(winPath(join(work, 'out')));
  const folder = await (await api('/api/dialog/folder', { method: 'POST', body: JSON.stringify({ title: 'Elegir la carpeta de salida', folderItem: 'Selección de carpeta', start: 'C:\\windows' }) })).json();
  const call = lastCall();
  const want = ['arg -NoLogo', 'arg -NoProfile', 'arg -NonInteractive', 'arg -WindowStyle', 'arg Hidden', 'arg -STA', 'arg -EncodedCommand', "script-starts $ErrorActionPreference = 'Stop'", 'env RPX_KIND=folder', 'env RPX_TITLE=Elegir la carpeta de salida', 'env RPX_FOLDER_ITEM=Selección de carpeta', 'env RPX_START=C:\\windows'];
  const missing = want.filter((w) => !call.includes(w));
  const cache = /env RPX_CACHE=(.*)/.exec(call)?.[1] ?? '';
  check('folder_dialog_switches_and_inputs', missing.length === 0 && cache.endsWith('folder-picker-1.dll') && folder.cancelled === false, { missing, cache, path: folder.file?.path });

  const id = folder.file.id;
  const name = encodeURIComponent('Botella_Cámara 1_0001.png');
  const writes = [await api(`/api/files?dir=${id}&name=${name}`, { method: 'PUT', body: 'png1' }), await api(`/api/files?dir=${id}&name=${name}`, { method: 'PUT', body: 'png2' }), await api(`/api/files?dir=${id}&name=${encodeURIComponent('a:b*c.png')}`, { method: 'PUT', body: 'png3' })].map((r) => r.status);
  const names = readdirSync(join(work, 'out')).sort();
  check('new_files_in_the_folder', writes.join() === '201,201,201' && names.join('|') === 'Botella_Cámara 1_0001 (2).png|Botella_Cámara 1_0001.png|a_b_c.png', { writes, names });

  answer(winPath(join(work, 'bottle.repack.json')));
  const save = await (await api('/api/dialog/save', { method: 'POST', body: JSON.stringify({ title: 'Guardar proyecto', defaultName: 'bottle.repack.json', filters: [{ name: 'Proyecto de Repackshot', extensions: ['repack.json'] }] }) })).json();
  const saveCall = lastCall();
  const puts = [await api(`/api/files/${save.file.id}`, { method: 'PUT', body: '{"v":1}' }), await api(`/api/files/${save.file.id}`, { method: 'PUT', body: '{"v":2}' })].map((r) => r.status);
  check('save_dialog_and_whole_writes', puts.join() === '200,200' && readFileSync(join(work, 'bottle.repack.json'), 'utf8') === '{"v":2}' && saveCall.includes('env RPX_KIND=save') && saveCall.includes('env RPX_FILTER=Proyecto de Repackshot|*.repack.json') && saveCall.includes('env RPX_EXT=repack.json') && saveCall.includes('env RPX_NAME=bottle.repack.json'), { puts, path: save.file?.path });

  answer('');
  const cancel = await (await api('/api/dialog/open', { method: 'POST', body: JSON.stringify({ title: 'Abrir proyecto' }) })).json();
  check('cancelled', cancel.cancelled === true, cancel);
  const last = await api('/api/projects/last', { method: 'PUT', body: JSON.stringify({ id: save.file.id }) });
  check('last_project', last.status === 204, { status: last.status });
} catch (e) {
  ok = false;
  console.error(`wine-dialogs: ${e.message}`);
} finally {
  child?.kill();
  spawnSync('wineserver', ['-k'], { env });
  rmSync(work, { recursive: true, force: true });
}
console.log(ok ? 'wine dialogs check passed' : 'wine dialogs check FAILED');
process.exit(ok ? 0 : 1);
