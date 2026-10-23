// A .repack with a model inside: saving the example project and opening the file again keeps every
// mesh's geometry (not only the node tree), and the parts are there by name.
import { describe, expect, it } from 'vitest';
import { exampleState } from './helpers';
import { getMesh } from '../src/core/meshes';
import { meshIdsInUse } from '../src/core/scene';
import { readProjectFile, serializeProject } from '../src/io/project';

describe('a .repack with a model inside', () => {
  it('saving and opening keeps every mesh’s geometry', async () => {
    const before = exampleState();
    const ids = [...meshIdsInUse(before)];
    expect(ids.length).toBeGreaterThan(0);
    const counts = new Map(
      ids.map((id) => {
        const data = getMesh(id);
        expect(data, id).toBeDefined();
        return [id, { vertices: data!.positions.length / 3, faces: data!.indices.length / 3 }];
      }),
    );
    const file = new File([serializeProject(before)], 'bottle.repack');
    const opened = await readProjectFile(file);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const after = opened.state;
    expect([...meshIdsInUse(after)].sort()).toEqual(ids.sort());
    for (const id of ids) {
      const data = getMesh(id);
      expect(data, id).toBeDefined();
      expect(data!.positions.length / 3).toBe(counts.get(id)!.vertices);
      expect(data!.indices.length / 3).toBe(counts.get(id)!.faces);
    }
    const names = Object.values(after.scene.nodes).map((n) => n.name);
    expect(names).toContain('body');
    expect(names).toContain('label');
    expect(names).toContain('base');
    expect(names).toContain('closure');
  });
});
