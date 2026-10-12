// Fine-grained updates without a virtual DOM (ARCHITECTURE §6): a Scope holds
// watchers `(state) => value`; when the store or the interface state changes,
// only watchers whose value changed (by reference, or a custom equality) run.
// Scopes nest so a rebuilt part of the DOM drops its own watchers.

import type { ProjectState, Store } from '../core/store';
import type { AppServices } from './ports';
import type { UiState, UiStore } from './ui-state';

export interface Ctx {
  store: Store;
  ui: UiStore;
  services: AppServices;
}

export type Eq<T> = (a: T, b: T) => boolean;

export const refEq = <T>(a: T, b: T): boolean => Object.is(a, b);

export function shallowEq<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

interface Watcher {
  alive: boolean;
  run(state: ProjectState, ui: UiState): void;
}

/** One per app: fans store and ui changes out to every live watcher. */
export class Root {
  private watchers: Watcher[] = [];
  private readonly offs: (() => void)[] = [];
  private pending = false;

  constructor(readonly ctx: Ctx) {
    this.offs.push(ctx.store.subscribe(() => this.flush()));
    this.offs.push(ctx.ui.subscribe(() => this.flush()));
  }

  add(w: Watcher): void {
    this.watchers.push(w);
  }

  private flush(): void {
    if (this.pending) return;
    this.pending = true;
    try {
      // Watchers may dispose scopes or add new ones while running.
      for (let guard = 0; guard < 4; guard++) {
        const list = this.watchers;
        this.watchers = list.filter((w) => w.alive);
        const state = this.ctx.store.get();
        const ui = this.ctx.ui.get();
        for (const w of this.watchers.slice()) if (w.alive) w.run(state, ui);
        if (this.ctx.store.get() === state && this.ctx.ui.get() === ui) break;
      }
    } finally {
      this.pending = false;
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.watchers = [];
  }
}

export class Scope {
  private readonly watchers: Watcher[] = [];
  private readonly children: Scope[] = [];
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  constructor(
    readonly root: Root,
    readonly ctx: Ctx = root.ctx,
  ) {}

  /** Runs `fn` now and whenever `sel` returns a different value. */
  watch<T>(sel: (s: ProjectState, u: UiState) => T, fn: (value: T, prev: T | undefined) => void, eq: Eq<T> = refEq): void {
    let last = sel(this.ctx.store.get(), this.ctx.ui.get());
    const w: Watcher = {
      alive: true,
      run: (s, u) => {
        const v = sel(s, u);
        if (eq(v, last)) return;
        const prev = last;
        last = v;
        fn(v, prev);
      },
    };
    this.watchers.push(w);
    this.root.add(w);
    fn(last, undefined);
  }

  onDispose(fn: () => void): void {
    this.cleanups.push(fn);
  }

  child(): Scope {
    // Drop children that were already disposed (rebuilt sections).
    for (let i = this.children.length - 1; i >= 0; i--) if (this.children[i].disposed) this.children.splice(i, 1);
    const c = new Scope(this.root, this.ctx);
    this.children.push(c);
    return c;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const w of this.watchers) w.alive = false;
    for (const c of this.children) c.dispose();
    for (const fn of this.cleanups) fn();
  }
}

/**
 * A container whose content is rebuilt when `key` changes: the old child
 * scope (and its watchers) is dropped and `build` runs again.
 */
export function dynamic<K>(
  scope: Scope,
  key: (s: ProjectState, u: UiState) => K,
  build: (scope: Scope, key: K) => Node | null,
  eq: Eq<K> = refEq,
  tag: keyof HTMLElementTagNameMap = 'div',
  className = 'dyn',
): HTMLElement {
  const host = document.createElement(tag);
  host.className = className;
  let inner: Scope | null = null;
  scope.watch(
    key,
    (k) => {
      inner?.dispose();
      inner = scope.child();
      host.replaceChildren();
      const node = build(inner, k);
      if (node) host.appendChild(node);
    },
    eq,
  );
  return host;
}
