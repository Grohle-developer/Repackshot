// Scene panel (UI.md §2.2): tabs Parts · Cameras · Lights · Studios.

import { lightSetup } from '../../data/light-setups';
import type { NodeId, SceneNode, SelectionLevel } from '../../core/scene';
import { ancestors, effectiveVisible, levelForKind, SELECTION_LEVELS } from '../../core/scene';
import { lightShares } from '../../core/lighting';
import * as cmd from '../commands';
import { segmented, textField, toggle } from '../components/controls';
import { confirmBox, openMenu, tabs } from '../components/widgets';
import { partMenu } from './part-menu';
import { h, icon } from '../dom';
import type { IconName } from '../icons';
import { cameraName, dyn, lightName, materialName, studioLabel } from '../names';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { kbdFor } from '../shortcuts';
import { L, formatNumber, getLang, lbl, t } from '../strings';
import type { SceneTab } from '../ui-state';

const TAB_ICONS: Record<SceneTab, IconName> = { parts: 'part', cameras: 'camera', lights: 'light', studios: 'studio' };
const TABS: readonly SceneTab[] = ['parts', 'cameras', 'lights', 'studios'];
const KIND_ICON: Record<string, IconName> = { MODEL: 'model', GROUP: 'group', PART: 'part', LIGHT: 'light' };

/** Four-position level selector with shortcuts 1–4 (UI.md §4.1). */
export function levelSelector(ctx: Ctx, scope: Scope): HTMLElement {
  const ids = ['level.MODEL', 'level.GROUP', 'level.PART', 'level.FACES'];
  const seg = segmented<SelectionLevel>(
    SELECTION_LEVELS.map((l, i) => ({ value: l, label: t(dyn(`level.${l}`)), title: t(dyn(`level.tip.${l}`)) + ` · ${kbdFor(ids[i])}` })),
    ctx.store.get().selection.level,
    (l) => cmd.setLevel(ctx, l),
    { full: true, ariaLabel: t('level.title') },
  );
  scope.watch((s) => s.selection.level, (l) => seg.set(l));
  return seg.el;
}

function treeRows(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const list = h('div', { class: 'tree', role: 'tree', 'aria-label': t('tab.parts') });
  let anchor: NodeId | null = null;
  let order: NodeId[] = [];

  const select = (node: SceneNode, e: MouseEvent) => {
    const level = levelForKind(node.kind);
    if (e.shiftKey && anchor && order.includes(anchor)) {
      const a = order.indexOf(anchor);
      const b = order.indexOf(node.id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter((id) => store.get().scene.nodes[id]?.kind === node.kind);
      store.dispatch({ type: 'scene/select', ids: range, mode: 'set', level });
      return;
    }
    anchor = node.id;
    store.dispatch({ type: 'scene/select', ids: [node.id], mode: e.ctrlKey || e.metaKey ? 'toggle' : 'set', level });
  };

  // The full menu of UI.md §2.2 (phase U3), shared with the viewport.
  const contextMenu = (node: SceneNode, row: HTMLElement) => {
    const s = store.get();
    const ids = s.selection.ids.includes(node.id) ? s.selection.ids.filter((id) => s.scene.nodes[id]) : [node.id];
    openMenu(row, partMenu(ctx, ids, { rename: () => startRename(node.id) }));
  };

  const startRename = (id: NodeId) => {
    const row = list.querySelector(`[data-id="${id}"]`);
    const nameEl = row?.querySelector('.tree-name');
    if (!nameEl) return;
    const f = textField(store.get().scene.nodes[id].name, (v) => cmd.renameNode(ctx, id, v), t('common.rename'));
    nameEl.replaceWith(f.el);
    f.el.focus();
    (f.el as HTMLInputElement).select();
    f.el.addEventListener('blur', () => rebuild());
  };

  const actionBtn = (ic: IconName, label: string, on: boolean, fn: () => void) =>
    h('button', { type: 'button', class: `icon-btn sm${on ? ' is-on' : ''}`, 'aria-label': label, 'data-tip': label, onclick: (e: MouseEvent) => (e.stopPropagation(), fn()) }, icon(ic, 14));

  const row = (node: SceneNode, depth: number, hasKids: boolean, folded: boolean) => {
    const s = store.get();
    const mats = node.kind === 'PART' ? [node.material, ...(node.faceMaterials ?? []).map((f) => f.material)].filter((m, i, a) => m && a.indexOf(m) === i) : [];
    const matText = node.kind !== 'PART' ? null : mats.length > 1 ? t('tree.materials', { n: mats.length }) : mats.length === 1 ? materialName(s.materials[mats[0]!]) : t('tree.noMaterial');
    const visible = effectiveVisible(s, node.id);
    const el = h(
      'div',
      {
        class: `tree-row${visible ? '' : ' is-hidden'}`,
        role: 'treeitem',
        'aria-level': depth + 1,
        'aria-expanded': hasKids ? String(!folded) : undefined,
        'data-id': node.id,
        tabindex: -1,
      },
      h('span', { class: 'tree-indent', style: `width:${depth * 14}px` }),
      hasKids
        ? h('button', { type: 'button', class: 'tree-twisty', 'aria-label': folded ? t('common.expand') : t('common.collapse'), onclick: (e: MouseEvent) => {
            e.stopPropagation();
            const f = { ...ui.get().folded };
            if (folded) delete f[node.id];
            else f[node.id] = true;
            ui.set({ folded: f });
          } }, icon(folded ? 'chevronRight' : 'chevronDown', 12))
        : h('span', { class: 'tree-twisty' }),
      h('span', { class: 'tree-kind', 'data-tip': t(dyn(`kind.${node.kind}`)) }, icon(KIND_ICON[node.kind] ?? 'part', 14)),
      h('span', { class: 'tree-text' }, h('span', { class: 'tree-name' }, node.name), matText ? h('span', { class: 'aux tree-mat' }, matText) : null),
      h(
        'span',
        { class: 'tree-actions' },
        actionBtn(node.visible ? 'eye' : 'eyeOff', node.visible ? t('tree.hide') : t('tree.show'), !node.visible, () => cmd.hideSelection(ctx, [node.id], !node.visible)),
        actionBtn('target', t('tree.frame'), false, () => cmd.frameSelection(ctx, [node.id])),
        actionBtn(node.locked ? 'lock' : 'unlock', node.locked ? t('tree.unlock') : t('tree.lock'), node.locked, () => cmd.setLocked(ctx, [node.id], !node.locked)),
      ),
    );
    el.addEventListener('click', (e) => select(node, e));
    el.addEventListener('dblclick', () => cmd.frameSelection(ctx, [node.id]));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!store.get().selection.ids.includes(node.id)) select(node, e);
      contextMenu(node, el);
    });
    el.addEventListener('mouseenter', () => ui.set({ hover: node.id }));
    el.addEventListener('mouseleave', () => ui.get().hover === node.id && ui.set({ hover: null }));
    // Drop a material from the catalogue onto the row.
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-repackshot-material')) return;
      e.preventDefault();
      el.classList.add('is-drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('is-drop');
      const src = cmd.parseMaterialDrag(e.dataTransfer?.getData('application/x-repackshot-material') ?? '');
      if (!src) return;
      e.preventDefault();
      const spec = cmd.requestAssign(ctx, src, [node.id]);
      if (spec) {
        const host = h('div', { class: 'tree-confirm' });
        el.after(host);
        host.appendChild(confirmBox(spec, () => host.remove()));
      }
    });
    return el;
  };

  const rebuild = () => {
    const s = store.get();
    const u = ui.get();
    const filter = u.treeFilter.trim().toLowerCase();
    const keep = new Set<NodeId>();
    if (filter) {
      for (const n of Object.values(s.scene.nodes)) {
        if (n.name.toLowerCase().includes(filter)) {
          keep.add(n.id);
          for (const a of ancestors(s, n.id)) keep.add(a);
        }
      }
    }
    list.replaceChildren();
    order = [];
    const walk = (id: NodeId, depth: number) => {
      const node = s.scene.nodes[id];
      if (!node) return;
      if (filter && !keep.has(id)) return;
      const folded = !filter && u.folded[id] === true;
      const kids = node.children.filter((c) => s.scene.nodes[c]);
      list.appendChild(row(node, depth, kids.length > 0, folded));
      order.push(id);
      if (!folded) for (const c of kids) walk(c, depth + 1);
    };
    for (const r of s.scene.roots) walk(r, 0);
    if (s.scene.roots.length === 0) list.appendChild(h('p', { class: 'note', style: 'padding:12px' }, t('tree.empty')));
    else if (order.length === 0) list.appendChild(h('p', { class: 'note', style: 'padding:12px' }, t('tree.noMatch')));
    paint();
  };

  const paint = () => {
    const s = store.get();
    const sel = new Set(s.selection.ids);
    const hover = ui.get().hover;
    for (const el of list.querySelectorAll<HTMLElement>('.tree-row')) {
      const id = el.dataset.id!;
      el.classList.toggle('is-selected', sel.has(id));
      el.setAttribute('aria-selected', String(sel.has(id)));
      el.classList.toggle('is-hover', hover === id);
    }
  };

  scope.watch((s, u) => [s.scene.nodes, s.scene.roots, s.materials, u.treeFilter, u.folded], rebuild, shallowEq);
  scope.watch((s, u) => [s.selection, u.hover], paint, shallowEq);
  return list;
}

function partsTab(ctx: Ctx, scope: Scope): HTMLElement {
  const filter = h('input', { type: 'search', class: 'text-input', placeholder: t('tree.filter'), 'aria-label': t('tree.filter'), value: ctx.ui.get().treeFilter }) as HTMLInputElement;
  filter.addEventListener('input', () => ctx.ui.set({ treeFilter: filter.value }));
  filter.addEventListener('keydown', (e) => e.stopPropagation());
  return h(
    'div',
    { class: 'tab-body' },
    h('div', { class: 'stack', style: 'padding:8px var(--pad);border-bottom:1px solid var(--line)' }, filter, levelSelector(ctx, scope)),
    h('div', { class: 'side-scroll' }, treeRows(ctx, scope)),
  );
}

function camerasTab(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const list = h('div', { class: 'list' });
  scope.watch(
    (s) => [s.camera, s.selection.ids],
    () => {
      const s = store.get();
      list.replaceChildren(
        ...Object.values(s.camera.cameras).map((cam) => {
          const active = s.camera.active === cam.id;
          const el = h(
            'div',
            { class: `list-row${s.selection.ids.includes(cam.id) ? ' is-selected' : ''}`, role: 'button', tabindex: 0 },
            icon('camera', 14),
            h('span', { class: 'list-main' }, cameraName(s, cam)),
            active ? h('span', { class: 'aux' }, t('cameras.active')) : null,
            cam.locked ? icon('lock', 12) : null,
          );
          const go = () => {
            if (!active) cmd.activateCamera(ctx, cam.id);
            store.dispatch({ type: 'scene/select', ids: [cam.id], mode: 'set' });
          };
          el.addEventListener('click', go);
          el.addEventListener('keydown', (e) => e.key === 'Enter' && go());
          return el;
        }),
      );
    },
    shallowEq,
  );
  const target = () => {
    const s = store.get();
    return s.selection.ids.find((id) => s.camera.cameras[id]) ?? s.camera.active;
  };
  return h(
    'div',
    { class: 'tab-body' },
    h('div', { class: 'side-scroll' }, list),
    h(
      'div',
      { class: 'side-foot' },
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => cmd.newCamera(ctx) }, icon('plus', 14), t('cameras.new')),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => cmd.duplicateCamera(ctx, target()) }, icon('duplicate', 14), t('common.duplicate')), h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => cmd.deleteCamera(ctx, target()) }, icon('trash', 14), t('common.delete'))),
    ),
  );
}

function lightsTab(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const list = h('div', { class: 'list' });
  const note = h('p', { class: 'note', style: 'padding:8px var(--pad) 0' });
  scope.watch(
    (s) => [s.studio, s.selection.ids],
    () => {
      const s = store.get();
      const shares = lightShares(s.studio.lights);
      note.textContent = s.studio.built ? '' : t('lights.notBuilt', { preset: lbl(studioLabel(s.studio.preset)) });
      note.style.display = s.studio.built ? 'none' : '';
      if (s.studio.lights.length === 0) {
        list.replaceChildren(h('p', { class: 'note', style: 'padding:12px' }, t('lights.empty')));
        return;
      }
      list.replaceChildren(
        ...s.studio.lights.map((l, i) => {
          const tg = toggle(l.enabled, (v) => store.dispatch({ type: 'studio/setLight', id: l.id, patch: { enabled: v }, label: L('undo.editLight', { name: { en: lightName(s, l.id, 'en'), es: lightName(s, l.id, 'es') } }) }), t('lights.toggle'));
          tg.el.addEventListener('click', (e) => e.stopPropagation());
          const el = h(
            'div',
            { class: `list-row light-row${s.selection.ids.includes(l.id) ? ' is-selected' : ''}${l.enabled ? '' : ' is-off'}`, role: 'button', tabindex: 0 },
            h(
              'div',
              { class: 'list-main' },
              h('div', null, lightName(s, l.id, getLang())),
              h('div', { class: 'bar-meter', 'data-tip': t('lights.share', { pct: formatNumber(shares[i] * 100, getLang(), 0) }) }, h('div', { style: `width:${Math.round(shares[i] * 100)}%` })),
            ),
            h('span', { class: 'aux tabular', style: 'width:36px;text-align:right' }, `${formatNumber(shares[i] * 100, getLang(), 0)} %`),
            tg.el,
          );
          el.addEventListener('click', () => store.dispatch({ type: 'scene/select', ids: [l.id], mode: 'set' }));
          return el;
        }),
      );
    },
    shallowEq,
  );
  const reset = h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => store.dispatch({ type: 'studio/resetLights', label: L('undo.resetLights') }) }, t('lights.reset'));
  scope.watch((s) => s.studio.modified, (m) => (reset.disabled = !m));
  return h(
    'div',
    { class: 'tab-body' },
    note,
    h('div', { class: 'side-scroll' }, list),
    h(
      'div',
      { class: 'side-foot' },
      h('button', { type: 'button', class: 'btn btn-block', disabled: true, 'data-tip': t('lights.addSoon') }, icon('plus', 14), t('lights.add'), h('span', { class: 'aux' }, t('common.comingSoon'))),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', style: 'flex:1', disabled: true, 'data-tip': t('lights.saveSetupSoon') }, t('lights.saveSetup')), reset),
    ),
  );
}

function studiosTab(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const list = h('div', { class: 'list' });
  scope.watch(
    (s) => s.studio.saved,
    (saved) => {
      if (saved.length === 0) {
        list.replaceChildren(h('p', { class: 'note', style: 'padding:12px' }, t('studios.empty')));
        return;
      }
      list.replaceChildren(
        ...saved.map((st) => {
          const setup = st.lightSetup === 'PRESET' ? null : lightSetup(st.lightSetup);
          const del = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('common.delete'), 'data-tip': t('common.delete'), onclick: (e: MouseEvent) => {
            e.stopPropagation();
            store.dispatch({ type: 'studio/deleteSaved', id: st.id, label: L('undo.deleteStudio', { name: st.name }) });
          } }, icon('trash', 14));
          const el = h(
            'div',
            { class: 'list-row', role: 'button', tabindex: 0, 'data-tip': t('studios.restore') },
            icon('studio', 14),
            h('span', { class: 'list-main' }, h('div', null, st.name), h('div', { class: 'aux' }, `${lbl(studioLabel(st.preset))}${setup ? ` · ${lbl(setup.label)}` : ''}`)),
            del,
          );
          el.addEventListener('click', () => cmd.restoreStudio(ctx, st.id));
          el.addEventListener('keydown', (e) => e.key === 'Enter' && cmd.restoreStudio(ctx, st.id));
          return el;
        }),
      );
    },
  );
  return h(
    'div',
    { class: 'tab-body' },
    h('div', { class: 'side-foot', style: 'border-top:0;border-bottom:1px solid var(--line)' }, h('button', { type: 'button', class: 'btn btn-block', onclick: () => cmd.saveStudio(ctx) }, icon('plus', 14), t('studios.save'))),
    h('div', { class: 'side-scroll' }, list),
  );
}

export function scenePanel(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  const tabItems = TABS.map((id) => ({ id, label: t(dyn(`tab.${id}`)), icon: TAB_ICONS[id] }));
  const head = h('div', { class: 'side-head' });
  scope.watch(
    (_s, u) => u.sceneTab,
    (tab) =>
      head.replaceChildren(
        tabs(tabItems, tab, (id) => ui.set({ sceneTab: id }), t('scene.title')),
        h('span', { style: 'flex:1' }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.collapse'), 'data-tip': t('common.collapse'), 'data-kbd': kbdFor('panels'), onclick: () => ui.set({ leftCollapsed: true }) }, icon('panelLeft')),
      ),
  );
  const body = dynamic(
    scope,
    (_s, u) => u.sceneTab,
    (sc, tab) => (tab === 'parts' ? partsTab(ctx, sc) : tab === 'cameras' ? camerasTab(ctx, sc) : tab === 'lights' ? lightsTab(ctx, sc) : studiosTab(ctx, sc)),
    undefined,
    'div',
    'side-tab',
  );
  const rail = h(
    'div',
    { class: 'rail' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.expand'), 'data-tip': t('common.panelLeft'), onclick: () => ui.set({ leftCollapsed: false }) }, icon('panelLeft')),
    ...TABS.map((id) => h('button', { type: 'button', class: 'icon-btn', 'aria-label': t(dyn(`tab.${id}`)), 'data-tip': t(dyn(`tab.${id}`)), onclick: () => ui.set({ sceneTab: id, leftCollapsed: false }) }, icon(TAB_ICONS[id]))),
  );
  return h('aside', { class: 'side side-left', 'aria-label': t('common.panelLeft') }, rail, h('div', { class: 'side-body' }, head, body));
}
