// Pieces of the interface shared by the *Mine* tabs of the catalogues (U4): the inline name field of the
// "Save … as" commands, cards and rows with rename and delete on hover, and the Export / Import footer.
// No modals: the name field and the delete confirmation appear in place (UI.md §4.3).

import { NAME_MAX, cleanName, libraryIsEmpty, type LibraryItem } from '../../core/library';
import * as cmd from '../commands';
import { h, icon } from '../dom';
import type { IconName } from '../icons';
import type { Ctx, Scope } from '../reactive';
import { t } from '../strings';
import { setThumbImage, showConfirmIn, thumb } from './widgets';

/**
 * An inline field in `host` asking for a name, with Save and Cancel. Enter saves, Esc cancels, an empty name
 * does not save. The host is emptied when it is done.
 */
export function namePrompt(host: HTMLElement, p: { label: string; initial: string; onSave(name: string): void }): void {
  const input = h('input', { type: 'text', class: 'text-input', value: p.initial, maxlength: NAME_MAX, placeholder: t('library.name'), 'aria-label': p.label, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const save = h('button', { type: 'button', class: 'btn btn-primary' }, t('library.save')) as HTMLButtonElement;
  const cancel = h('button', { type: 'button', class: 'btn' }, t('common.cancel'));
  const close = () => host.replaceChildren();
  const commit = () => {
    const name = cleanName(input.value);
    if (!name) return;
    close();
    p.onSave(name);
  };
  const sync = () => (save.disabled = cleanName(input.value) === '');
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  save.addEventListener('click', commit);
  cancel.addEventListener('click', close);
  host.replaceChildren(
    h('div', { class: 'confirm name-prompt', role: 'group', 'aria-label': p.label }, h('div', { class: 'confirm-msg' }, p.label), input, h('div', { class: 'confirm-actions' }, save, cancel)),
  );
  sync();
  input.focus();
  input.select();
}

/** Asks (in `host`) whether to delete an item, and does it on Yes. */
export function confirmDelete(ctx: Ctx, host: HTMLElement, item: LibraryItem): void {
  showConfirmIn(host, {
    message: t('library.deleteConfirm', { name: item.name }),
    options: [{ label: t('common.delete'), primary: true, run: () => cmd.deleteLibraryItem(ctx, item.kind, item.id) }],
    cancelLabel: t('common.cancel'),
  });
}

/** An inline rename: an input over `anchor` that commits on Enter or blur and cancels on Esc. */
function renameInline(ctx: Ctx, anchor: HTMLElement, item: LibraryItem, className: string): void {
  if (anchor.querySelector(`.${className}`)) return;
  const input = h('input', { type: 'text', class: `text-input ${className}`, value: item.name, maxlength: NAME_MAX, 'aria-label': t('library.rename', { name: item.name }) }) as HTMLInputElement;
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    const name = cleanName(input.value);
    input.remove();
    if (ok && name && name !== item.name) cmd.renameLibraryItem(ctx, item.kind, item.id, name);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  anchor.appendChild(input);
  input.focus();
  input.select();
}

function actionButton(name: IconName, label: string, run: () => void): HTMLElement {
  return h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': label, 'data-tip': label, onclick: (e: MouseEvent) => {
    e.stopPropagation();
    run();
  } }, icon(name, 14));
}

/** What a card or a row needs to know about an item of the library. */
export interface MineSpec<I extends LibraryItem> {
  active(item: I): boolean;
  /** Clicking the item. A confirmation it returns is shown where `confirm` points. */
  choose(item: I): ReturnType<typeof cmd.requestSetup> | void;
  title(item: I): string;
  /** Payload when the card can be dragged onto a part. */
  drag?(item: I): string;
  /** The picture of an item that has none of its own (a material sphere rendered by the viewport). */
  fallback?(item: I, set: (url: string) => void): void;
  /** The generic icon an item without a picture shows. */
  icon: IconName;
}

/** The thumbnail of an item: its picture, or a generic monochrome icon until its sphere is rendered. */
function placeholder(el: HTMLElement, name: IconName): void {
  el.querySelector('.thumb-ph')?.classList.add('thumb-icon');
  el.querySelector('.thumb-ph')?.appendChild(icon(name, 24));
}

/** Cards for a grid (`thumbs` container): picture, name, and on hover Rename and Delete. */
export function mineCards<I extends LibraryItem>(ctx: Ctx, items: readonly I[], spec: MineSpec<I>, confirm: HTMLElement, sphere = false): HTMLElement[] {
  return items.map((item) => {
    const el = thumb({
      src: item.thumb ?? null,
      sphere,
      caption: item.name,
      active: spec.active(item),
      title: spec.title(item),
      drag: spec.drag?.(item),
      onClick: () => {
        const c = spec.choose(item);
        if (c) showConfirmIn(confirm, c);
      },
    });
    if (!item.thumb) {
      placeholder(el, spec.icon);
      spec.fallback?.(item, (url) => setThumbImage(el, url));
    }
    const card = h(
      'div',
      { class: 'mine-card', 'data-item': item.id },
      el,
      h('div', { class: 'mine-actions' }, actionButton('edit', t('library.rename', { name: item.name }), () => renameInline(ctx, card, item, 'mine-rename')), actionButton('trash', t('library.delete', { name: item.name }), () => confirmDelete(ctx, confirm, item))),
    );
    return card;
  });
}

/** Rows for a list (the Studios tab, the own product types): picture, name, a line under it, Rename and Delete. */
export function mineRows<I extends LibraryItem>(ctx: Ctx, items: readonly I[], spec: MineSpec<I> & { aux(item: I): string }, confirm: HTMLElement): HTMLElement[] {
  return items.map((item) => {
    const pic = item.thumb ? h('img', { class: 'mine-pic', src: item.thumb, alt: '', draggable: false }) : h('span', { class: 'mine-pic mine-pic-icon' }, icon(spec.icon, 16));
    const name = h('div', { class: 'mine-name' }, item.name);
    const main = h('button', { type: 'button', class: 'mine-main', 'data-tip': spec.title(item), 'aria-pressed': String(spec.active(item)) }, pic, h('span', { class: 'list-main' }, name, h('div', { class: 'aux' }, spec.aux(item))));
    main.addEventListener('click', () => {
      const c = spec.choose(item);
      if (c) showConfirmIn(confirm, c);
    });
    const row = h(
      'div',
      { class: `list-row mine-row${spec.active(item) ? ' is-selected' : ''}`, 'data-item': item.id },
      main,
      h('div', { class: 'mine-actions-row' }, actionButton('edit', t('library.rename', { name: item.name }), () => renameInline(ctx, row, item, 'mine-rename-row')), actionButton('trash', t('library.delete', { name: item.name }), () => confirmDelete(ctx, confirm, item))),
    );
    return row;
  });
}

/** "Nothing saved yet. Save… from the inspector." */
export function mineEmpty(text = t('catalog.mineEmpty')): HTMLElement {
  return h('p', { class: 'note mine-empty', style: 'grid-column:1/-1;margin:0' }, text);
}

/** Export library / Import library, at the foot of every Mine view. */
export function libraryFoot(ctx: Ctx, scope: Scope): HTMLElement {
  const exp = h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => cmd.exportLibraryFile(ctx) }, icon('download', 14), t('library.export')) as HTMLButtonElement;
  const imp = h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => void cmd.importLibraryDialog(ctx) }, icon('upload', 14), t('library.import')) as HTMLButtonElement;
  scope.watch((_s, u) => libraryIsEmpty(u.library), (empty) => (exp.disabled = empty));
  return h('div', { class: 'row library-foot' }, exp, imp);
}
