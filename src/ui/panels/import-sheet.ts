// The import sheet (UI.md §2.3, SPEC §5): when a file is dropped or chosen the
// inspector shows this in line (nothing modal) instead of importing at once.
// It is titled with the file name and format, starts with the values the
// reader detected, and imports with Enter or the primary button; Esc and
// Cancel forget the file. The options live in the interface state
// (`importSheet.options`) so a language switch does not lose them; the model
// only changes when Import is pressed (commands.confirmImport).

import { describePayload, IMPORT_UNITS, type ImportOptions } from '../../core/import-options';
import * as cmd from '../commands';
import { field, segmented, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, isTyping } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { formatNumber, getLang, t } from '../strings';

/** A field whose control has the whole row: the label above it (long button labels). */
const wide = (label: string, ...controls: Node[]): HTMLElement => {
  const el = field(label, ...controls);
  el.classList.add('wide');
  return el;
};

/** A hint under a control, lined up with the controls. */
const aux = (text: string): HTMLElement => h('div', { class: 'note import-aux' }, text);

/** Pressing Enter anywhere imports, Esc cancels, unless a text field or another overlay owns the key. */
function installKeys(ctx: Ctx, scope: Scope): void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return;
    const u = ctx.ui.get();
    if (!u.importSheet || u.paletteOpen || u.menuOpen || u.shortcutsOpen || u.pickMode || u.renderWindow || u.resultView) return;
    if (e.key === 'Escape' && !isTyping(e)) {
      e.preventDefault();
      e.stopPropagation();
      cmd.cancelImport(ctx);
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !isTyping(e)) {
      e.preventDefault();
      e.stopPropagation();
      cmd.confirmImport(ctx);
    }
  };
  // Capture phase: the sheet is modal for the keyboard, so Esc does not also deselect and Enter does not press the focused button.
  document.addEventListener('keydown', onKey, true);
  scope.onDispose(() => document.removeEventListener('keydown', onKey, true));
}

export function importSheet(ctx: Ctx, scope: Scope): HTMLElement {
  const sheet = ctx.ui.get().importSheet!;
  const { detected } = sheet.payload;
  const o = sheet.options;
  const set = (patch: Partial<ImportOptions>): void => cmd.setImportOptions(ctx, patch);
  const counts = describePayload(sheet.payload);
  const num = (n: number) => formatNumber(n, getLang(), 0);

  // Title, format and what is in the file.
  const queued = h('div', { class: 'note' });
  const head = h(
    'div',
    { class: 'import-head' },
    h('div', { class: 'import-title-row' }, h('div', { class: 'import-title', title: sheet.name }, sheet.name), h('span', { class: 'import-format' }, sheet.format)),
    h('div', { class: 'note tabular' }, t('import.sheet.summary', { parts: num(counts.parts), groups: num(counts.groups), triangles: num(counts.triangles), materials: num(counts.materials) })),
    ...[...sheet.warnings, ...sheet.notes].map((m) => h('div', { class: 'note import-note' }, cmd.importMessageText(sheet.name, m))),
    queued,
  );

  // Placement.
  const units = segmented(
    IMPORT_UNITS.map((u) => ({ value: u, label: t(dyn(`import.unit.${u}`)) })),
    o.units,
    (v) => set({ units: v }),
    { full: true, ariaLabel: t('import.units') },
  );
  const unitsAux = detected.units ? t('import.aux.fromFile') : detected.size > 0 && detected.size < 1 ? t('import.aux.guessed') : t('import.aux.undeclared');
  const upAxis = segmented(
    [
      { value: 'Y' as const, label: 'Y' },
      { value: 'Z' as const, label: 'Z' },
    ],
    o.upAxis,
    (v) => set({ upAxis: v }),
    { full: true, ariaLabel: t('import.upAxis') },
  );
  const center = toggle(o.center, (v) => set({ center: v }), t('import.center'));
  const rest = toggle(o.restOnFloor, (v) => set({ restOnFloor: v }), t('import.rest'));
  const frame = toggle(o.frameCamera, (v) => set({ frameCamera: v }), t('import.frame'));
  const mode = segmented(
    [
      { value: 'add' as const, label: t('import.scene.add') },
      { value: 'replace' as const, label: t('import.scene.replace') },
    ],
    o.mode,
    (v) => set({ mode: v }),
    { full: true, ariaLabel: t('import.scene') },
  );
  const placement = h(
    'div',
    { class: 'stack' },
    field(t('import.units'), units.el),
    aux(unitsAux),
    field(t('import.upAxis'), upAxis.el),
    aux(detected.upAxisDeclared ? t('import.aux.fromFile') : t('import.aux.byFormat')),
    field(t('import.center'), center.el),
    field(t('import.rest'), rest.el),
    field(t('import.frame'), frame.el),
    wide(t('import.scene'), mode.el),
  );

  // Parts and materials.
  const groupBy = segmented(
    [
      { value: 'object' as const, label: t('import.group.object') },
      { value: 'material' as const, label: t('import.group.material') },
      { value: 'layer' as const, label: t('import.group.layer'), disabled: !detected.hasLayers, title: detected.hasLayers ? undefined : t('import.aux.noLayers') },
    ],
    o.groupBy,
    (v) => set({ groupBy: v }),
    { full: true, ariaLabel: t('import.groupBy') },
  );
  const materials = segmented(
    [
      { value: 'keep' as const, label: t('import.materials.keep') },
      { value: 'default' as const, label: t('import.materials.default') },
    ],
    o.materials,
    (v) => set({ materials: v }),
    { full: true, ariaLabel: t('import.materials') },
  );
  const separate = segmented(
    [
      { value: 'none' as const, label: t('import.separate.none') },
      { value: 'material' as const, label: t('import.separate.material') },
      { value: 'face' as const, label: t('import.separate.face'), disabled: true, title: t('common.comingSoon') },
    ],
    o.separate,
    (v) => set({ separate: v }),
    { full: true, ariaLabel: t('import.separate') },
  );
  const content = h(
    'div',
    { class: 'stack' },
    field(t('import.groupBy'), groupBy.el),
    ...(detected.hasLayers ? [] : [aux(t('import.aux.noLayers'))]),
    wide(t('import.materials'), materials.el),
    wide(t('import.separate'), separate.el),
    aux(`${t('import.separate.face')}: ${t('import.aux.cadSoon')} · ${t('common.comingSoon')}`),
  );

  // Mesh.
  const tessellation = segmented(
    [
      { value: 'LOW' as const, label: t('import.tessellation.low'), disabled: true },
      { value: 'MEDIUM' as const, label: t('import.tessellation.medium'), disabled: true },
      { value: 'HIGH' as const, label: t('import.tessellation.high'), disabled: true },
    ],
    o.tessellation,
    (v) => set({ tessellation: v }),
    { full: true, ariaLabel: t('import.tessellation') },
  );
  const hidden = toggle(o.importHidden, (v) => set({ importHidden: v }), t('import.hidden'), detected.hiddenParts === 0);
  const flip = toggle(o.flipNormals, (v) => set({ flipNormals: v }), t('import.flip'));
  const mesh = h(
    'div',
    { class: 'stack' },
    field(t('import.tessellation'), tessellation.el),
    aux(`${t('import.aux.cadOnly')} · ${t('common.comingSoon')}`),
    field(t('import.hidden'), hidden.el),
    aux(detected.hiddenParts > 0 ? t('import.aux.hidden', { n: num(detected.hiddenParts) }) : t('import.aux.noHidden')),
    field(t('import.flip'), flip.el),
  );

  const actions = h(
    'div',
    { class: 'import-actions' },
    h('button', { type: 'button', class: 'btn btn-primary', 'data-import': 'confirm', onclick: () => cmd.confirmImport(ctx) }, t('import.confirm')),
    h('button', { type: 'button', class: 'btn', 'data-import': 'cancel', onclick: () => cmd.cancelImport(ctx) }, t('common.cancel')),
    h('span', { class: 'note import-keys' }, t('import.keys')),
  );

  // Keep the controls in step with the options (a language switch rebuilds them from the same values).
  scope.watch(
    (_s, u) => u.importSheet?.options,
    (opts) => {
      if (!opts) return;
      units.set(opts.units);
      upAxis.set(opts.upAxis);
      center.set(opts.center);
      rest.set(opts.restOnFloor);
      frame.set(opts.frameCamera);
      mode.set(opts.mode);
      groupBy.set(opts.groupBy);
      materials.set(opts.materials);
      separate.set(opts.separate);
      tessellation.set(opts.tessellation);
      hidden.set(opts.importHidden);
      flip.set(opts.flipNormals);
    },
  );
  scope.watch(
    (_s, u) => u.importSheet?.queued ?? 0,
    (n) => (queued.textContent = n > 0 ? t('import.sheet.queued', { n: num(n) }) : ''),
  );
  installKeys(ctx, scope);

  return h(
    'div',
    { class: 'import-sheet', 'data-import-sheet': String(sheet.id), role: 'form', 'aria-label': sheet.name },
    head,
    section(ctx, 'import.placement', t('import.sheet.placement'), placement),
    section(ctx, 'import.content', t('import.sheet.content'), content),
    section(ctx, 'import.mesh', t('import.sheet.mesh'), mesh),
    actions,
  );
}
