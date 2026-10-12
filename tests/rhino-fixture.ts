// A small .3dm written with the rhino3dm package (openNURBS, MIT) for the 3DM
// tests: a four-layer model of a bottle in millimetres, Z up.
//
//   Assembly            (layer, parent of the next two)
//     Body              render material "Steel" (200, 40, 30), mesh "Body" 40 x 40 x 60 + a sphere B-rep without render meshes
//     Cap               no material, mesh "Cap" 20 x 20 x 10 on top of the body
//   Construction        hidden layer, mesh "Guide" 5 x 5 x 5
//
// Written here rather than committed so the file is always what the library
// of this version writes; see tests/fixtures/README.md.

import rhino3dm from 'rhino3dm';

export type RhinoUnitName = 'Millimeters' | 'Centimeters' | 'Meters' | 'Inches' | 'Feet' | 'None';

export interface RhinoFixtureOptions {
  units?: RhinoUnitName;
  /** Leave the sphere B-rep (no render mesh) out. */
  noBrep?: boolean;
}

type Rhino = Awaited<ReturnType<typeof rhino3dm>>;
let library: Promise<Rhino> | null = null;
export const rhino = (): Promise<Rhino> => (library ??= rhino3dm());

/** A closed box as a mesh of six quads with their own four vertices each (24 vertices), like Rhino saves a box. */
function boxMesh(r: Rhino, min: [number, number, number], size: [number, number, number]) {
  const mesh = new r.Mesh();
  const [x, y, z] = min;
  const [w, d, h] = size;
  const c = (i: number): [number, number, number] => [x + (i & 1 ? w : 0), y + (i & 2 ? d : 0), z + (i & 4 ? h : 0)];
  // Corner numbers are bit patterns (x, y, z); each quad runs counter-clockwise seen from outside.
  const quads = [
    [0, 2, 3, 1], // bottom, -z
    [4, 5, 7, 6], // top, +z
    [0, 1, 5, 4], // front, -y
    [1, 3, 7, 5], // right, +x
    [3, 2, 6, 7], // back, +y
    [2, 0, 4, 6], // left, -x
  ];
  quads.forEach((q, i) => {
    for (const corner of q) mesh.vertices().add(...c(corner));
    mesh.faces().addQuadFace(4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3);
  });
  mesh.normals().computeNormals();
  mesh.compact();
  return mesh;
}

export async function buildRhinoFile(options: RhinoFixtureOptions = {}): Promise<ArrayBuffer> {
  const r = await rhino();
  const doc = new r.File3dm();
  doc.settings().modelUnitSystem = r.UnitSystem[options.units ?? 'Millimeters'];

  const steel = new r.Material();
  steel.name = 'Steel';
  steel.diffuseColor = { r: 200, g: 40, b: 30, a: 255 } as never;
  doc.materials().add(steel);

  const layer = (name: string, parent: number | null, visible = true, material = -1): number => {
    const l = new r.Layer();
    l.name = name;
    l.visible = visible;
    l.renderMaterialIndex = material;
    if (parent !== null) l.parentLayerId = doc.layers().get(parent).id;
    return doc.layers().add(l);
  };
  const assembly = layer('Assembly', null);
  const body = layer('Body', assembly, true, 0);
  const cap = layer('Cap', assembly);
  const construction = layer('Construction', null, false);

  const add = (geometry: unknown, name: string, layerIndex: number, kind: 'Mesh' | 'Brep' = 'Mesh') => {
    const a = new r.ObjectAttributes();
    a.name = name;
    a.layerIndex = layerIndex;
    if (kind === 'Mesh') doc.objects().addMesh(geometry as never, a);
    else doc.objects().addBrep(geometry as never, a);
  };
  add(boxMesh(r, [0, 0, 0], [40, 40, 60]), 'Body', body);
  add(boxMesh(r, [10, 10, 60], [20, 20, 10]), 'Cap', cap);
  add(boxMesh(r, [100, 0, 0], [5, 5, 5]), 'Guide', construction);
  if (!options.noBrep) add(r.Brep.createFromSphere(new r.Sphere([0, 0, 0], 5)), 'Sphere', body, 'Brep');

  const bytes = doc.toByteArray();
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
