// What happens to the lights already in the scene when a catalogue entry (a Set or Lights, core/setup-groups.ts) or an
// own setup comes in (phase L7): Replace deletes them (what choosing a setup always did), Hide keeps them switched off
// (`LightInstance.enabled`, so a switch of the Lights list turns each back on), Add keeps them as they were and adds
// the new ones. One action, one undo step, whatever the choice.
//
// The lights kept become the person's own (`own`, L4): they are not the setup's, so Reset setup takes them away. Each
// keeps its id (an animation clip or the selection that points at it still does) and gets a name that says where it
// came from (given by the interface, in its language: "Key · Rembrandt"); a new light whose id is taken gets another.
//
// The decoration of a set (cards, backdrop, floor, the pool's spot) is not a light the person put there: a Set that
// comes in replaces the decoration in force whatever the choice (a scene has one set), and a Lights entry that comes
// in with Hide or Add leaves the decoration, the pool and the set's look as they were (only Replace takes them away, as
// choosing a setup that is not a set always did).

import { lightSetup } from '../data/light-setups';
import { nextId } from './ids';
import { reduceStudio, presetRefOf, type LightInstance, type StudioAction } from './lighting';
import { setupGroup } from './setup-groups';
import { applySet, reduceSet, setOf, setPieceIds } from './sets';
import type { ProjectState } from './store';

export type PreviousLights = 'REPLACE' | 'HIDE' | 'ADD';
export const PREVIOUS_LIGHTS: readonly PreviousLights[] = ['REPLACE', 'HIDE', 'ADD'];

/** The lights a new setup would ask about: every light that is not a set's decoration (switched on or off). */
export function previousLights(state: ProjectState): LightInstance[] {
  return state.studio.lights.filter((l) => !l.setPiece);
}

/** The key an action puts in force, or null when it is not one that brings a setup. */
function keyOf(action: StudioAction): string | null {
  if (action.type === 'studio/setSetup') return action.key;
  if (action.type === 'studio/applySetup') return action.setup.key;
  return null;
}

/** The scene holds a set's decoration: pieces in the tree or the pool's spot. */
function decorated(state: ProjectState): boolean {
  return setPieceIds(state).length > 0 || state.studio.lights.some((l) => l.setPiece);
}

/** A Lights entry over a set's decoration, the decoration and the set's look left as they are. */
function lightsOverDecoration(state: ProjectState, action: StudioAction): ProjectState {
  if (action.type === 'studio/setSetup') {
    // An Interior recipe is a set without decoration: its look, over the decoration in force.
    const set = setOf(action.key);
    if (set) return applySet(state, set, action.names, false, true);
  }
  const pools = state.studio.lights.filter((l) => l.setPiece);
  const next = reduceStudio(state, action);
  if (next === state) return state;
  return { ...next, studio: { ...next.studio, lights: [...next.studio.lights, ...pools] } };
}

/**
 * `studio/setSetup` or `studio/applySetup` with `previous` HIDE or ADD over a scene with lights (store.ts routes them
 * here first); null for anything else (Replace, no lights before, another action), which the set and rig reducers
 * handle as they always did.
 */
export function reducePrevious(state: ProjectState, action: StudioAction): ProjectState | null {
  const key = keyOf(action);
  if (key === null || !('previous' in action) || (action.previous !== 'HIDE' && action.previous !== 'ADD')) return null;
  const before = previousLights(state);
  if (before.length === 0) return null;
  if (action.type === 'studio/setSetup' && key !== 'PRESET' && !lightSetup(key)) return state;
  const mode = action.previous;
  const names = action.keptNames ?? {};
  const plain = { ...action, previous: undefined } as StudioAction;
  const isSet = action.type === 'studio/setSetup' && setupGroup(key, presetRefOf(state.studio)) === 'SETS';
  const next = isSet || !decorated(state) ? (reduceSet(state, plain) ?? reduceStudio(state, plain)) : lightsOverDecoration(state, plain);
  if (next === state || next.studio.lightSetup !== key) return next;

  // The ids the kept lights hold, and those of the cameras and the parts (a light's id is unique among them).
  const taken = new Set<string>([...before.map((l) => l.id), ...Object.keys(next.camera.cameras), ...Object.keys(next.scene.nodes)]);
  const fresh = (l: LightInstance): LightInstance => {
    if (!taken.has(l.id)) {
      taken.add(l.id);
      return l;
    }
    const id = nextId('l', [...taken]);
    taken.add(id);
    return { ...l, id };
  };
  // The decoration's spot that stayed keeps its id; the new lights take the rest.
  const incoming = next.studio.lights;
  const pools = incoming.filter((l) => l.setPiece && state.studio.lights.some((p) => p.id === l.id && p.setPiece)).map(fresh);
  const added = incoming.filter((l) => !pools.includes(l)).map(fresh);
  const kept = before.map((l): LightInstance => {
    const name = l.name ?? names[l.id];
    return { ...l, own: true, enabled: mode === 'HIDE' ? false : l.enabled, ...(name ? { name } : {}) };
  });
  // The new setup's lights first, then the decoration's spot, then the kept ones.
  const lights = [...added, ...pools, ...kept];
  const ids = new Set([...lights.map((l) => l.id), ...Object.keys(next.scene.nodes), ...Object.keys(next.camera.cameras)]);
  const sel = next.selection.ids.filter((id) => ids.has(id));
  return {
    ...next,
    studio: { ...next.studio, lights, modified: true },
    selection: sel.length === next.selection.ids.length ? next.selection : { ...next.selection, ids: sel },
  };
}
