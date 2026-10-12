// The .repack.json envelope (ARCHITECTURE §8). U1 writes the state as is;
// phase U2 adds the embedded meshes (GLB in base64), loading and the
// migration table.

import type { ProjectState } from '../core/store';

export const PROJECT_FORMAT = 'repackshot-project';
export const PROJECT_SCHEMA = 1;

export function serializeProject(state: ProjectState): Blob {
  const body = { format: PROJECT_FORMAT, schema: PROJECT_SCHEMA, state };
  return new Blob([JSON.stringify(body, null, 1)], { type: 'application/json' });
}
