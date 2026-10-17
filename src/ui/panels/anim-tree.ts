// The left zone of the animation timeline (phase N6, UI.md §2.5): the tree of what is animated, one row per target
// (the camera track first) with its clips nested, each an icon and a plain sentence. Generic over clip kinds: a row
// reads the clip's sentence and target (ui/sentence.ts), and a kind it has no icon for gets a plain dot.

import type { ClipTarget, MotionClip } from '../../core/animation';
import type { TimelineRow } from '../../core/timeline';
import * as anim from '../anim-commands';
import { openMenu, type MenuItems } from '../components/widgets';
import { h, icon } from '../dom';
import type { IconName } from '../icons';
import type { Ctx } from '../reactive';
import { clipSentence, clipShort, clipTargetName } from '../sentence';
import { kbdText } from '../shortcuts';
import { getLang, t } from '../strings';

/** The icon of a clip's kind; a kind without one (added later) gets a dot. */
const KIND_ICON: Readonly<Record<string, IconName>> = {
  ORBIT: 'orbit',
  RISE: 'arrowUp',
  DOLLY: 'zoom',
  TRACK: 'pan',
  MOVE: 'move',
  SPIN: 'spin',
  TUMBLE: 'spin',
  SCALE: 'scale',
  ZOOM: 'zoom',
  FOCUS: 'focus',
  INTENSITY: 'light',
  TINT: 'light',
  HDRI: 'sphere',
  EXPLODE: 'explode',
  VISIBILITY: 'eye',
  // N1.
  FADE: 'eyeOff',
  PAN: 'pan',
  MATERIAL_COLOR: 'sphere',
  SUN_ARC: 'lightSun',
};

export function clipIcon(move: string): IconName {
  return KIND_ICON[move] ?? 'dot';
}

export function targetIcon(ctx: Ctx, target: ClipTarget): IconName {
  switch (target.kind) {
    case 'CAMERA':
      return 'camera';
    case 'SUBJECT':
      return 'model';
    case 'NODE': {
      const kind = ctx.store.get().scene.nodes[target.id]?.kind;
      return kind === 'MODEL' ? 'model' : kind === 'GROUP' ? 'group' : 'part';
    }
    case 'LIGHT':
      return 'light';
    case 'SCENE':
      return 'studio';
    case 'MATERIAL':
      return 'sphere';
    default:
      return 'dot';
  }
}

/** What the drawer knows about every row when it draws them. */
export interface RowInfo {
  selected: ReadonlySet<string>;
  primary: string | null;
  /** Clips the scene's selection is animated by. */
  related: ReadonlySet<string>;
  conflicts: ReadonlySet<string>;
}

/** The menu of a clip (its row or its bar): duplicate, delete, reverse, split at the playhead, pin in the explode. */
export function clipMenu(ctx: Ctx, clip: MotionClip): MenuItems {
  const ids = anim.selectedClipIds(ctx).includes(clip.id) ? anim.selectedClipIds(ctx) : [clip.id];
  const s = ctx.store.get();
  const selectedParts = s.selection.ids.filter((id) => s.scene.nodes[id]);
  const pin = clip.move === 'EXPLODE' ? anim.pinState(s, selectedParts, [clip.id]) : null;
  return [
    { label: t('common.duplicate'), icon: 'duplicate', kbd: kbdText('mod+d'), run: () => anim.duplicateClips(ctx, ids) },
    { label: t('anim.reverse'), run: () => anim.reverseClips(ctx, ids) },
    { label: t('anim.split'), disabled: ids.length > 1 || !anim.canSplitAtPlayhead(ctx, clip.id), run: () => anim.splitAtPlayhead(ctx, clip.id) },
    ...(clip.move === 'EXPLODE'
      ? [{ label: pin?.pinned ? t('ops.unpinExplode') : t('anim.pinSelection'), disabled: !pin, run: () => anim.togglePin(ctx, selectedParts, [clip.id]) }]
      : []),
    null,
    { label: t('common.delete'), icon: 'trash', kbd: kbdText('delete'), run: () => anim.deleteClips(ctx, ids) },
  ];
}

function targetMenu(ctx: Ctx, row: Extract<TimelineRow, { kind: 'TARGET' }>): MenuItems {
  const name = clipTargetName(ctx.store.get(), row.target, getLang());
  return [
    { label: t('anim.animateThis', { name }), icon: 'plus', run: () => anim.openWizard(ctx, row.target) },
    { label: t('anim.selectTarget', { name }), disabled: row.clips.length === 0 && row.target.kind === 'CAMERA', run: () => anim.selectTargetRow(ctx, row.target) },
    { label: row.folded ? t('common.expand') : t('common.collapse'), disabled: row.clips.length === 0, run: () => toggleFold(ctx, row.key) },
    null,
    { label: t('anim.deleteTarget'), icon: 'trash', disabled: row.clips.length === 0, run: () => anim.deleteClips(ctx, row.clips) },
  ];
}

function toggleFold(ctx: Ctx, key: string): void {
  const f = { ...ctx.ui.get().animFolded };
  if (f[key]) delete f[key];
  else f[key] = true;
  ctx.ui.set({ animFolded: f });
}

/** Click on a clip (row or bar): select it; Ctrl / ⌘ adds or takes it out; Shift adds it. */
export function clickClip(ctx: Ctx, id: string, e: MouseEvent | PointerEvent): void {
  if (e.ctrlKey || e.metaKey) anim.toggleClip(ctx, id);
  else if (e.shiftKey) anim.selectClips(ctx, [...anim.selectedClipIds(ctx), id], id);
  else anim.selectClips(ctx, [id]);
}

/** The tree cell of a row. */
export function treeCell(ctx: Ctx, row: TimelineRow, info: RowInfo): HTMLElement {
  const s = ctx.store.get();
  const lang = getLang();
  if (row.kind === 'TARGET') {
    const name = clipTargetName(s, row.target, lang);
    const selected = row.clips.length > 0 && row.clips.every((id) => info.selected.has(id));
    const related = row.clips.some((id) => info.related.has(id));
    const el = h(
      'div',
      {
        class: `atr atr-target${selected ? ' is-selected' : ''}${related ? ' is-related' : ''}`,
        role: 'treeitem',
        'aria-level': 1,
        'aria-expanded': row.clips.length > 0 ? String(!row.folded) : undefined,
        'data-target': row.key,
      },
      row.clips.length > 0
        ? h('button', { type: 'button', class: 'tree-twisty', 'aria-label': row.folded ? t('common.expand') : t('common.collapse'), onclick: (e: MouseEvent) => (e.stopPropagation(), toggleFold(ctx, row.key)) }, icon(row.folded ? 'chevronRight' : 'chevronDown', 12))
        : h('span', { class: 'tree-twisty' }),
      h('span', { class: 'tree-kind' }, icon(targetIcon(ctx, row.target), 14)),
      h('span', { class: 'atr-name' }, name),
      row.clips.length > 0 ? h('span', { class: 'aux atr-count' }, String(row.clips.length)) : null,
      h(
        'button',
        { type: 'button', class: 'icon-btn sm atr-add', 'aria-label': t('anim.animateThis', { name }), 'data-tip': t('anim.animateThis', { name }), onclick: (e: MouseEvent) => (e.stopPropagation(), anim.openWizard(ctx, row.target)) },
        icon('plus', 12),
      ),
    );
    el.addEventListener('click', () => anim.selectTargetRow(ctx, row.target));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu(el, targetMenu(ctx, row));
    });
    return el;
  }
  const clip = s.animation.clips.find((c) => c.id === row.clip);
  if (!clip) return h('div', { class: 'atr' });
  const el = h(
    'div',
    {
      class: `atr atr-clip${info.selected.has(clip.id) ? ' is-selected' : ''}${info.primary === clip.id ? ' is-primary' : ''}${info.related.has(clip.id) ? ' is-related' : ''}`,
      role: 'treeitem',
      'aria-level': 2,
      'aria-selected': String(info.selected.has(clip.id)),
      'data-clip': clip.id,
      'data-tip': clipSentence(s, clip, lang) + (info.conflicts.has(clip.id) ? ` · ${t('anim.conflict')}` : ''),
    },
    h('span', { class: 'atr-indent' }),
    h('span', { class: 'tree-kind' }, icon(clipIcon(clip.move), 14)),
    h('span', { class: 'atr-text' }, clipShort(clip, lang)),
    info.conflicts.has(clip.id) ? h('span', { class: 'atr-flag', 'aria-label': t('anim.conflict') }, icon('dot', 10)) : null,
  );
  el.addEventListener('click', (e) => clickClip(ctx, clip.id, e));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!info.selected.has(clip.id)) anim.selectClips(ctx, [clip.id]);
    openMenu(el, clipMenu(ctx, clip));
  });
  return el;
}
