// Inspector (UI.md §2.4): contextual. Edits the selection; with nothing
// selected, edits the scene. A breadcrumb says what is being edited.

import { selectedNodes } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import * as cmd from '../commands';
import { h, icon } from '../dom';
import { cameraName, lightName } from '../names';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { kbdFor } from '../shortcuts';
import { getLang, t } from '../strings';
import { guideStrip } from './guide';
import { importSheet } from './import-sheet';
import { cameraInspector, lightInspector, partsInspector } from './insp-parts';
import { levelSelector } from './scene';
import { sceneInspector } from './insp-scene';

type Context = { kind: 'scene' } | { kind: 'parts'; ids: string[]; faces: boolean } | { kind: 'light'; id: string } | { kind: 'camera'; id: string };

export function contextOf(s: ProjectState): Context {
  const ids = s.selection.ids;
  const light = ids.find((id) => s.studio.lights.some((l) => l.id === id));
  if (light) return { kind: 'light', id: light };
  const cam = ids.find((id) => s.camera.cameras[id]);
  if (cam) return { kind: 'camera', id: cam };
  const nodes = selectedNodes(s);
  if (nodes.length > 0) return { kind: 'parts', ids: nodes, faces: s.selection.level === 'FACES' };
  return { kind: 'scene' };
}

/**
 * What the inspector is built for; it is rebuilt when this changes. At the Faces level the inspector is not the
 * same with faces selected (material, wear, part) as without (a note to click one), so that goes in the key: the
 * first face of a part that was selected without any has to bring the material section in.
 */
export function contextKey(s: ProjectState): string {
  const c = contextOf(s);
  if (c.kind === 'parts') return `parts:${c.faces ? `f${s.selection.faces && s.selection.faces.indices.length > 0 ? '+' : '-'}:` : ''}${c.ids.join(',')}`;
  if (c.kind === 'light' || c.kind === 'camera') return `${c.kind}:${c.id}`;
  return 'scene';
}

function breadcrumb(ctx: Ctx, scope: Scope): HTMLElement {
  const el = h('nav', { class: 'crumbs', 'aria-label': t('common.panelRight') });
  scope.watch(
    (s) => [contextKey(s), s.scene.nodes, s.selection.faces, s.camera.cameras] as const,
    () => {
      const s = ctx.store.get();
      const c = contextOf(s);
      const root = h('button', { type: 'button', class: 'crumb', onclick: () => cmd.deselect(ctx) }, t('inspector.scene'));
      let tail: string | null = null;
      if (c.kind === 'parts') {
        if (c.faces && s.selection.faces) {
          const n = s.selection.faces.indices.length;
          const part = s.scene.nodes[s.selection.faces.part]?.name ?? '';
          tail = n === 1 ? t('inspector.face', { part }) : t('inspector.faces', { n, part });
        }
        else tail = c.ids.length === 1 ? s.scene.nodes[c.ids[0]].name : t('inspector.parts', { n: c.ids.length });
      } else if (c.kind === 'light') tail = lightName(s, c.id, getLang());
      else if (c.kind === 'camera') tail = cameraName(s, s.camera.cameras[c.id]);
      el.replaceChildren(root);
      if (tail) el.append(h('span', { class: 'crumb-sep' }, '›'), h('span', { class: 'crumb-tail' }, tail));
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3],
  );
  return el;
}

export function inspectorPanel(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  const levelHost = dynamic(
    scope,
    (s, u) => !u.importSheet && contextOf(s).kind === 'parts',
    (sc, isParts) => (isParts ? h('div', { style: 'padding:6px var(--pad) 8px;border-bottom:1px solid var(--line)' }, levelSelector(ctx, sc)) : null),
  );
  const head = h(
    'div',
    { class: 'side-head' },
    breadcrumb(ctx, scope),
    h('span', { style: 'flex:1' }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.collapse'), 'data-tip': t('common.collapse'), 'data-kbd': kbdFor('panels'), onclick: () => ui.set({ rightCollapsed: true }) }, icon('panelRight')),
  );
  // While a file waits for its options the sheet takes the place of the contextual inspector (UI.md §2.3).
  const body = dynamic(scope, (s, u) => (u.importSheet ? `import:${u.importSheet.id}:${u.importSheet.rev ?? 0}` : contextKey(s)), (sc) => {
    if (ctx.ui.get().importSheet) return importSheet(ctx, sc);
    const s = ctx.store.get();
    const c = contextOf(s);
    if (c.kind === 'parts') return partsInspector(ctx, sc, c.ids, c.faces);
    if (c.kind === 'light') return lightInspector(ctx, sc, c.id);
    if (c.kind === 'camera') return cameraInspector(ctx, sc, c.id);
    return sceneInspector(ctx, sc);
  });
  const rail = h(
    'div',
    { class: 'rail' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.expand'), 'data-tip': t('common.panelRight'), onclick: () => ui.set({ rightCollapsed: false }) }, icon('panelRight')),
  );
  return h(
    'aside',
    { class: 'side side-right', 'aria-label': t('common.panelRight') },
    rail,
    h('div', { class: 'side-body' }, head, guideStrip(ctx, scope), levelHost, h('div', { class: 'side-scroll' }, body)),
  );
}
