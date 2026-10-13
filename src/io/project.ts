// The .repack.json envelope (ARCHITECTURE §8). U1 writes the state as is;
// phase U2 adds the embedded meshes (GLB in base64) and opening a project.
//
// Schema history (each step a pure function, applied in order on load):
//   1 (U1) — the state as it was.
//   2 (U5) — `render` is the render window's settings and a queue of full
//            `RenderJob`s (core/render.ts `migrateRender`).

import { migrateRender } from '../core/render';
import type { ProjectState } from '../core/store';

export const PROJECT_FORMAT = 'repackshot-project';
export const PROJECT_SCHEMA = 2;

export function serializeProject(state: ProjectState): Blob {
  const body = { format: PROJECT_FORMAT, schema: PROJECT_SCHEMA, state };
  return new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' });
}

type RawState = Record<string, unknown>;

/** One step per schema: the state of schema `n` to schema `n + 1`. */
const STEPS: Record<number, (state: RawState) => RawState> = {
  // U1 → U5: the render block (settings, full jobs; nothing runs after a load).
  1: (state) => ({ ...state, render: migrateRender(state.render) }),
};

/**
 * A parsed project file to the current state: checks the envelope and runs the migration steps
 * from its schema up. Every load passes through `migrateRender` too, so a render block of this
 * schema is normalised the same way (and nothing is left "running"). Throws with a reason when the
 * file is not a project or comes from a newer version.
 */
export function migrateProject(body: unknown): ProjectState {
  if (typeof body !== 'object' || body === null) throw new Error('not a Repackshot project');
  const b = body as Record<string, unknown>;
  if (b.format !== PROJECT_FORMAT) throw new Error('not a Repackshot project');
  const schema = typeof b.schema === 'number' && Number.isInteger(b.schema) ? b.schema : 1;
  if (schema > PROJECT_SCHEMA) throw new Error(`the project was saved by a newer version (schema ${schema})`);
  if (typeof b.state !== 'object' || b.state === null) throw new Error('the project has no state');
  let state = b.state as RawState;
  for (let n = Math.max(1, schema); n < PROJECT_SCHEMA; n++) state = STEPS[n](state);
  return { ...(state as unknown as ProjectState), render: migrateRender(state.render) };
}

/** The text of a .repack.json file to a state (see `migrateProject`). */
export function parseProject(text: string): ProjectState {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('not a Repackshot project');
  }
  return migrateProject(body);
}
