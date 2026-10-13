// The import sheet (UI.md §2.3, SPEC §5): when a file is dropped or chosen the
// inspector shows this in line (nothing modal) instead of importing at once.
// It is titled with the file name and format, starts with the values the
// reader detected, and imports with Enter or the primary button; Esc and
// Cancel forget the file. The options live in the interface state
// (`importSheet.options`) so a language switch does not lose them; the model
// only changes when Import is pressed (commands.confirmImport).
//
// STEP and IGES (phase I2) open the sheet at once: a status line says where
// the read is (the reader downloading, reading, building parts, or why it
// failed) and the tessellation quality is live: changing it reads the file
// again, and the sheet is rebuilt with the new counts when it arrives.

import { ANGLE_DEG_RANGE, CHORD_PERCENT_RANGE, describePayload, IMPORT_UNITS, type ImportOptions } from '../../core/import-options';
import * as cmd from '../commands';
import { field, numberField, segmented, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, isTyping } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { formatNumber, getLang, t } from '../strings';
import type { CadReadState } from '../ui-state';

/** The status line of a CAD read, in the interface language (numbers from the bytes the worker counted). */
export function cadStatusText(name: string, cad: CadReadState): string {
  const mb = (bytes: number) => formatNumber(bytes / 1e6, getLang(), 1);
  let text: string;
  switch (cad.stage) {
    case 'download':
      text = cad.total ? t('import.cad.download', { loaded: mb(cad.loaded ?? 0), total: mb(cad.total) }) : t('import.cad.downloadSize', { loaded: mb(cad.loaded ?? 0) });
      break;
    case 'start':
      text = t('import.cad.start');
      break;
    case 'read':
      text = t('import.cad.read', { name });
      break;
    case 'convert':
      text = t('import.cad.convert');
      break;
    case 'error':
      return t('import.cad.failed', { name, reason: cad.error ?? '' });
    default:
      return '';
  }
  return cad.confirm ? `${text} · ${t('import.cad.whenRead')}` : text;
}

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
  const cad = sheet.cad !== undefined;
  /** The file has been read (always, except a CAD file the first time). */
  const read = !cad || (sheet.rev ?? 0) > 0;

  // Title, format and what is in the file; for CAD, where the read is.
  const queued = h('div', { class: 'note' });
  const status = h('div', { class: 'note import-status', role: 'status', 'aria-live': 'polite', 'data-import-status': '' });
  const head = h(
    'div',
    { class: 'import-head' },
    h('div', { class: 'import-title-row' }, h('div', { class: 'import-title', title: sheet.name }, sheet.name), h('span', { class: 'import-format' }, sheet.format)),
    read ? h('div', { class: 'note tabular', 'data-import-summary': '' }, t('import.sheet.summary', { parts: num(counts.parts), groups: num(counts.groups), triangles: num(counts.triangles), materials: num(counts.materials) })) : null,
    cad ? status : null,
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
  const unitsAux = detected.units ? t('import.aux.fromFile') : sheet.cad && (sheet.rev ?? 0) === 0 ? t('import.aux.fromFileWhenRead') : detected.size > 0 && detected.size < 1 ? t('import.aux.guessed') : t('import.aux.undeclared');
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
  // By CAD face needs the faces STEP and IGES keep; other formats have none.
  const separate = segmented(
    [
      { value: 'none' as const, label: t('import.separate.none') },
      { value: 'material' as const, label: t('import.separate.material') },
      { value: 'face' as const, label: t('import.separate.face'), disabled: !cad, title: cad ? undefined : t('import.aux.cadSoon') },
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
    aux(cad ? (read ? t('import.aux.cadFaces', { n: num(Object.values(sheet.payload.nodes).reduce((a, n) => a + (n.faceRanges?.length ?? 0), 0)) }) : t('import.aux.cadFacesSoon')) : `${t('import.separate.face')}: ${t('import.aux.cadSoon')}`),
  );

  // Mesh: the tessellation is live for STEP and IGES (presets and the two values behind them), off for the rest.
  const tessellation = segmented(
    [
      { value: 'LOW' as const, label: t('import.tessellation.low'), disabled: !cad },
      { value: 'MEDIUM' as const, label: t('import.tessellation.medium'), disabled: !cad },
      { value: 'HIGH' as const, label: t('import.tessellation.high'), disabled: !cad },
    ],
    o.tessellation === 'CUSTOM' ? null : o.tessellation,
    (v) => set({ tessellation: v }),
    { full: true, ariaLabel: t('import.tessellation') },
  );
  const chord = numberField({
    value: o.chordPercent,
    min: CHORD_PERCENT_RANGE[0],
    max: CHORD_PERCENT_RANGE[1],
    step: 0.01,
    digits: 3,
    unit: '%',
    ariaLabel: t('import.tessellation.chord'),
    onChange: (v) => set({ chordPercent: v }),
  });
  const angle = numberField({
    value: o.angleDeg,
    min: ANGLE_DEG_RANGE[0],
    max: ANGLE_DEG_RANGE[1],
    step: 1,
    digits: 0,
    unit: '°',
    ariaLabel: t('import.tessellation.angle'),
    onChange: (v) => set({ angleDeg: v }),
  });
  const hidden = toggle(o.importHidden, (v) => set({ importHidden: v }), t('import.hidden'), detected.hiddenParts === 0);
  const flip = toggle(o.flipNormals, (v) => set({ flipNormals: v }), t('import.flip'));
  const mesh = h(
    'div',
    { class: 'stack' },
    field(t('import.tessellation'), tessellation.el),
    ...(cad
      ? [field(t('import.tessellation.chord'), chord.el), field(t('import.tessellation.angle'), angle.el), aux(t('import.aux.tessellation'))]
      : [aux(t('import.aux.cadOnly'))]),
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
      tessellation.set(opts.tessellation === 'CUSTOM' ? null : opts.tessellation);
      chord.set(opts.chordPercent);
      angle.set(opts.angleDeg);
      hidden.set(opts.importHidden);
      flip.set(opts.flipNormals);
    },
  );
  scope.watch(
    (_s, u) => u.importSheet?.queued ?? 0,
    (n) => (queued.textContent = n > 0 ? t('import.sheet.queued', { n: num(n) }) : ''),
  );
  const confirmBtn = actions.querySelector<HTMLButtonElement>('[data-import="confirm"]')!;
  scope.watch(
    (_s, u) => u.importSheet?.cad,
    (state) => {
      status.textContent = state ? cadStatusText(sheet.name, state) : '';
      status.dataset.stage = state?.stage ?? '';
      // Nothing to import from a CAD file that failed: Cancel, or another quality, is what is left.
      confirmBtn.disabled = state?.stage === 'error';
    },
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
