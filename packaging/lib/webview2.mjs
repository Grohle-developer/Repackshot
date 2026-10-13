// WebView2Loader.dll for the Windows packages (phase P3c): Microsoft's loader that `repackshot.exe` loads
// to open its own window with the WebView2 runtime of Windows 10 and 11
// (engine/crates/rt-app/src/platform/host.rs).
//
// Where it comes from: the NuGet package Microsoft.Web.WebView2 (Microsoft's WebView2 SDK), pinned to one
// version and checked by SHA-256 twice, the package and the DLL in it, so every release ships the same
// bytes. The package is fetched from nuget.org once and kept in out/cache/; REPACKSHOT_WEBVIEW2_NUPKG
// names a copy already on disk (offline builds). Its licence (LICENSE.txt in the package, a BSD-style
// licence of Microsoft that allows redistribution in binary form with the copyright notice and the
// licence in the documentation) goes into THIRD-PARTY-NOTICES.txt of the Windows packages.
//
// Why ship the loader rather than call the runtime directly: the loader is the documented, supported
// way to find and start the runtime (Evergreen or fixed, preview channels, the WEBVIEW2_* overrides and
// group policies), and Microsoft keeps it compatible with every newer runtime; the runtime's own entry
// point behind it is undocumented and could change with any monthly Evergreen update, which would break
// installed copies without a release of ours. See Microsoft's "Distribute your app and the WebView2
// Runtime" (learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) and "Files to ship with
// the app".

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const WEBVIEW2_SDK = {
  version: '1.0.4258.31',
  url: 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/microsoft.web.webview2.1.0.4258.31.nupkg',
  nupkgSha256: '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9',
  dll: 'runtimes/win-x64/native/WebView2Loader.dll',
  dllSha256: '3426dcc55fdfb8b5e7ac623cf33b4ccf283fbf68a0c5a65bddfdb4d749a8abee',
  licence: 'LICENSE.txt',
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The entries of a zip file (a NuGet package is one): name → bytes, stored or deflated. */
export function unzipEntries(zip, wanted) {
  const u32 = (o) => zip.readUInt32LE(o);
  const u16 = (o) => zip.readUInt16LE(o);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = u16(eocd + 10);
  let p = u32(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(p) !== 0x02014b50) throw new Error('damaged zip central directory');
    const method = u16(p + 10);
    const size = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const local = u32(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    if (u32(local) !== 0x04034b50) throw new Error(`damaged zip entry ${name}`);
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`zip entry ${name}: compression method ${method}`);
  }
  return out;
}

function fetchPackage(cacheDir) {
  const cached = join(cacheDir, `microsoft.web.webview2.${WEBVIEW2_SDK.version}.nupkg`);
  const ok = (path) => existsSync(path) && sha256(readFileSync(path)) === WEBVIEW2_SDK.nupkgSha256;
  if (ok(cached)) return cached;
  mkdirSync(cacheDir, { recursive: true });
  const local = process.env.REPACKSHOT_WEBVIEW2_NUPKG;
  if (local) {
    if (!ok(local)) throw new Error(`REPACKSHOT_WEBVIEW2_NUPKG ${local} is not Microsoft.Web.WebView2 ${WEBVIEW2_SDK.version} (sha256 ${WEBVIEW2_SDK.nupkgSha256})`);
    copyFileSync(local, cached);
    return cached;
  }
  const part = `${cached}.part`;
  rmSync(part, { force: true });
  console.log(`$ curl ${WEBVIEW2_SDK.url}`);
  const r = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', part, WEBVIEW2_SDK.url], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    throw new Error(`cannot download Microsoft.Web.WebView2 ${WEBVIEW2_SDK.version} (${r.error?.message ?? `curl ${r.status}`}); download ${WEBVIEW2_SDK.url} by hand and set REPACKSHOT_WEBVIEW2_NUPKG`);
  }
  const got = sha256(readFileSync(part));
  if (got !== WEBVIEW2_SDK.nupkgSha256) {
    rmSync(part, { force: true });
    throw new Error(`Microsoft.Web.WebView2 ${WEBVIEW2_SDK.version}: sha256 ${got}, expected ${WEBVIEW2_SDK.nupkgSha256}`);
  }
  renameSync(part, cached);
  return cached;
}

/** The pinned WebView2Loader.dll (x64) and the SDK's licence text. */
export function webview2Loader(cacheDir) {
  const nupkg = fetchPackage(cacheDir);
  const entries = unzipEntries(readFileSync(nupkg), [WEBVIEW2_SDK.dll, WEBVIEW2_SDK.licence]);
  const dll = entries.get(WEBVIEW2_SDK.dll);
  const licence = entries.get(WEBVIEW2_SDK.licence)?.toString('utf8');
  if (!dll || !licence) throw new Error(`Microsoft.Web.WebView2 ${WEBVIEW2_SDK.version}: ${WEBVIEW2_SDK.dll} or ${WEBVIEW2_SDK.licence} missing`);
  if (sha256(dll) !== WEBVIEW2_SDK.dllSha256) throw new Error(`WebView2Loader.dll: sha256 ${sha256(dll)}, expected ${WEBVIEW2_SDK.dllSha256}`);
  return { dll, licence };
}

/** The section of THIRD-PARTY-NOTICES.txt for the loader (Windows packages only). */
export function webview2Notice(licence) {
  const rule = '='.repeat(78);
  return `${rule}\nWebView2Loader.dll (Microsoft.Web.WebView2 ${WEBVIEW2_SDK.version}, Windows only), next to repackshot.exe\n${rule}\nhttps://www.nuget.org/packages/Microsoft.Web.WebView2/${WEBVIEW2_SDK.version}\nsha256 ${WEBVIEW2_SDK.dllSha256}\n\n${licence.trim()}\n`;
}
