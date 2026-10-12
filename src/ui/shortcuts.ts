// The one map of application actions and their shortcuts (ARCHITECTURE §6):
// it drives the keyboard, the command palette and the tooltips.

import type { SelectionLevel } from '../core/scene';
import * as cmd from './commands';
import type { ConfirmSpec } from './components/widgets';
import type { Ctx } from './reactive';
import { t, type StringKey } from './strings';
import type { Tool } from './ui-state';

export interface AppAction {
  id: string;
  label: StringKey;
  /** Shortcut spec: 'mod+k', 'shift+h', 'f', 'mod+enter'... */
  keys?: string;
  altKeys?: readonly string[];
  /** Listed in the command palette (default true). */
  palette?: boolean;
  /** Fires even while typing in a text field. */
  global?: boolean;
  run(ctx: Ctx): void | ConfirmSpec | null | Promise<void>;
}

const setTool = (tool: Tool) => (ctx: Ctx) => {
  ctx.ui.set({ tool });
  ctx.services.viewport?.setTool(tool);
};
const level = (l: SelectionLevel) => (ctx: Ctx) => cmd.setLevel(ctx, l);

export const ACTIONS: readonly AppAction[] = [
  { id: 'palette', label: 'action.palette', keys: 'mod+k', palette: false, global: true, run: (ctx) => ctx.ui.set({ paletteOpen: true }) },
  { id: 'undo', label: 'action.undo', keys: 'mod+z', run: (ctx) => ctx.store.undo() },
  { id: 'redo', label: 'action.redo', keys: 'mod+shift+z', altKeys: ['mod+y'], run: (ctx) => ctx.store.redo() },
  { id: 'import', label: 'action.import', keys: 'mod+i', global: true, run: (ctx) => cmd.importDialog(ctx) },
  { id: 'save', label: 'action.save', keys: 'mod+s', global: true, run: (ctx) => cmd.saveProject(ctx) },
  { id: 'render', label: 'action.render', keys: 'mod+enter', global: true, run: (ctx) => cmd.render(ctx) },
  { id: 'frame', label: 'action.frame', keys: 'f', run: (ctx) => cmd.frameSelection(ctx) },
  { id: 'tool.select', label: 'tool.select', keys: 'v', run: setTool('select') },
  { id: 'tool.orbit', label: 'tool.orbit', keys: 'o', run: setTool('orbit') },
  { id: 'tool.pan', label: 'tool.pan', keys: 'p', run: setTool('pan') },
  { id: 'tool.zoom', label: 'tool.zoom', keys: 'z', run: setTool('zoom') },
  { id: 'hide', label: 'action.hide', keys: 'h', run: (ctx) => cmd.hideSelection(ctx) },
  { id: 'isolate', label: 'action.isolate', keys: 'shift+h', run: (ctx) => cmd.isolateSelection(ctx) },
  { id: 'showAll', label: 'action.showAll', keys: 'alt+h', run: (ctx) => cmd.showAll(ctx) },
  { id: 'level.MODEL', label: 'action.levelModel', keys: '1', run: level('MODEL') },
  { id: 'level.GROUP', label: 'action.levelGroup', keys: '2', run: level('GROUP') },
  { id: 'level.PART', label: 'action.levelPart', keys: '3', run: level('PART') },
  { id: 'level.FACES', label: 'action.levelFaces', keys: '4', run: level('FACES') },
  { id: 'panels', label: 'action.panels', keys: 'tab', run: (ctx) => cmd.togglePanels(ctx) },
  { id: 'deselect', label: 'action.deselect', keys: 'escape', palette: false, run: (ctx) => cmd.deselect(ctx) },
  { id: 'delete', label: 'action.delete', keys: 'delete', altKeys: ['backspace'], run: (ctx) => cmd.deleteSelection(ctx) },
  // Palette only.
  { id: 'example', label: 'action.example', run: (ctx) => cmd.loadExample(ctx) },
  { id: 'createStudio', label: 'action.createStudio', run: (ctx) => cmd.requestBuildStudio(ctx) },
  { id: 'rest', label: 'action.rest', run: (ctx) => cmd.restOnFloor(ctx) },
  { id: 'center', label: 'action.center', run: (ctx) => cmd.centerSelection(ctx) },
  { id: 'selectAll', label: 'action.selectAll', run: (ctx) => cmd.selectAllModel(ctx) },
  { id: 'queue', label: 'action.queue', run: (ctx) => cmd.enqueue(ctx) },
  { id: 'newCamera', label: 'action.newCamera', run: (ctx) => cmd.newCamera(ctx) },
  { id: 'saveStudio', label: 'action.saveStudio', run: (ctx) => cmd.saveStudio(ctx) },
  { id: 'exportImage', label: 'action.exportImage', run: (ctx) => cmd.exportViewport(ctx) },
  { id: 'animation', label: 'action.animation', run: (ctx) => ctx.ui.set({ drawer: 'animation' }) },
  { id: 'doctor', label: 'action.doctor', run: (ctx) => ctx.ui.set({ doctorOpen: true }) },
  { id: 'fixAll', label: 'action.fixAll', run: (ctx) => cmd.doctorFixAll(ctx) },
  { id: 'guide', label: 'action.guide', run: (ctx) => cmd.openGuide(ctx) },
  { id: 'themeDark', label: 'action.themeDark', run: (ctx) => cmd.setTheme(ctx, 'dark') },
  { id: 'themeLight', label: 'action.themeLight', run: (ctx) => cmd.setTheme(ctx, 'light') },
  { id: 'langEn', label: 'action.langEn', run: (ctx) => cmd.setLanguage(ctx, 'en') },
  { id: 'langEs', label: 'action.langEs', run: (ctx) => cmd.setLanguage(ctx, 'es') },
];

export function actionById(id: string): AppAction | undefined {
  return ACTIONS.find((a) => a.id === id);
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface Parsed {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(spec: string): Parsed {
  const parts = spec.toLowerCase().split('+');
  return { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt'), key: parts[parts.length - 1] };
}

/** Whether a keyboard event matches a shortcut spec. */
export function matches(e: KeyboardEvent, spec: string): boolean {
  const p = parse(spec);
  const mod = e.ctrlKey || e.metaKey;
  if (p.mod !== mod || p.shift !== e.shiftKey || p.alt !== e.altKey) return false;
  const k = p.key;
  if (k.length === 1 && /[a-z]/.test(k)) return e.code === `Key${k.toUpperCase()}` || e.key.toLowerCase() === k;
  if (k.length === 1 && /[0-9]/.test(k)) return e.code === `Digit${k}` || e.key === k;
  const names: Record<string, string> = { enter: 'Enter', tab: 'Tab', escape: 'Escape', delete: 'Delete', backspace: 'Backspace' };
  return e.key === (names[k] ?? k);
}

/** A shortcut as the user reads it ("Ctrl K", "⌘ ⇧ Z", "Alt H"). */
export function kbdText(spec: string | undefined): string {
  if (!spec) return '';
  const p = parse(spec);
  const out: string[] = [];
  if (p.mod) out.push(isMac ? '⌘' : 'Ctrl');
  if (p.alt) out.push(isMac ? '⌥' : 'Alt');
  if (p.shift) out.push('⇧');
  const names: Record<string, string> = { enter: '⏎', tab: t('key.tab'), escape: t('key.escape'), delete: t('key.delete'), backspace: '⌫' };
  out.push(names[p.key] ?? p.key.toUpperCase());
  return out.join(' ');
}

/** The shortcut text of an action, for tooltips. */
export function kbdFor(id: string): string {
  return kbdText(actionById(id)?.keys);
}
