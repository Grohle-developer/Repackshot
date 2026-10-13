#!/usr/bin/env node
// `npm run release`: the desktop release, built locally (phase P2; P1 uses it).
//
//   out/release/Repackshot-<v>-windows-x64-portable.zip
//   out/release/Repackshot-<v>-linux-x64-portable.tar.gz
//   out/release/Repackshot-<v>-windows-x64-setup.exe
//   out/release/SHA256SUMS.txt
//
// Steps: check the tools; build the engine for the browser (npm run
// engine:build) and the interface (npm run build); render the icon from
// docs/media/logo.svg with the local Chromium; build `repackshot` for
// x86_64-pc-windows-gnu (mingw-w64, icon and version embedded by its build.rs)
// and x86_64-unknown-linux-musl (static); assemble the two portable folders
// and archive them; build the installer with makensis (warnings are errors);
// write the checksums. Archives use one fixed time (SOURCE_DATE_EPOCH, else the
// last commit's), so the same tree gives the same bytes.
//
// Options: --skip-build (reuse dist/ and the engine builds), --no-installer.
//
// AppImage: opt-in, only when APPIMAGETOOL points at appimagetool (MIT). It is
// not part of the default release: appimagetool embeds the type-2 AppImage
// runtime, fetched unpinned from GitHub while building, which links libfuse
// (LGPL-2.1) statically, and the project admits no LGPL code besides
// occt-import-js without a new decision (ARCHITECTURE §1).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, targz, zip } from './lib/archive.mjs';
import { ico, isAchromatic, renderIcon } from './lib/icon.mjs';
import { thirdPartyNotices } from './lib/notices.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = join(ROOT, 'engine');
const OUT = join(ROOT, 'out', 'release');
const BUILD = join(OUT, 'build');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const NAME = `Repackshot-${VERSION}`;
const WIN = 'x86_64-pc-windows-gnu';
const LINUX = 'x86_64-unknown-linux-musl';
const args = new Set(process.argv.slice(2));

function run(cmd, argv, opts = {}) {
  console.log(`$ ${cmd} ${argv.join(' ')}`);
  const r = spawnSync(cmd, argv, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

function output(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', cwd: ROOT });
  return r.status === 0 ? r.stdout : null;
}

function checkTools() {
  const missing = [];
  if (output('cargo', ['--version']) === null) missing.push('cargo (Rust)');
  const targets = output('rustup', ['target', 'list', '--installed']) ?? '';
  for (const t of [WIN, LINUX, 'wasm32-unknown-unknown']) if (!targets.split('\n').includes(t)) missing.push(`rustup target ${t}`);
  if (output('x86_64-w64-mingw32-gcc', ['--version']) === null) missing.push('x86_64-w64-mingw32-gcc (mingw-w64)');
  if (!args.has('--no-installer') && output('makensis', ['-VERSION']) === null) missing.push('makensis (NSIS 3)');
  if (missing.length) throw new Error(`missing tools:\n  ${missing.join('\n  ')}`);
  if (output('x86_64-w64-mingw32-windres', ['--version']) === null) console.warn('warning: x86_64-w64-mingw32-windres not found: repackshot.exe gets no icon or version information');
}

function sourceDate() {
  const fromEnv = Number(process.env.SOURCE_DATE_EPOCH);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return new Date(fromEnv * 1000);
  const git = Number(output('git', ['log', '-1', '--format=%ct'])?.trim());
  return new Date((Number.isFinite(git) && git > 0 ? git : 1767225600) * 1000);
}

async function makeIcon() {
  const dir = join(BUILD, 'icon');
  mkdirSync(dir, { recursive: true });
  const images = await renderIcon(readFileSync(join(ROOT, 'docs', 'media', 'logo.svg'), 'utf8'));
  for (const img of images) {
    if (!isAchromatic(img.rgba)) throw new Error(`the ${img.size} px icon is not black and white`);
    writeFileSync(join(dir, `repackshot-${img.size}.png`), img.png);
  }
  writeFileSync(join(dir, 'repackshot.ico'), ico(images));
  copyFileSync(join(dir, 'repackshot-256.png'), join(dir, 'icon.png'));
  return { ico: join(dir, 'repackshot.ico'), png: join(dir, 'icon.png') };
}

function cargoBuild(target, env = {}) {
  run('cargo', ['build', '--manifest-path', join(ENGINE, 'Cargo.toml'), '--release', '-p', 'rt-app', '--target', target], { env: { ...process.env, ...env } });
  return join(ENGINE, 'target', target, 'release', target.includes('windows') ? 'repackshot.exe' : 'repackshot');
}

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

function readme(os, portable = true) {
  const win = os === 'windows';
  const exe = win ? 'repackshot.exe' : './repackshot';
  const browser = win ? 'Microsoft Edge (it comes with Windows; Google Chrome when Edge is missing)' : 'Chromium, Google Chrome, Microsoft Edge or Brave (the first one found; REPACKSHOT_BROWSER names another)';
  const navegador = win ? 'Microsoft Edge (viene con Windows; Google Chrome si falta Edge)' : 'Chromium, Google Chrome, Microsoft Edge o Brave (el primero que encuentre; REPACKSHOT_BROWSER indica otro)';
  const data = win ? '%LOCALAPPDATA%\\Repackshot' : '~/.local/share/repackshot';
  const text = `Repackshot ${VERSION} (${win ? 'Windows x64' : 'Linux x86_64'}${portable ? ', portable' : ''})
https://github.com/Grohle-developer/Repackshot

Run ${exe}. It opens Repackshot in an app window of ${browser} and renders with
every core of the computer. Close the window to quit.
${win ? '\nThe program is not signed: the first time, Windows SmartScreen may warn\n("More info", then "Run anyway").\n' : `\nTo add it to the applications menu: ./install-desktop-entry.sh
(it installs icon.png and a copy of repackshot.desktop pointing here).\n`}
${portable ? `Portable: settings, AI models and logs stay in the "data" folder next to the
program, because portable.txt is here. Delete portable.txt to keep them in
${data} instead.` : `Settings, AI models and logs: ${data}. Uninstall from Settings > Apps.`}

Requirements: ${win ? 'Windows 10 or 11, x64' : 'Linux x86_64 (any distribution: the program is static)'}, and ${win ? 'Edge or Chrome' : 'one of those browsers'}.
Licence: PolyForm Noncommercial 1.0.0 (LICENSE): free for noncommercial use.
Third-party licences: THIRD-PARTY-NOTICES.txt.

--

Ejecuta ${exe}. Abre Repackshot en una ventana de aplicación de ${navegador}
y renderiza con todos los núcleos del equipo. Cierra la ventana para salir.
${win ? '\nEl programa no está firmado: la primera vez, Windows SmartScreen puede\navisar ("Más información" y luego "Ejecutar de todas formas").\n' : '\nPara añadirlo al menú de aplicaciones: ./install-desktop-entry.sh\n'}
${portable ? `Portable: los ajustes, los modelos de IA y los registros se quedan en la carpeta
"data" junto al programa, porque está portable.txt. Bórralo para guardarlos en
${data}.` : `Ajustes, modelos de IA y registros: ${data}. Se desinstala desde Configuración > Aplicaciones.`}

Licencia: PolyForm Noncommercial 1.0.0 (LICENSE): gratis para uso no comercial.
`;
  return win ? crlf(text) : text;
}

/** Gives every file and folder under `dir` the time `t` (NSIS stores file times). */
function touchAll(dir, t) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) touchAll(p, t);
    utimesSync(p, t, t);
  }
  utimesSync(dir, t, t);
}

function stage(dir, files, mtime) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, from] of Object.entries(files)) {
    if (typeof from === 'string') copyFileSync(from, join(dir, name));
    else writeFileSync(join(dir, name), from.text);
  }
  cpSync(join(ROOT, 'dist'), join(dir, 'app'), { recursive: true });
  touchAll(dir, mtime);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function mib(path) {
  return `${(statSync(path).size / 1048576).toFixed(1)} MiB`;
}

async function main() {
  checkTools();
  if (!args.has('--skip-build')) {
    run('npm', ['run', 'engine:build']);
    run('npm', ['run', 'build']);
  }
  for (const f of ['index.html', 'engine/rt.wasm', 'engine/rt-simd.wasm']) {
    if (!existsSync(join(ROOT, 'dist', f))) throw new Error(`dist/${f} is missing: run npm run engine:build and npm run build`);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  const icon = await makeIcon();
  const exe = cargoBuild(WIN, { REPACKSHOT_ICON: icon.ico });
  const bin = cargoBuild(LINUX);
  const notices = { text: thirdPartyNotices(ROOT, VERSION) };
  const licence = join(ROOT, 'LICENSE');
  const mtime = sourceDate();
  const artifacts = [];

  // Windows portable.
  const winDir = join(BUILD, 'windows', NAME);
  stage(winDir, {
    'repackshot.exe': exe,
    'portable.txt': { text: crlf('Portable mode: Repackshot keeps its data in the "data" folder next to repackshot.exe.\nDelete this file to keep it in %LOCALAPPDATA%\\Repackshot instead.\n') },
    LICENSE: licence,
    'THIRD-PARTY-NOTICES.txt': notices,
    'README.txt': { text: readme('windows') },
  }, mtime);
  const winZip = join(OUT, `${NAME}-windows-x64-portable.zip`);
  writeFileSync(winZip, zip(collect(winDir, NAME), mtime));
  artifacts.push(winZip);

  // Linux portable.
  const linDir = join(BUILD, 'linux', NAME);
  stage(linDir, {
    repackshot: bin,
    'portable.txt': { text: 'Portable mode: Repackshot keeps its data in the "data" folder next to repackshot.\nDelete this file to keep it in ~/.local/share/repackshot instead.\n' },
    LICENSE: licence,
    'THIRD-PARTY-NOTICES.txt': { text: notices.text.replace(/\r\n/g, '\n') },
    'README.txt': { text: readme('linux') },
    'repackshot.desktop': join(ROOT, 'packaging', 'linux', 'repackshot.desktop'),
    'install-desktop-entry.sh': join(ROOT, 'packaging', 'linux', 'install-desktop-entry.sh'),
    'icon.png': icon.png,
  }, mtime);
  chmodSync(join(linDir, 'repackshot'), 0o755);
  chmodSync(join(linDir, 'install-desktop-entry.sh'), 0o755);
  const exec = new Set([`${NAME}/repackshot`, `${NAME}/install-desktop-entry.sh`]);
  const linTar = join(OUT, `${NAME}-linux-x64-portable.tar.gz`);
  writeFileSync(linTar, targz(collect(linDir, NAME, (rel) => (exec.has(rel) ? 0o755 : 0o644)), mtime));
  artifacts.push(linTar);

  // Windows installer.
  if (!args.has('--no-installer')) {
    const instDir = join(BUILD, 'installer');
    stage(instDir, {
      'repackshot.exe': exe,
      LICENSE: licence,
      'THIRD-PARTY-NOTICES.txt': notices,
      'README.txt': { text: readme('windows', false) },
      'licence.txt': { text: `\uFEFF${crlf(readFileSync(licence, 'utf8'))}` },
    }, mtime);
    const setup = join(OUT, `${NAME}-windows-x64-setup.exe`);
    const v4 = [...VERSION.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0), 0].join('.');
    run('makensis', [
      '-V2',
      '-WX',
      '-INPUTCHARSET',
      'UTF8',
      `-DVERSION=${VERSION}`,
      `-DVERSION4=${v4}`,
      `-DSTAGE=${instDir}`,
      `-DOUTFILE=${setup}`,
      `-DICON=${icon.ico}`,
      `-DLICENSE_TXT=${join(instDir, 'licence.txt')}`,
      join(ROOT, 'packaging', 'windows', 'installer.nsi'),
    ]);
    artifacts.push(setup);
  }

  // AppImage, when the tool is at hand.
  const appimagetool = process.env.APPIMAGETOOL;
  if (appimagetool && existsSync(appimagetool)) {
    const appDir = join(BUILD, 'Repackshot.AppDir');
    rmSync(appDir, { recursive: true, force: true });
    cpSync(linDir, appDir, { recursive: true });
    rmSync(join(appDir, 'portable.txt'));
    rmSync(join(appDir, 'install-desktop-entry.sh'));
    copyFileSync(icon.png, join(appDir, 'repackshot.png'));
    writeFileSync(join(appDir, 'AppRun'), '#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/repackshot" "$@"\n');
    chmodSync(join(appDir, 'AppRun'), 0o755);
    const image = join(OUT, `${NAME}-linux-x64.AppImage`);
    run(appimagetool, ['--appimage-extract-and-run', appDir, image], { env: { ...process.env, ARCH: 'x86_64', SOURCE_DATE_EPOCH: String(Math.floor(mtime.getTime() / 1000)) } });
    artifacts.push(image);
  } else console.log('AppImage: skipped (opt-in with APPIMAGETOOL; see the note at the top of this file)');

  const sums = artifacts.map((p) => `${sha256(p)}  ${p.slice(OUT.length + 1)}`).join('\n');
  writeFileSync(join(OUT, 'SHA256SUMS.txt'), `${sums}\n`);
  console.log(`\nout/release (version ${VERSION}):`);
  for (const p of artifacts) console.log(`  ${p.slice(OUT.length + 1)}  ${mib(p)}`);
  console.log('  SHA256SUMS.txt');
  // The staging folders stay in out/release/build for inspection.
}

main().catch((err) => {
  console.error(`release: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
