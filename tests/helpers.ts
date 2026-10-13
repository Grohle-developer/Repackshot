// Shared fixtures for the model tests: a project with the example loaded.

import { buildExample } from '../src/core/example';
import { createInitialState, createStore, reduce, type Action, type ProjectState, type Store } from '../src/core/store';

/** Ids of the example nodes after loading, by role. */
export function keyIds(state: ProjectState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of Object.values(state.scene.nodes)) if (n.key) out[n.key] = n.id;
  return out;
}

export function exampleState(): ProjectState {
  return reduce(createInitialState(), { type: 'scene/addModel', payload: buildExample(), replace: true });
}

export function exampleStore(): { store: Store; ids: Record<string, string> } {
  const store = createStore(exampleState());
  return { store, ids: keyIds(store.get()) };
}

export function apply(state: ProjectState, ...actions: Action[]): ProjectState {
  return actions.reduce(reduce, state);
}
