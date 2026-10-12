// Inspector for parts, faces, lights and cameras (filled in below).

import { h } from '../dom';
import type { Ctx, Scope } from '../reactive';

export function partsInspector(_ctx: Ctx, _scope: Scope, _ids: string[], _faces: boolean): HTMLElement {
  return h('div');
}

export function lightInspector(_ctx: Ctx, _scope: Scope, _id: string): HTMLElement {
  return h('div');
}

export function cameraInspector(_ctx: Ctx, _scope: Scope, _id: string): HTMLElement {
  return h('div');
}
