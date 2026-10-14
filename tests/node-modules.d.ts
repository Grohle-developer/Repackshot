// The few Node modules the test shims use (tests/worker-shim.ts, and tests/ai-desktop.test.ts, which starts the
// launcher). The project does not depend on @types/node, so only what is called is declared here.

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array<ArrayBuffer>;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: Uint8Array | string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function chmodSync(path: string, mode: number): void;
  export function copyFileSync(from: string, to: string): void;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function statSync(path: string): { mtimeMs: number; size: number; isFile(): boolean; isDirectory(): boolean };
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
  export function deflateSync(data: Uint8Array): Uint8Array;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:child_process' {
  export interface ChildProcess {
    stdout: { on(event: 'data', fn: (chunk: Uint8Array) => void): void } | null;
    stderr: { on(event: 'data', fn: (chunk: Uint8Array) => void): void } | null;
    on(event: 'exit', fn: (code: number | null) => void): this;
    kill(signal?: string): boolean;
  }
  export function spawn(command: string, args: readonly string[], options?: { stdio?: readonly string[] }): ChildProcess;
  export function spawnSync(command: string, args: readonly string[], options?: { encoding?: 'utf8'; cwd?: string; env?: Record<string, string | undefined>; timeout?: number }): { status: number | null; stdout: string; stderr: string };
}
declare const process: { env: Record<string, string | undefined>; platform: string; arch: string; execPath: string };
declare module 'node:buffer' {
  export function resolveObjectURL(url: string): Blob | undefined;
}
declare module 'node:module' {
  export function createRequire(url: string): { (id: string): unknown; resolve(id: string): string };
}
declare module 'node:worker_threads' {
  export class Worker {
    constructor(code: string, options: { eval: boolean });
    constructor(url: URL);
    on(event: 'message', fn: (data: unknown) => void): this;
    on(event: 'error', fn: (err: Error) => void): this;
    postMessage(value: unknown, transfer?: unknown[]): void;
    terminate(): Promise<number>;
  }
}
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): { update(data: Uint8Array | string): { digest(encoding: 'hex'): string } };
}
