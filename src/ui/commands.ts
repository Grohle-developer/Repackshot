// Commands: what buttons, the palette and the keyboard do. Each builds an
// action with a readable bilingual label and dispatches it; commands that
// need an inline confirmation return a ConfirmSpec for the caller to show
// where the user acted (UI.md §4.3).

import { STUDIO_PRESETS, studioPreset } from '../data/studios';
import type { DoctorCheckKey, Lang } from '../data/types';
import { activeCamera } from '../core/camera';
import { buildExample, EXAMPLE_KEYS, type ExampleKey } from '../core/example';
import { applyImportOptions, centrePivot, defaultImportOptions, releaseImport, type ImportMessage, type ImportOptions } from '../core/import-options';
import { actionParts, assignAction, inventoryFor, partMaterials, type MaterialId } from '../core/materials';
import { resolvePick, partsUnder, selectedNodes, type NodeId, type SelectionLevel } from '../core/scene';
import {
  cameraLookAt,
  defaultPatternParams,
  movableTargets,
  partsWithMaterial,
  type PatternSpec,
  type PivotMode,
  type Space,
} from '../core/transform';
import { createInitialState, type ThemeSetting } from '../core/store';
import { supportsAlpha } from '../core/render';
import { doctorCheck } from '../data/doctor';
import type { ConfirmSpec } from './components/widgets';
import { downloadBlob } from './dom';
import { cameraLabel, cameraName, dyn, materialLabel, materialName, presetLabel, setupLabel, studioLabel, targetLabel } from './names';
import { writePref } from './prefs';
import type { Ctx } from './reactive';
import type { Tool } from './ui-state';
import { L, formatClock, formatNumber, getLang, t, type StringKey } from './strings';

export type { ConfirmSpec };

// --- Project ---------------------------------------------------------------

export function exampleNames(): Record<ExampleKey, string> {
  const out = {} as Record<ExampleKey, string>;
  for (const k of EXAMPLE_KEYS) out[k] = t(dyn(`example.${k}`));
  return out;
}

export function loadExample(ctx: Ctx): void {
  const { store } = ctx;
  store.transaction(L('undo.example'), () => {
    store.dispatch({ type: 'scene/addModel', payload: buildExample(exampleNames()), replace: true });
    store.dispatch({ type: 'camera/frame' });
  });
  ctx.ui.set({ importMessage: null });
}

/** Opens the system file picker. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files ? [...input.files] : []);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Extensions read in this version (the importers live in src/io/import.ts; ui cannot import them: a test keeps both lists equal). */
export const READ_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'fbx', '3dm', '3mf', 'ply', 'dae', 'usd', 'usda', 'usdc', 'usdz'];
/** Formats the empty state lists as coming soon (CAD, phase I2). */
export const SOON_FORMATS = ['step', 'stp', 'iges', 'igs'];
export const MODEL_ACCEPT = [...READ_FORMATS, ...SOON_FORMATS].map((f) => `.${f}`).join(',');

/** The sentence for a note or warning an importer attached. */
export function importMessageText(name: string, m: ImportMessage): string {
  const params: Record<string, string | number> = { name };
  for (const [k, v] of Object.entries(m.params)) params[k] = typeof v === 'number' ? formatNumber(v, getLang(), 4) : v;
  return t(dyn(`import.msg.${m.code}`), params);
}

/** Shows what an importer reports (dropped triangles, a suspicious size...) as toasts, warnings first. */
function reportImport(ctx: Ctx, name: string, messages: readonly ImportMessage[]): void {
  for (const m of messages.slice(0, 2)) ctx.ui.toast(importMessageText(name, m));
}

// --- Importing: read, then the sheet, then the store ------------------------------------------------

/** Files waiting their turn while the sheet is open or a file is being read, per interface (there is one in the app). */
interface ImportQueue {
  waiting: File[];
  reading: boolean;
}
const queues = new WeakMap<object, ImportQueue>();
const queueOf = (ctx: Ctx): ImportQueue => {
  let q = queues.get(ctx.ui);
  if (!q) queues.set(ctx.ui, (q = { waiting: [], reading: false }));
  return q;
};
let sheetCounter = 0;

/**
 * A file dropped or chosen: it is read (in the units and axes of the file) and the inspector shows the import
 * sheet with the detected values; nothing reaches the scene until the person presses Import (UI.md §2.3).
 * Several files are shown one after the other.
 */
export async function importFiles(ctx: Ctx, files: readonly File[]): Promise<void> {
  const q = queueOf(ctx);
  q.waiting.push(...files);
  const sheet = ctx.ui.get().importSheet;
  if (sheet) ctx.ui.set({ importSheet: { ...sheet, queued: q.waiting.length } });
  if (sheet || q.reading) return;
  q.reading = true;
  try {
    while (q.waiting.length > 0 && !ctx.ui.get().importSheet) await readNext(ctx, q);
  } finally {
    q.reading = false;
  }
}

async function readNext(ctx: Ctx, q: ImportQueue): Promise<void> {
  const file = q.waiting.shift()!;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (SOON_FORMATS.includes(ext)) {
    const msg = t('import.soon', { format: ext.toUpperCase() });
    ctx.ui.set({ importMessage: msg });
    ctx.ui.toast(msg);
    return;
  }
  if (!READ_FORMATS.includes(ext)) {
    const msg = t('import.unknown', { name: file.name });
    ctx.ui.set({ importMessage: msg });
    ctx.ui.toast(msg);
    return;
  }
  ctx.ui.set({ importMessage: t('import.busy', { name: file.name }) });
  try {
    const read = await ctx.services.importFile(file);
    const options = defaultImportOptions(read.detected, ctx.store.get().scene.roots.length > 0);
    ctx.ui.set({
      importMessage: t('import.sheetHint', { name: file.name }),
      rightCollapsed: false,
      importSheet: { id: ++sheetCounter, name: file.name, format: read.format, payload: read, warnings: read.warnings, notes: read.notes, options, queued: q.waiting.length },
    });
  } catch (err) {
    const msg = t('import.failed', { name: file.name, reason: err instanceof Error ? err.message : String(err) });
    ctx.ui.set({ importMessage: msg });
    ctx.ui.toast(msg);
  }
}

/** Changes some of the sheet's values. */
export function setImportOptions(ctx: Ctx, patch: Partial<ImportOptions>): void {
  const sheet = ctx.ui.get().importSheet;
  if (sheet) ctx.ui.set({ importSheet: { ...sheet, options: { ...sheet.options, ...patch } } });
}

function closeSheet(ctx: Ctx): void {
  ctx.ui.set({ importSheet: null, importMessage: null });
  if (queueOf(ctx).waiting.length > 0) void importFiles(ctx, []);
}

/** Import (Enter): applies the sheet's options to the file and adds the result to the scene. */
export function confirmImport(ctx: Ctx): void {
  const sheet = ctx.ui.get().importSheet;
  if (!sheet) return;
  const { options, payload, name } = sheet;
  const applied = applyImportOptions(payload, options);
  if (applied.roots.length === 0) {
    // Every part is hidden in the file: say so and let the person turn "Import hidden layers" on.
    ctx.ui.toast(t('import.noParts', { name }));
    return;
  }
  releaseImport(payload, applied);
  // "Center" also puts the model's origin at the centre of its bounds, where the Doctor expects it.
  const placed = options.center ? centrePivot(applied) : applied;
  const model = { nodes: placed.nodes, roots: placed.roots, materials: placed.materials };
  // The Standard studio is already there: the part shows lit, centred, resting on the floor and framed.
  ctx.store.transaction(L('undo.import', { name }), () => {
    ctx.store.dispatch({ type: 'scene/addModel', payload: model, replace: options.mode === 'replace' });
    const roots = ctx.store.get().scene.roots;
    const added = [roots[roots.length - 1]];
    if (options.center) ctx.store.dispatch({ type: 'scene/center', ids: added });
    if (options.restOnFloor) ctx.store.dispatch({ type: 'scene/restOnFloor', ids: added });
    if (options.frameCamera) ctx.store.dispatch({ type: 'camera/frame' });
    // Reset transform returns to where the sheet placed the model.
    ctx.store.dispatch({ type: 'scene/setInitial', ids: added });
  });
  ctx.ui.toast(t('import.done', { name }));
  reportImport(ctx, name, [...sheet.warnings, ...sheet.notes, ...applied.notes]);
  closeSheet(ctx);
}

/** Cancel (Esc): forgets the file. */
export function cancelImport(ctx: Ctx): void {
  const sheet = ctx.ui.get().importSheet;
  if (!sheet) return;
  releaseImport(sheet.payload);
  closeSheet(ctx);
}

export async function importDialog(ctx: Ctx): Promise<void> {
  const files = await pickFiles(MODEL_ACCEPT);
  if (files.length) await importFiles(ctx, files);
}

export function newProject(ctx: Ctx): void {
  cancelImport(ctx);
  const s = ctx.store.get();
  ctx.store.reset(createInitialState({ lang: s.meta.lang, theme: s.meta.theme }));
  ctx.ui.set({ catalogOpen: false, pickMode: null, wizard: null, importMessage: null });
}

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'repackshot'
  );
}

export function projectFileBase(ctx: Ctx): string {
  return slug(ctx.store.get().meta.name || t('app.untitled'));
}

export function saveProject(ctx: Ctx): void {
  const name = `${projectFileBase(ctx)}.repack.json`;
  downloadBlob(ctx.services.serializeProject(ctx.store.get()), name);
  ctx.store.dispatch({ type: 'meta/saved' });
  ctx.ui.toast(t('toast.saved', { name }));
}

export async function exportViewport(ctx: Ctx): Promise<void> {
  const blob = await ctx.services.captureViewport();
  if (!blob) return;
  const name = `${projectFileBase(ctx)}-viewport.png`;
  downloadBlob(blob, name);
  ctx.ui.toast(t('toast.saved', { name }));
}

export function renameProject(ctx: Ctx, name: string): void {
  ctx.store.dispatch({ type: 'meta/rename', name: name.trim(), label: L('undo.renameProject') });
}

// --- Preferences ---------------------------------------------------------------

export function setTheme(ctx: Ctx, theme: ThemeSetting): void {
  ctx.store.dispatch({ type: 'meta/theme', theme });
  writePref('theme', theme);
}

/** The theme actually shown for a setting ('system' follows the OS, dark unless it asks for light). */
export function resolveTheme(setting: ThemeSetting): 'dark' | 'light' {
  if (setting !== 'system') return setting;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function toggleTheme(ctx: Ctx): void {
  setTheme(ctx, resolveTheme(ctx.store.get().meta.theme) === 'dark' ? 'light' : 'dark');
}

export function setLanguage(ctx: Ctx, lang: Lang): void {
  ctx.store.dispatch({ type: 'meta/lang', lang });
  writePref('lang', lang);
}

// --- Selection -------------------------------------------------------------------

export function setLevel(ctx: Ctx, level: SelectionLevel): void {
  const s = ctx.store.get();
  const nodes = selectedNodes(s);
  let ids: NodeId[] = nodes;
  if (level === 'MODEL' || level === 'GROUP') {
    ids = [...new Set(nodes.map((id) => (s.scene.nodes[id].kind === 'PART' || level === 'MODEL' ? resolvePick(s, partsUnder(s, [id])[0] ?? id, level) : id)))];
  } else if (level === 'PART') {
    ids = partsUnder(s, nodes);
  } else if (level === 'FACES') {
    ids = partsUnder(s, nodes).slice(0, 1);
  }
  ctx.store.dispatch({ type: 'scene/select', ids, mode: 'set', level });
}

export function deselect(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'scene/select', ids: [], mode: 'set' });
}

export function selectAllModel(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'scene/select', ids: [...ctx.store.get().scene.roots], mode: 'set', level: 'MODEL' });
}

function selectionOrAll(ctx: Ctx): NodeId[] {
  return selectedNodes(ctx.store.get());
}

export function frameSelection(ctx: Ctx, ids?: NodeId[]): void {
  const target = ids ?? selectionOrAll(ctx);
  ctx.store.dispatch({ type: 'camera/frame', ids: target, label: L('undo.frame') });
}

export function hideSelection(ctx: Ctx, ids?: NodeId[], visible = false): void {
  const s = ctx.store.get();
  const target = ids ?? selectedNodes(s);
  if (!target.length) return;
  ctx.store.dispatch({ type: 'scene/setVisible', ids: target, visible, label: L(visible ? 'undo.show' : 'undo.hide', { target: targetLabel(s, target) }) });
}

export function isolateSelection(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = ids ?? selectedNodes(s);
  if (!target.length) return;
  ctx.store.dispatch({ type: 'scene/isolate', ids: target, label: L('undo.isolate', { target: targetLabel(s, target) }) });
}

export function showAll(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'scene/showAll', label: L('undo.showAll') });
}

export function deleteSelection(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = ids ?? selectedNodes(s);
  if (target.length) {
    ctx.store.dispatch({ type: 'scene/delete', ids: target, label: L('undo.delete', { target: targetLabel(s, target) }) });
    return;
  }
  const camId = s.selection.ids.find((id) => s.camera.cameras[id]);
  if (camId) deleteCamera(ctx, camId);
}

export function restOnFloor(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const chosen = ids ?? selectedNodes(s);
  // Nothing chosen: the whole scene. Locked nodes stay where they are.
  const target = chosen.length ? movable(ctx, chosen) : chosen;
  if (chosen.length && !target.length) return;
  ctx.store.dispatch({ type: 'scene/restOnFloor', ids: target, label: L('undo.rest', { target: targetLabel(s, target) }) });
}

export function centerSelection(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const chosen = ids ?? selectedNodes(s);
  const target = chosen.length ? movable(ctx, chosen) : chosen;
  if (chosen.length && !target.length) return;
  ctx.store.dispatch({ type: 'scene/center', ids: target, label: L('undo.center', { target: targetLabel(s, target) }) });
}

export function setLocked(ctx: Ctx, ids: NodeId[], locked: boolean): void {
  const s = ctx.store.get();
  ctx.store.dispatch({ type: 'scene/setLocked', ids, locked, label: L(locked ? 'undo.lock' : 'undo.unlock', { target: targetLabel(s, ids) }) });
}

export function renameNode(ctx: Ctx, id: NodeId, name: string): void {
  const s = ctx.store.get();
  ctx.store.dispatch({ type: 'scene/rename', id, name, label: L('undo.rename', { target: targetLabel(s, [id]) }) });
}

// --- Move tool and operations on parts (phase U3) -------------------------------------

export function setTool(ctx: Ctx, tool: Tool): void {
  ctx.ui.set({ tool });
  ctx.services.viewport?.setTool(tool);
}

export function setSpace(ctx: Ctx, space: Space): void {
  ctx.ui.set({ space });
}

/** The selection an operation acts on (the part of a face selection), or the given ids. */
function targetsOf(ctx: Ctx, ids?: NodeId[]): NodeId[] {
  return ids ?? selectedNodes(ctx.store.get());
}

/** The targets that can move; says so when the selection is locked. */
function movable(ctx: Ctx, ids?: NodeId[]): NodeId[] {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  const out = movableTargets(s, target);
  if (target.length > 0 && out.length === 0) ctx.ui.toast(t('toast.locked', { target: targetLabel(s, target)[getLang()] }));
  return out;
}

/** Move (menu): selects the nodes and turns on the move tool. */
export function startMove(ctx: Ctx, ids?: NodeId[]): void {
  if (ids) ctx.store.dispatch({ type: 'scene/select', ids, mode: 'set' });
  setTool(ctx, 'move');
}

export function centerAndRest(ctx: Ctx, ids?: NodeId[]): void {
  const target = movable(ctx, ids);
  if (!target.length) return;
  ctx.store.dispatch({ type: 'scene/centerAndRest', ids: target, label: L('undo.centerRest', { target: targetLabel(ctx.store.get(), target) }) });
}

export function resetTransform(ctx: Ctx, ids?: NodeId[]): void {
  const target = movable(ctx, ids);
  if (!target.length) return;
  ctx.store.dispatch({ type: 'scene/resetTransform', ids: target, label: L('undo.reset', { target: targetLabel(ctx.store.get(), target) }) });
}

export function setPivot(ctx: Ctx, mode: PivotMode, ids?: NodeId[], point?: [number, number, number]): void {
  const target = targetsOf(ctx, ids);
  if (!target.length) return;
  if (mode === 'CUSTOM' && !point) {
    pickPivot(ctx, target);
    return;
  }
  ctx.store.dispatch({ type: 'scene/setPivot', ids: target, mode, point, label: L('undo.pivot', { target: targetLabel(ctx.store.get(), target), mode: L(dyn(`pivot.${mode}`)) }) });
}

/** Set from click: the next click on a part puts the pivot there. */
export function pickPivot(ctx: Ctx, ids?: NodeId[]): void {
  const target = targetsOf(ctx, ids);
  if (!target.length) return;
  ctx.ui.set({ pickMode: { kind: 'pivot', ids: target } });
}

export function setCameraTarget(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  const patch = target.length ? cameraLookAt(s, target) : null;
  if (!patch) return;
  const cam = activeCamera(s);
  ctx.store.dispatch({ type: 'camera/set', id: cam.id, patch, label: L('undo.cameraTarget', { target: targetLabel(s, target) }) });
}

export function duplicate(ctx: Ctx, linked: boolean, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  if (!target.length) return;
  ctx.store.dispatch({ type: 'scene/duplicate', ids: target, linked, label: L(linked ? 'undo.duplicateLinked' : 'undo.duplicate', { target: targetLabel(s, target) }) });
}

/** "Group 3": the next free number among the names in use. */
function freshName(ctx: Ctx, key: 'name.group' | 'name.pattern'): string {
  const names = new Set(Object.values(ctx.store.get().scene.nodes).map((n) => n.name));
  let n = 1;
  while (names.has(t(key, { n }))) n++;
  return t(key, { n });
}

export function groupSelection(ctx: Ctx, ids?: NodeId[]): void {
  const target = movable(ctx, ids);
  if (!target.length) return;
  ctx.store.dispatch({ type: 'scene/group', ids: target, name: freshName(ctx, 'name.group'), label: L('undo.group', { target: targetLabel(ctx.store.get(), target) }) });
}

export function ungroupSelection(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const groups = targetsOf(ctx, ids).filter((id) => s.scene.nodes[id]?.kind === 'GROUP');
  if (!groups.length) return;
  ctx.store.dispatch({ type: 'scene/ungroup', ids: groups, label: L('undo.ungroup', { target: targetLabel(s, groups) }) });
}

export function moveToGroup(ctx: Ctx, parent: NodeId | null, ids?: NodeId[]): void {
  const target = movable(ctx, ids);
  if (!target.length) return;
  const s = ctx.store.get();
  const group = parent ? { en: s.scene.nodes[parent].name, es: s.scene.nodes[parent].name } : L('ops.topLevel');
  ctx.store.dispatch({ type: 'scene/reparent', ids: target, parent, label: L('undo.moveToGroup', { target: targetLabel(s, target), group }) });
}

/** Pattern ▸ Linear / Circular: makes the pattern and selects its group, whose inspector edits it. */
export function createPattern(ctx: Ctx, kind: PatternSpec['kind'], ids?: NodeId[]): void {
  const target = movable(ctx, ids);
  if (!target.length) return;
  const s = ctx.store.get();
  ctx.store.dispatch({
    type: 'scene/pattern',
    ids: target,
    params: defaultPatternParams(s, target, kind),
    name: freshName(ctx, 'name.pattern'),
    label: L(kind === 'LINEAR' ? 'undo.patternLINEAR' : 'undo.patternCIRCULAR', { target: targetLabel(s, target) }),
  });
  ctx.ui.set({ rightCollapsed: false });
}

export function editPattern(ctx: Ctx, id: NodeId, patch: Partial<Omit<PatternSpec, 'sources'>>, gesture?: string): void {
  const s = ctx.store.get();
  ctx.store.dispatch({ type: 'scene/editPattern', id, patch, gesture, label: L('undo.editPattern', { target: targetLabel(s, [id]) }) });
}

export function toggleLock(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  if (!target.length) return;
  setLocked(ctx, target, !target.every((id) => s.scene.nodes[id]?.locked));
}

/** Hide, or show again when everything targeted is hidden. */
export function toggleHide(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  if (!target.length) return;
  hideSelection(ctx, target, target.every((id) => s.scene.nodes[id]?.visible === false));
}

// Materials of parts.

/** Every material the parts under the targets carry, in order. */
export function materialsOf(ctx: Ctx, ids?: NodeId[]): MaterialId[] {
  const s = ctx.store.get();
  const out: MaterialId[] = [];
  for (const p of partsUnder(s, targetsOf(ctx, ids))) for (const m of partMaterials(s.scene.nodes[p])) if (!out.includes(m)) out.push(m);
  return out;
}

export function unlinkMaterial(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const parts = partsUnder(s, targetsOf(ctx, ids));
  if (!parts.length) return;
  ctx.store.dispatch({ type: 'material/unlink', parts, label: L('undo.unlink', { target: targetLabel(s, targetsOf(ctx, ids)) }) });
}

/** Link with…: the next click on a part shares its material with these parts. */
export function pickLinkMaterial(ctx: Ctx, ids?: NodeId[]): void {
  const parts = partsUnder(ctx.store.get(), targetsOf(ctx, ids));
  if (parts.length) ctx.ui.set({ pickMode: { kind: 'link', parts } });
}

/** The parts take the material instance of `source` (its whole-part material, or the first it carries). */
export function linkMaterial(ctx: Ctx, parts: NodeId[], source: NodeId): void {
  const s = ctx.store.get();
  const node = s.scene.nodes[source];
  const mat = node ? (node.material ?? partMaterials(node)[0]) : undefined;
  const targets = parts.filter((p) => p !== source && s.scene.nodes[p]);
  if (!mat || !targets.length) return;
  ctx.store.dispatch({ type: 'material/assign', material: mat, targets, mode: 'REPLACE', label: L('undo.link', { target: targetLabel(s, targets), source: targetLabel(s, [source]) }) });
}

export function copyMaterial(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const mats = materialsOf(ctx, ids);
  if (mats.length !== 1) {
    if (mats.length > 1) ctx.ui.toast(t('toast.oneMaterial'));
    return;
  }
  const mat = s.materials[mats[0]];
  ctx.ui.set({ materialClipboard: mat });
  ctx.ui.toast(t('toast.copied', { material: materialName(mat) }));
}

export function pasteMaterial(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const clip = ctx.ui.get().materialClipboard;
  const target = targetsOf(ctx, ids);
  if (!clip) {
    ctx.ui.toast(t('toast.nothingToPaste'));
    return;
  }
  if (!partsUnder(s, target).length) return;
  ctx.store.dispatch({ type: 'material/paste', instance: clip, targets: target, label: L('undo.paste', { material: materialLabel(clip), target: targetLabel(s, target) }) });
}

export function selectByMaterial(ctx: Ctx, ids?: NodeId[]): void {
  const mats = materialsOf(ctx, ids);
  if (mats.length !== 1) return;
  ctx.store.dispatch({ type: 'scene/select', ids: partsWithMaterial(ctx.store.get(), mats[0]), mode: 'set', level: 'PART' });
}

// Geometry.

export function flipNormals(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  if (!partsUnder(s, target).length) return;
  ctx.store.dispatch({ type: 'scene/flipNormals', ids: target, label: L('undo.flip', { target: targetLabel(s, target) }) });
}

export function setSmoothAngle(ctx: Ctx, deg: number, gesture?: string, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  if (!partsUnder(s, target).length) return;
  ctx.store.dispatch({ type: 'scene/setSmoothAngle', ids: target, deg, gesture, label: L('undo.smoothAngle', { target: targetLabel(s, target) }) });
}

export function separateByMaterial(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  const names: Record<MaterialId, string> = {};
  for (const m of materialsOf(ctx, target)) names[m] = materialName(s.materials[m]);
  ctx.store.dispatch({ type: 'scene/separateByMaterial', ids: target, names, label: L('undo.separate', { target: targetLabel(s, target) }) });
}

/** Opens the inspector on a field of the selection and focuses it (Smoothing…, Rename from the viewport). */
export function focusInspectorField(ctx: Ctx, field: string, section = 'part'): void {
  ctx.ui.set({ rightCollapsed: false });
  requestAnimationFrame(() => {
    const sec = document.querySelector(`[data-section="${section}"]`);
    if (sec?.hasAttribute('data-collapsed')) (sec.querySelector('.section-head') as HTMLElement | null)?.click();
    const el = document.querySelector(`[data-field="${field}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center' });
    (el?.matches('input, [tabindex]') ? el : (el?.querySelector('input, [tabindex]') as HTMLElement | null))?.focus();
  });
}

// --- Studio, light and materials ----------------------------------------------------

export function setProductType(ctx: Ctx, key: string): void {
  if (!studioPreset(key)) return;
  ctx.store.dispatch({ type: 'studio/setPreset', key, label: L('undo.productType', { name: studioLabel(key) }) });
}

export function buildStudio(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'studio/build', label: L('undo.createStudio') });
}

/** "Create studio": asks first when a studio is already built. */
export function requestBuildStudio(ctx: Ctx): ConfirmSpec | null {
  if (!ctx.store.get().studio.built) {
    buildStudio(ctx);
    return null;
  }
  return {
    message: t('product.replace'),
    options: [{ label: t('common.yes'), primary: true, run: () => buildStudio(ctx) }],
    cancelLabel: t('common.no'),
  };
}

export function chooseSetup(ctx: Ctx, key: string): void {
  ctx.store.dispatch({ type: 'studio/setSetup', key, label: L('undo.setup', { name: setupLabel(key) }) });
}

/** Changing setup asks first when the lights were edited by hand. */
export function requestSetup(ctx: Ctx, key: string): ConfirmSpec | null {
  const s = ctx.store.get();
  if (!s.studio.modified || s.studio.lightSetup === key) {
    chooseSetup(ctx, key);
    return null;
  }
  return {
    message: t('light.replaceModified', { setup: setupLabel(key)[getLang()] }),
    options: [{ label: t('common.yes'), primary: true, run: () => chooseSetup(ctx, key) }],
    cancelLabel: t('common.no'),
  };
}

/**
 * Assigns a material to the selection at its level (UI §4.1). When the
 * target holds different materials, returns the inventory to confirm.
 */
export function requestAssign(ctx: Ctx, src: { preset?: string; material?: MaterialId }, ids?: NodeId[]): ConfirmSpec | null {
  const s = ctx.store.get();
  const base = assignAction(s, src, 'REPLACE', ids);
  const matLabel = src.material ? materialLabel(s.materials[src.material]) : presetLabel(src.preset ?? '');
  const tgt = base.faces
    ? base.faces.indices.length === 1
      ? L('inspector.face', { part: s.scene.nodes[base.faces.part]?.name ?? '' })
      : L('inspector.faces', { n: base.faces.indices.length, part: s.scene.nodes[base.faces.part]?.name ?? '' })
    : targetLabel(s, base.targets.length === s.scene.roots.length && !ids && selectedNodes(s).length === 0 ? [] : base.targets);
  const label = L('undo.assign', { material: matLabel, target: tgt });
  const inv = inventoryFor(s, base);
  if (actionParts(s, base).length === 0) return null;
  if (!inv.needsConfirm) {
    ctx.store.dispatch({ ...base, label });
    return null;
  }
  const lang = getLang();
  const list = inv.entries.map((e) => materialName(s.materials[e.material], lang)).join(', ');
  return {
    message: t('material.inventory', { target: tgt, n: inv.entries.length, list }),
    options: [
      { label: t('material.replaceAll'), primary: true, run: () => ctx.store.dispatch({ ...base, label }) },
      { label: t('material.keepExisting'), run: () => ctx.store.dispatch({ ...base, mode: 'KEEP', label }) },
    ],
  };
}

/** Parses a drag payload: "preset:GOLD" or "material:m3". */
export function parseMaterialDrag(data: string): { preset?: string; material?: MaterialId } | null {
  if (data.startsWith('preset:')) return { preset: data.slice(7) };
  if (data.startsWith('material:')) return { material: data.slice(9) };
  return null;
}

// --- Camera ---------------------------------------------------------------------

export function newCamera(ctx: Ctx): void {
  const n = Object.keys(ctx.store.get().camera.cameras).length + 1;
  ctx.store.dispatch({ type: 'camera/add', name: t('cameras.default', { n }), label: L('undo.newCamera') });
}

export function activateCamera(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  ctx.store.dispatch({ type: 'camera/activate', id, label: L('undo.activateCamera', { name: cameraLabel(s, s.camera.cameras[id]) }) });
}

export function deleteCamera(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  if (Object.keys(s.camera.cameras).length <= 1) {
    ctx.ui.toast(t('cameras.deleteLast'));
    return;
  }
  ctx.store.dispatch({ type: 'camera/delete', id, label: L('undo.deleteCamera', { name: cameraLabel(s, s.camera.cameras[id]) }) });
}

export function duplicateCamera(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  const name = `${cameraName(s, s.camera.cameras[id])} 2`;
  ctx.store.dispatch({ type: 'camera/add', from: id, name, label: L('undo.newCamera') });
}

export function toggleCameraLock(ctx: Ctx): void {
  const cam = activeCamera(ctx.store.get());
  ctx.store.dispatch({ type: 'camera/set', id: cam.id, patch: { locked: !cam.locked }, label: L('undo.camera', { what: L(cam.locked ? 'viewport.unlockCamera' : 'viewport.lockCamera') }) });
}

export function toggleProjection(ctx: Ctx): void {
  const cam = activeCamera(ctx.store.get());
  const projection = cam.projection === 'PERSPECTIVE' ? 'ORTHOGRAPHIC' : 'PERSPECTIVE';
  ctx.store.dispatch({ type: 'camera/set', id: cam.id, patch: { projection }, label: L('undo.camera', { what: L(projection === 'PERSPECTIVE' ? 'viewport.perspective' : 'viewport.ortho') }) });
}

// --- Studios --------------------------------------------------------------------

export function saveStudio(ctx: Ctx): void {
  const n = ctx.store.get().studio.saved.length + 1;
  const name = t('studios.default', { n });
  ctx.store.dispatch({ type: 'studio/save', name, label: L('undo.saveStudio', { name }) });
}

export function restoreStudio(ctx: Ctx, id: string): void {
  const st = ctx.store.get().studio.saved.find((x) => x.id === id);
  if (!st) return;
  ctx.store.dispatch({ type: 'studio/restore', id, label: L('undo.restoreStudio', { name: st.name }) });
}

// --- Doctor ---------------------------------------------------------------------

export function doctorFix(ctx: Ctx, key: DoctorCheckKey): void {
  const c = doctorCheck(key);
  ctx.store.dispatch({ type: 'doctor/fix', key, label: L('undo.doctor', { name: c?.label ?? { en: key, es: key } }) });
}

export function doctorFixAll(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'doctor/fixAll', label: L('undo.doctorAll') });
}

// --- Panels and guide -------------------------------------------------------------

export function togglePanels(ctx: Ctx): void {
  const u = ctx.ui.get();
  const both = u.leftCollapsed && u.rightCollapsed;
  ctx.ui.set({ leftCollapsed: !both, rightCollapsed: !both });
}

export function openGuide(ctx: Ctx): void {
  ctx.ui.set({ guideStep: 0, rightCollapsed: false });
}

// --- Render -------------------------------------------------------------------------

let renderAbort: AbortController | null = null;
let queueAbort: AbortController | null = null;

export function isRendering(): boolean {
  return renderAbort !== null;
}

function outputName(ctx: Ctx, cameraId: string, w: number, h: number, ext: string): string {
  const s = ctx.store.get();
  return `${projectFileBase(ctx)}-${slug(cameraName(s, s.camera.cameras[cameraId]))}-${w}x${h}.${ext}`;
}

/** Render button (Ctrl+Enter): renders at output size and downloads. Pressed again, stops. */
export async function render(ctx: Ctx): Promise<void> {
  if (renderAbort) {
    renderAbort.abort();
    return;
  }
  const s = ctx.store.get();
  const r = s.render;
  const format = r.format === 'JPEG' ? 'JPEG' : 'PNG';
  renderAbort = new AbortController();
  const started = performance.now();
  ctx.store.dispatch({ type: 'render/running', running: { jobId: null, progress: 0, samples: 0, seconds: 0 } });
  try {
    const blob = await ctx.services.renderImage({
      width: r.width,
      height: r.height,
      maxSamples: r.maxSamples,
      maxSeconds: r.maxSeconds,
      transparent: r.transparent && supportsAlpha(format),
      format,
      signal: renderAbort.signal,
      onProgress: (p) =>
        ctx.store.dispatch({ type: 'render/running', running: { jobId: null, progress: p, samples: p >= 1 ? 1 : 0, seconds: (performance.now() - started) / 1000 } }),
    });
    const name = outputName(ctx, s.camera.active, r.width, r.height, format === 'JPEG' ? 'jpg' : 'png');
    downloadBlob(blob, name);
    ctx.ui.toast(t('render.done', { name }));
  } catch (err) {
    if (renderAbort?.signal.aborted) ctx.ui.toast(t('render.cancelled'));
    else ctx.ui.toast(t('render.failed', { reason: err instanceof Error ? err.message : String(err) }));
  } finally {
    renderAbort = null;
    ctx.store.dispatch({ type: 'render/running', running: null });
  }
}

export function enqueue(ctx: Ctx): void {
  const n = ctx.store.get().render.queue.length + 1;
  ctx.store.dispatch({ type: 'render/enqueue', name: t('queue.job', { n }) });
  ctx.ui.set({ drawer: 'queue' });
}

export function isQueueRunning(): boolean {
  return queueAbort !== null;
}

/** Runs the queued jobs one after another with the same mechanism as Render. */
export async function startQueue(ctx: Ctx): Promise<void> {
  if (queueAbort) {
    queueAbort.abort();
    return;
  }
  queueAbort = new AbortController();
  try {
    for (;;) {
      const job = ctx.store.get().render.queue.find((j) => j.status === 'QUEUED');
      if (!job || queueAbort.signal.aborted) break;
      ctx.store.dispatch({ type: 'render/job', id: job.id, patch: { status: 'RUNNING', progress: 0 } });
      ctx.store.dispatch({ type: 'render/running', running: { jobId: job.id, progress: 0, samples: 0, seconds: 0 } });
      try {
        const format = job.format === 'JPEG' ? 'JPEG' : 'PNG';
        const blob = await ctx.services.renderImage({
          width: job.width,
          height: job.height,
          maxSamples: job.maxSamples,
          maxSeconds: job.maxSeconds,
          transparent: job.transparent && supportsAlpha(format),
          format,
          camera: job.camera,
          signal: queueAbort.signal,
          onProgress: (p) => ctx.store.dispatch({ type: 'render/job', id: job.id, patch: { progress: p } }),
        });
        downloadBlob(blob, outputName(ctx, job.camera, job.width, job.height, format === 'JPEG' ? 'jpg' : 'png'));
        ctx.store.dispatch({ type: 'render/job', id: job.id, patch: { status: 'DONE', progress: 1 } });
      } catch {
        ctx.store.dispatch({ type: 'render/job', id: job.id, patch: { status: queueAbort.signal.aborted ? 'CANCELLED' : 'FAILED' } });
      }
    }
  } finally {
    queueAbort = null;
    ctx.store.dispatch({ type: 'render/running', running: null });
  }
}

export function clearQueue(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'render/clearQueue' });
}

// --- Labels for value edits ----------------------------------------------------------

/** "Image: Exposure"-style label for a continuous edit. */
export function editLabel(group: 'env' | 'image' | 'camera', what: StringKey) {
  return L(group === 'env' ? 'undo.env' : group === 'image' ? 'undo.image' : 'undo.camera', { what: L(what) });
}

export function productTypes() {
  return STUDIO_PRESETS;
}

export { formatClock };
