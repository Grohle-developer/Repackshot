// Cargo runner for `wasm32-wasip1` test binaries: runs one under Node's WASI.
//
//   CARGO_TARGET_WASM32_WASIP1_RUNNER="node /abs/path/engine/tools/wasi-run.mjs" \
//   RUSTFLAGS="-C target-feature=+simd128" \
//   cargo test -p rt-core --release --target wasm32-wasip1
//
// This is how the engine's `simd128` path (and the scalar path on a 32-bit target) is executed
// and checked bit for bit against the scalar reference outside a browser. The module gets no
// preopened directories and no environment; only arguments (test filters) pass through.
import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';
import process from 'node:process';
import v8 from 'node:v8';

// Node 22 hands the WASI calls (fd_write above all) to V8 as fast API calls, and every one of them reports its
// buffers to the heap as external memory. When that report is what starts a garbage collection, the collector
// walks a stack with an optimized frame in the middle of a fast call and the whole process dies with SIGSEGV
// (v8::internal::InnerPointerToCodeCache::GetCacheEntry, seen on Node 22.22 in rt-core's caustics tests, and
// anywhere else the heap happened to be at its limit at a write). Nothing in a test run needs the fast
// path: turn it off before the first one runs.
v8.setFlagsFromString('--no-turbo-fast-api-calls');

const [file, ...args] = process.argv.slice(2);
if (!file) {
  console.error('usage: node wasi-run.mjs <test.wasm> [test args...]');
  process.exit(2);
}
const wasi = new WASI({ version: 'preview1', args: [file, ...args], env: {}, preopens: {}, returnOnExit: true });
const module = await WebAssembly.compile(await readFile(file));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
// Let Node flush stdout before exiting instead of calling process.exit().
process.exitCode = wasi.start(instance);
