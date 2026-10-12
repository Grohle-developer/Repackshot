// The few Node modules the test shims use (tests/worker-shim.ts). The project does not depend on
// @types/node, so only what is called is declared here.

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array<ArrayBuffer>;
}
declare module 'node:buffer' {
  export function resolveObjectURL(url: string): Blob | undefined;
}
declare module 'node:module' {
  export function createRequire(url: string): { resolve(id: string): string };
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
