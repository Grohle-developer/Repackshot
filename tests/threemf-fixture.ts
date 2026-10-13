// A 3MF package written for the tests: two objects with base materials, built
// as two items, the second one moved by a build transform. Stored zip, minimal
// XML, hand-written (see tests/fixtures/README.md).

import { zipStored } from './zip';

/** A closed box as 8 vertices and 12 triangles, outward. */
function box(x: number, y: number, z: number, w: number, d: number, h: number): { vertices: string; triangles: string } {
  const v = [
    [x, y, z],
    [x + w, y, z],
    [x + w, y + d, z],
    [x, y + d, z],
    [x, y, z + h],
    [x + w, y, z + h],
    [x + w, y + d, z + h],
    [x, y + d, z + h],
  ];
  const t = [
    [0, 2, 1], [0, 3, 2], // bottom
    [4, 5, 6], [4, 6, 7], // top
    [0, 1, 5], [0, 5, 4], // front (-y)
    [1, 2, 6], [1, 6, 5], // right (+x)
    [2, 3, 7], [2, 7, 6], // back (+y)
    [3, 0, 4], [3, 4, 7], // left (-x)
  ];
  return {
    vertices: v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join(''),
    triangles: t.map((p) => `<triangle v1="${p[0]}" v2="${p[1]}" v3="${p[2]}"/>`).join(''),
  };
}

export function buildThreeMf(unit: string | null = 'inch'): Uint8Array {
  const body = box(0, 0, 0, 1, 1, 2);
  const cap = box(0, 0, 0, 0.5, 0.5, 0.25);
  const attr = unit === null ? '' : ` unit="${unit}"`;
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n<model${attr} xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources>` +
    `<basematerials id="1"><base name="Steel" displaycolor="#CC3320"/><base name="Brass" displaycolor="#B5A642"/></basematerials>` +
    `<object id="2" type="model" name="Body" pid="1" pindex="0"><mesh><vertices>${body.vertices}</vertices><triangles>${body.triangles}</triangles></mesh></object>` +
    `<object id="3" type="model" name="Cap" pid="1" pindex="1"><mesh><vertices>${cap.vertices}</vertices><triangles>${cap.triangles}</triangles></mesh></object>` +
    `</resources>` +
    `<build><item objectid="2"/><item objectid="3" transform="1 0 0 0 1 0 0 0 1 0.25 0.25 2"/></build>` +
    `</model>`;
  return zipStored([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`],
    ['3D/3dmodel.model', model],
  ]);
}
