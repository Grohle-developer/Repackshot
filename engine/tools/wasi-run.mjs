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
