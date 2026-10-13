// The few Node modules the test shims use (tests/worker-shim.ts). The project does not depend on
// @types/node, so only what is called is declared here.

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array<ArrayBuffer>;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: Uint8Array | string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: { env: Record<string, string | undefined> };
declare module 'node:buffer' {
  export function resolveObjectURL(url: string): Blob | undefined;
}
declare module 'node:module' {
  export function createRequire(url: string): { (id: string): unknown; resolve(id: string): string };
}
declare module 'node:worker_threads' {
  export class Worker {
    constructor(code: string, options: { eval: boolean });
    on(event: 'message', fn: (data: unknown) => void): this;
    on(event: 'error', fn: (err: Error) => void): this;
    postMessage(value: unknown, transfer?: unknown[]): void;
    terminate(): Promise<number>;
  }
}
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
