// The one map of application actions and their shortcuts (ARCHITECTURE §6):
// it drives the keyboard, the command palette and the tooltips.

import type { SelectionLevel } from '../core/scene';
import { PRIMITIVE_KINDS } from '../data/primitives';
import { NEW_LIGHT_KINDS } from '../core/lighting';
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

const setTool = (tool: Tool) => (ctx: Ctx) => cmd.setTool(ctx, tool);
const level = (l: SelectionLevel) => (ctx: Ctx) => cmd.setLevel(ctx, l);

export const ACTIONS: readonly AppAction[] = [
  { id: 'palette', label: 'action.palette', keys: 'mod+k', palette: false, global: true, run: (ctx) => ctx.ui.set({ paletteOpen: true }) },
  { id: 'undo', label: 'action.undo', keys: 'mod+z', run: (ctx) => ctx.store.undo() },
  { id: 'redo', label: 'action.redo', keys: 'mod+shift+z', altKeys: ['mod+y'], run: (ctx) => ctx.store.redo() },
  { id: 'import', label: 'action.import', keys: 'mod+i', global: true, run: (ctx) => cmd.importDialog(ctx) },
  { id: 'open', label: 'action.open', keys: 'mod+o', global: true, run: (ctx) => void cmd.openProject(ctx) },
  { id: 'save', label: 'action.save', keys: 'mod+s', global: true, run: (ctx) => void cmd.saveProject(ctx) },
  { id: 'saveAs', label: 'action.saveAs', keys: 'mod+shift+s', global: true, run: (ctx) => void cmd.saveProject(ctx, { saveAs: true }) },
  { id: 'render', label: 'action.render', keys: 'mod+enter', global: true, run: (ctx) => cmd.openRenderWindow(ctx) },
  { id: 'renderNow', label: 'action.renderNow', keys: 'mod+shift+enter', global: true, run: (ctx) => cmd.renderNow(ctx) },
  { id: 'viewportMode', label: 'action.viewportMode', keys: 'mod+shift+r', global: true, run: (ctx) => cmd.toggleViewportMode(ctx) },
  { id: 'settings', label: 'action.settings', keys: 'mod+,', global: true, run: (ctx) => (ctx.ui.get().settingsWindow ? cmd.closeSettings(ctx) : cmd.openSettings(ctx)) },
  { id: 'frame', label: 'action.frame', keys: 'f', run: (ctx) => cmd.frameSelection(ctx) },
  { id: 'tool.select', label: 'tool.select', keys: 'v', run: setTool('select') },
  { id: 'tool.orbit', label: 'tool.orbit', keys: 'o', run: setTool('orbit') },
  { id: 'tool.pan', label: 'tool.pan', keys: 'p', run: setTool('pan') },
  { id: 'tool.zoom', label: 'tool.zoom', keys: 'z', run: setTool('zoom') },
  { id: 'tool.move', label: 'action.move', keys: 'm', run: setTool('move') },
  { id: 'tool.scale', label: 'action.scale', keys: 's', run: setTool('scale') },
  { id: 'space.local', label: 'action.spaceLocal', keys: 'l', run: (ctx) => cmd.setSpace(ctx, 'LOCAL') },
  { id: 'space.global', label: 'action.spaceGlobal', keys: 'g', run: (ctx) => cmd.setSpace(ctx, 'GLOBAL') },
  { id: 'duplicate', label: 'action.duplicate', keys: 'mod+d', run: (ctx) => cmd.duplicate(ctx, false) },
  { id: 'duplicateLinked', label: 'action.duplicateLinked', keys: 'mod+shift+d', run: (ctx) => cmd.duplicate(ctx, true) },
  { id: 'group', label: 'action.group', keys: 'mod+g', run: (ctx) => cmd.groupSelection(ctx) },
  { id: 'ungroup', label: 'action.ungroup', keys: 'mod+shift+g', run: (ctx) => cmd.ungroupSelection(ctx) },
  { id: 'copyMaterial', label: 'action.copyMaterial', keys: 'mod+shift+c', run: (ctx) => cmd.copyMaterial(ctx) },
  { id: 'pasteMaterial', label: 'action.pasteMaterial', keys: 'mod+shift+v', run: (ctx) => cmd.pasteMaterial(ctx) },
  { id: 'hide', label: 'action.hide', keys: 'h', run: (ctx) => cmd.hideSelection(ctx) },
  { id: 'isolate', label: 'action.isolate', keys: 'shift+h', run: (ctx) => cmd.isolateSelection(ctx) },
  { id: 'showAll', label: 'action.showAll', keys: 'alt+h', run: (ctx) => cmd.showAll(ctx) },
  { id: 'level.MODEL', label: 'action.levelModel', keys: '1', run: level('MODEL') },
  { id: 'level.GROUP', label: 'action.levelGroup', keys: '2', run: level('GROUP') },
  { id: 'level.PART', label: 'action.levelPart', keys: '3', run: level('PART') },
  { id: 'level.FACES', label: 'action.levelFaces', keys: '4', run: level('FACES') },
  { id: 'panels', label: 'action.panels', keys: 'tab', run: (ctx) => cmd.togglePanels(ctx) },
  // Look through the selected light or camera (L4); Esc comes back first.
  { id: 'lookThrough', label: 'action.lookThrough', keys: 'mod+shift+l', run: (ctx) => cmd.toggleLookThrough(ctx) },
  // Esc leaves Look through first, then the move or the scale tool, then deselects.
  {
    id: 'deselect',
    label: 'action.deselect',
    keys: 'escape',
    palette: false,
    run: (ctx) => (ctx.ui.get().lookThrough ? cmd.exitLookThrough(ctx) : ctx.ui.get().tool === 'move' || ctx.ui.get().tool === 'scale' ? cmd.setTool(ctx, 'select') : cmd.deselect(ctx)),
  },
  { id: 'delete', label: 'action.delete', keys: 'delete', altKeys: ['backspace'], run: (ctx) => cmd.deleteSelection(ctx) },
  // Palette only.
  { id: 'example', label: 'action.example', run: (ctx) => cmd.loadExample(ctx) },
  { id: 'createStudio', label: 'action.createStudio', run: (ctx) => cmd.requestBuildStudio(ctx) },
  { id: 'rest', label: 'action.rest', run: (ctx) => cmd.restOnFloor(ctx) },
  { id: 'center', label: 'action.center', run: (ctx) => cmd.centerSelection(ctx) },
  { id: 'centerRest', label: 'action.centerRest', run: (ctx) => cmd.centerAndRest(ctx) },
  { id: 'reset', label: 'action.reset', run: (ctx) => cmd.resetTransform(ctx) },
  { id: 'cameraTarget', label: 'action.cameraTarget', run: (ctx) => cmd.setCameraTarget(ctx) },
  { id: 'patternLinear', label: 'action.patternLinear', run: (ctx) => cmd.createPattern(ctx, 'LINEAR') },
  { id: 'patternCircular', label: 'action.patternCircular', run: (ctx) => cmd.createPattern(ctx, 'CIRCULAR') },
  { id: 'unlink', label: 'action.unlink', run: (ctx) => cmd.unlinkMaterial(ctx) },
  { id: 'selectByMaterial', label: 'action.selectByMaterial', run: (ctx) => cmd.selectByMaterial(ctx) },
  { id: 'flip', label: 'action.flip', run: (ctx) => cmd.flipNormals(ctx) },
  { id: 'separateMaterial', label: 'action.separateMaterial', run: (ctx) => cmd.separateByMaterial(ctx) },
  { id: 'selectAll', label: 'action.selectAll', run: (ctx) => cmd.selectAllModel(ctx) },
  { id: 'queue', label: 'action.queue', run: (ctx) => cmd.enqueue(ctx) },
  { id: 'openQueue', label: 'action.openQueue', run: (ctx) => cmd.openQueue(ctx) },
  { id: 'openLastResult', label: 'action.openLastResult', run: (ctx) => cmd.openLastResult(ctx) },
  { id: 'newCamera', label: 'action.newCamera', run: (ctx) => cmd.newCamera(ctx) },
  { id: 'saveStudio', label: 'action.saveStudio', run: (ctx) => cmd.saveStudio(ctx) },
  { id: 'exportImage', label: 'action.exportImage', run: (ctx) => cmd.exportViewport(ctx) },
  { id: 'exportScene', label: 'action.exportScene', run: (ctx) => cmd.exportScene(ctx) },
  { id: 'animation', label: 'action.animation', run: (ctx) => ctx.ui.set({ drawer: 'animation' }) },
  { id: 'doctor', label: 'action.doctor', run: (ctx) => ctx.ui.set({ doctorOpen: true }) },
  { id: 'fixAll', label: 'action.fixAll', run: (ctx) => cmd.doctorFixAll(ctx) },
  { id: 'guide', label: 'action.guide', run: (ctx) => cmd.openGuide(ctx) },
  { id: 'themeDark', label: 'action.themeDark', run: (ctx) => cmd.setTheme(ctx, 'dark') },
  { id: 'themeLight', label: 'action.themeLight', run: (ctx) => cmd.setTheme(ctx, 'light') },
  { id: 'langEn', label: 'action.langEn', run: (ctx) => cmd.setLanguage(ctx, 'en') },
  { id: 'langEs', label: 'action.langEs', run: (ctx) => cmd.setLanguage(ctx, 'es') },
  // Add ▸ Primitive (phase U9), one entry per shape of the catalogue.
  ...PRIMITIVE_KINDS.map((k): AppAction => ({ id: `add.${k}`, label: `prim.add.${k}` as StringKey, run: (ctx) => cmd.addPrimitive(ctx, k) })),
  { id: 'convertMesh', label: 'primitive.convert', run: (ctx) => cmd.convertToMesh(ctx) },
  // Add light ▸ (phase L4), one entry per kind, and the Lights and cameras button of the view bar.
  ...NEW_LIGHT_KINDS.map((k): AppAction => ({ id: `addLight.${k}`, label: `lights.addAction.${k}` as StringKey, run: (ctx) => cmd.addLight(ctx, k) })),
  { id: 'glyphs', label: 'action.glyphs', run: (ctx) => cmd.toggleGlyphs(ctx) },
];

/** Where Settings ▸ Keyboard shortcuts lists an action. */
export type ShortcutGroup = 'general' | 'view' | 'selection' | 'edit';
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['general', 'view', 'selection', 'edit'];

export function shortcutGroup(id: string): ShortcutGroup {
  if (id.startsWith('level.') || ['hide', 'isolate', 'showAll', 'deselect', 'delete', 'selectAll'].includes(id)) return 'selection';
  if (id === 'tool.move' || id === 'tool.scale' || id.startsWith('space.') || ['duplicate', 'duplicateLinked', 'group', 'ungroup', 'copyMaterial', 'pasteMaterial'].includes(id)) return 'edit';
  if (id.startsWith('tool.') || id === 'frame' || id === 'panels' || id === 'viewportMode' || id === 'lookThrough' || id === 'glyphs') return 'view';
  return 'general';
}

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
