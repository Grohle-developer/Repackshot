// Commands: what buttons, the palette and the keyboard do. Each builds an
// action with a readable bilingual label and dispatches it; commands that
// need an inline confirmation return a ConfirmSpec for the caller to show
// where the user acted (UI.md §4.3).

import { materialPreset } from '../data/materials';
import { STUDIO_PRESETS, studioPreset } from '../data/studios';
import type { DoctorCheckKey, Label, Lang, StudioPreset } from '../data/types';
import { aiFileName } from '../core/ai-post';
import { activeCamera } from '../core/camera';
import { buildExample, EXAMPLE_KEYS, type ExampleKey } from '../core/example';
import {
  applyImportOptions,
  centrePivot,
  defaultImportOptions,
  ImportError,
  releaseImport,
  TESSELLATION_PRESETS,
  tessellationOf,
  tessellationPreset,
  type ImportDetected,
  type ImportMessage,
  type ImportOptions,
  type ImportPayload,
  type ImportProgress,
} from '../core/import-options';
import {
  addItem,
  cleanName,
  emptyLibrary,
  customSetupOf,
  findItem,
  fromCurrentProductType,
  fromCurrentRig,
  fromCurrentStudio,
  fromMaterialInstance,
  instanceFromItem,
  libraryIsEmpty,
  migrateSavedStudios,
  presetOfItem,
  removeItem,
  renameItem,
  savedStudioOf,
  allItems,
  type ImportResult,
  type Library,
  type LibraryItem,
  type LibraryKind,
} from '../core/library';
import { LIBRARY_PREFIX, isLibraryKey } from '../core/lighting';
import { actionParts, assignAction, inventoryFor, partMaterials, type MaterialId } from '../core/materials';
import { imageIdsInUse, retainImages } from '../core/images';
import { dropAction, type AssignAction, type DroppedMaterial, type DropTarget } from '../core/material-drop';
import { applyBox, facesInBox, itemsInBox, type BoxCombine, type BoxMode, type Rect } from '../core/box-select';
import { cadFaceRegion } from '../core/faces';
import { getMesh, retainMeshes } from '../core/meshes';
import { meshIdsInUse, resolvePick, partsUnder, selectedNodes, type NodeId, type SelectionLevel } from '../core/scene';
import {
  cameraLookAt,
  defaultPatternParams,
  hasCadFaces,
  movableTargets,
  partsWithMaterial,
  type PatternSpec,
  type PivotMode,
  type Space,
} from '../core/transform';
import { createInitialState, type ProjectState, type ThemeSetting } from '../core/store';
import {
  importIsSure,
  isSection,
  resetSection,
  resetSetting,
  SETTING_ROWS,
  withImportDefaults,
  withProjectDefaults,
  withSetting,
  type SectionId,
  type SettingKey,
  type Settings,
} from '../core/settings';
import { patchSettings, settingsOf, type RenderSettings } from '../core/render';
import { doctorCheck } from '../data/doctor';
import { showFirstRunChooser } from '../core/models';
import type { ConfirmSpec } from './components/widgets';
import { downloadBlob } from './dom';
import { cameraLabel, cameraName, dyn, materialLabel, materialName, presetLabel, setupLabel, studioLabel, targetLabel, thumbKey } from './names';
import type { Ctx } from './reactive';
import { isRendering, pauseQueue, queueMode, runOnly, startQueue, stopJob } from './render-queue';
import { effectiveMode, type CadReadState, type PendingImport, type Tool, type ViewportMode } from './ui-state';
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

/** CAD formats (phase I2): tessellated on import, so the sheet opens at once and reads them in the background. */
export const CAD_FORMATS = ['step', 'stp', 'iges', 'igs'];
/** Extensions read in this version (the importers live in src/io/import.ts; ui cannot import them: a test keeps both lists equal). */
export const READ_FORMATS = ['glb', 'gltf', 'obj', 'stl', 'fbx', '3dm', '3mf', 'ply', 'dae', 'usd', 'usda', 'usdc', 'usdz', ...CAD_FORMATS];
export const MODEL_ACCEPT = READ_FORMATS.map((f) => `.${f}`).join(',');

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
  // A project is opened, never imported: the drop zone and the Import dialog both end up here.
  const project = files.find(isProjectFile);
  if (project) {
    if (files.length > 1) ctx.ui.toast(t('project.dropIgnored'));
    return openProjectFile(ctx, project);
  }
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
  if (CAD_FORMATS.includes(ext)) {
    openCadSheet(ctx, file, ext === 'iges' || ext === 'igs' ? 'IGES' : 'STEP', q.waiting.length);
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
    const settings = ctx.ui.get().settings;
    const options = withImportDefaults(defaultImportOptions(read.detected, ctx.store.get().scene.roots.length > 0), read.detected, settings);
    const sure = settings['import.sheet'] === 'UNSURE' && importIsSure(read.detected, read.warnings);
    ctx.ui.set({
      importMessage: t('import.sheetHint', { name: file.name }),
      rightCollapsed: sure ? ctx.ui.get().rightCollapsed : false,
      importSheet: { id: ++sheetCounter, name: file.name, format: read.format, payload: read, warnings: read.warnings, notes: read.notes, options, queued: q.waiting.length },
    });
    // Preferences ▸ Import defaults ▸ Only when unsure: a file that leaves no doubt imports with its values at once.
    if (sure) confirmImport(ctx);
  } catch (err) {
    const msg = t('import.failed', { name: file.name, reason: importErrorText(err) });
    ctx.ui.set({ importMessage: msg });
    ctx.ui.toast(msg);
  }
}

// --- CAD files: the sheet opens at once and the file is read (again, at another quality) behind it ----------

/** The CAD read of an interface: the file, its sheet, the read in flight and a re-read waiting for the fields to settle. */
interface CadRead {
  file: File;
  sheet: number;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** The tessellation of the payload on the sheet (or being read), to know when the options ask for another. */
  read: string;
}
const cadReads = new WeakMap<object, CadRead>();
/** How long the tessellation fields must rest before the file is read again. */
export const CAD_REREAD_DELAY_MS = 350;

const EMPTY_DETECTED: ImportDetected = { units: null, upAxis: 'Z', upAxisDeclared: false, size: 0, hasLayers: false, hiddenParts: 0 };
const emptyPayload = (): ImportPayload => ({ nodes: {}, roots: [], materials: {}, detected: { ...EMPTY_DETECTED } });
const tessellationKey = (o: ImportOptions): string => JSON.stringify(tessellationOf(o));

function setCad(ctx: Ctx, sheetId: number, patch: Partial<PendingImport> & { cad?: CadReadState }): void {
  const sheet = ctx.ui.get().importSheet;
  if (sheet && sheet.id === sheetId) ctx.ui.set({ importSheet: { ...sheet, ...patch } });
}

/** The sentence for an import that failed: the reason a CAD reader gave, or the reader's own message. */
export function importErrorText(err: unknown): string {
  if (err instanceof ImportError) return t(dyn(`import.error.${err.code}`));
  return err instanceof Error ? err.message : String(err);
}

function openCadSheet(ctx: Ctx, file: File, format: 'STEP' | 'IGES', queued: number): void {
  // The first read is at the CAD quality of Preferences ▸ Import defaults.
  const options = withImportDefaults(defaultImportOptions(EMPTY_DETECTED, ctx.store.get().scene.roots.length > 0), EMPTY_DETECTED, ctx.ui.get().settings);
  const id = ++sheetCounter;
  ctx.ui.set({
    importMessage: t('import.sheetHint', { name: file.name }),
    rightCollapsed: false,
    importSheet: { id, rev: 0, name: file.name, format, payload: emptyPayload(), warnings: [], notes: [], options, queued, cad: { stage: 'start' } },
  });
  cadReads.set(ctx.ui, { file, sheet: id, controller: null, timer: null, read: '' });
  void readCad(ctx);
}

/** Reads the CAD file of the open sheet with the sheet's tessellation; the payload is replaced when it arrives. */
async function readCad(ctx: Ctx): Promise<void> {
  const r = cadReads.get(ctx.ui);
  const sheet = ctx.ui.get().importSheet;
  if (!r || !sheet || sheet.id !== r.sheet) return;
  r.controller?.abort();
  const controller = new AbortController();
  r.controller = controller;
  r.read = tessellationKey(sheet.options);
  const sheetId = sheet.id;
  const progress = (p: ImportProgress) => {
    if (controller.signal.aborted) return;
    const cad = ctx.ui.get().importSheet?.cad;
    setCad(ctx, sheetId, { cad: { ...p, confirm: cad?.confirm } });
  };
  setCad(ctx, sheetId, { cad: { stage: 'start', confirm: sheet.cad?.confirm } });
  try {
    const read = await ctx.services.importFile(r.file, { tessellation: tessellationOf(sheet.options), signal: controller.signal, onProgress: progress });
    const now = ctx.ui.get().importSheet;
    if (controller.signal.aborted || !now || now.id !== sheetId) {
      releaseImport(read);
      return;
    }
    r.controller = null;
    releaseImport(now.payload);
    // The first read says the units the file declares: the sheet takes them, as it does for the other formats.
    const first = (now.rev ?? 0) === 0;
    const settings = ctx.ui.get().settings;
    const detected = withImportDefaults(defaultImportOptions(read.detected, ctx.store.get().scene.roots.length > 0), read.detected, settings);
    const options = first ? { ...now.options, units: detected.units, upAxis: detected.upAxis } : now.options;
    // Only when unsure: a CAD file that declares its units imports at once after its first read.
    const confirm = now.cad?.confirm === true || (first && settings['import.sheet'] === 'UNSURE' && importIsSure(read.detected, read.warnings));
    ctx.ui.set({ importSheet: { ...now, rev: (now.rev ?? 0) + 1, format: read.format, payload: read, warnings: read.warnings, notes: read.notes, options, cad: { stage: 'ready' } } });
    if (confirm) confirmImport(ctx);
  } catch (err) {
    if (controller.signal.aborted || (err instanceof ImportError && err.code === 'aborted')) return;
    r.controller = null;
    const reason = importErrorText(err);
    setCad(ctx, sheetId, { cad: { stage: 'error', error: reason } });
    if (ctx.ui.get().importSheet?.id === sheetId) ctx.ui.set({ importMessage: t('import.failed', { name: r.file.name, reason }) });
  }
}

/** Stops the CAD read of the sheet (if any) and forgets it. */
function stopCad(ctx: Ctx): void {
  const r = cadReads.get(ctx.ui);
  if (!r) return;
  if (r.timer) clearTimeout(r.timer);
  r.controller?.abort();
  cadReads.delete(ctx.ui);
}

/** Changes some of the sheet's values. A new tessellation reads a CAD file again once the fields rest. */
export function setImportOptions(ctx: Ctx, patch: Partial<ImportOptions>): void {
  const sheet = ctx.ui.get().importSheet;
  if (!sheet) return;
  const options = { ...sheet.options, ...patch };
  if (patch.tessellation && patch.tessellation !== 'CUSTOM') Object.assign(options, TESSELLATION_PRESETS[patch.tessellation]);
  else if (patch.chordPercent !== undefined || patch.angleDeg !== undefined) {
    Object.assign(options, tessellationOf(options));
    options.tessellation = tessellationPreset(options);
  }
  const r = cadReads.get(ctx.ui);
  if (!r || r.sheet !== sheet.id || tessellationKey(options) === r.read) {
    ctx.ui.set({ importSheet: { ...sheet, options } });
    return;
  }
  // The counts on the sheet are of the old quality from now on: it says so, and Import waits for the new read.
  ctx.ui.set({ importSheet: { ...sheet, options, cad: { stage: 'read', confirm: sheet.cad?.confirm } } });
  if (r.timer) clearTimeout(r.timer);
  r.timer = setTimeout(() => {
    r.timer = null;
    void readCad(ctx);
  }, CAD_REREAD_DELAY_MS);
}

function closeSheet(ctx: Ctx): void {
  stopCad(ctx);
  ctx.ui.set({ importSheet: null, importMessage: null });
  if (queueOf(ctx).waiting.length > 0) void importFiles(ctx, []);
}

/** Import (Enter): applies the sheet's options to the file and adds the result to the scene. */
export function confirmImport(ctx: Ctx): void {
  const sheet = ctx.ui.get().importSheet;
  if (!sheet) return;
  if (sheet.cad && sheet.cad.stage !== 'ready') {
    // A CAD file still being read imports as soon as it is; one that failed cannot.
    if (sheet.cad.stage === 'error') ctx.ui.toast(t('import.failed', { name: sheet.name, reason: sheet.cad.error ?? '' }));
    else ctx.ui.set({ importSheet: { ...sheet, cad: { ...sheet.cad, confirm: true } } });
    return;
  }
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

/** "All files" in the system's dialogs. */
const allFiles = () => ({ name: t('dialog.allFiles'), extensions: ['*'] });

export async function importDialog(ctx: Ctx): Promise<void> {
  // The desktop: the system's open dialog through the launcher; the browser: its file input.
  const dialogs = ctx.services.dialogs;
  const files = dialogs ? ((await dialogs.openFiles({ title: t('dialog.importModel'), filters: [{ name: t('dialog.models'), extensions: [...READ_FORMATS] }, allFiles()] })) ?? []) : await pickFiles(MODEL_ACCEPT);
  if (files.length) await importFiles(ctx, files);
}

/**
 * Writes an export (a scene, the viewport's image, the library): where the person says in the system's save dialog on
 * the desktop, a download in the browser. Returns the name written, or null when nothing was.
 */
async function saveExport(ctx: Ctx, blob: Blob, name: string, title: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
  const dialogs = ctx.services.dialogs;
  if (!dialogs) {
    // Repackshot's own window (P3c) never downloads: WebView2 cancels it, and the dialogs come with the launcher.
    if (ctx.services.windowHost) {
      ctx.ui.toast(t('dialog.err.notReady'));
      return null;
    }
    downloadBlob(blob, name);
    return name;
  }
  const r = await dialogs.saveFile(blob, name, { title, filters: [filter] });
  if (r.kind === 'SAVED') return r.name;
  // A dialog that did not open has said why already (the launcher's error, in a toast).
  if (r.kind === 'FAILED' && r.reason !== 'dialog') ctx.ui.toast(t('dialog.saveFailed', { name, reason: r.reason }));
  return null;
}

/** The state of a new project, or of one just opened: nothing of the old one lingers in the interface. */
function replaceProject(ctx: Ctx, state: ProjectState): void {
  cancelImport(ctx);
  ctx.store.reset(state);
  // History is gone with the old project, and so are the geometry and the images only it used.
  retainMeshes(meshIdsInUse(state));
  retainImages(imageIdsInUse(state.environment));
  ctx.ui.set({ catalogOpen: false, pickMode: null, wizard: null, importMessage: null, hover: null, renderWindow: null, selectedClip: null });
}

export function newProject(ctx: Ctx): void {
  const s = ctx.store.get();
  // A new project takes the defaults of Preferences (render, selection level); the open one never did.
  replaceProject(ctx, withProjectDefaults(createInitialState({ lang: s.meta.lang, theme: s.meta.theme }), ctx.ui.get().settings));
  // The next Save asks where: it is not the file of the project that was open.
  ctx.services.projectFiles.adopt(null);
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

/** The extension of a project file (it is JSON, so `.json` alone is not enough to tell it from other files). */
export const PROJECT_EXTENSION = '.repack.json';

export function isProjectFile(file: { name: string }): boolean {
  return file.name.toLowerCase().endsWith(PROJECT_EXTENSION);
}

/**
 * Saves the project. Without `saveAs`, to the file it came from or was last saved to when the browser lets it
 * (no dialog), otherwise it asks where, or downloads. Returns whether the file was written; the project is
 * clean only if nothing changed while it was being written.
 */
export async function saveProject(ctx: Ctx, opts: { saveAs?: boolean } = {}): Promise<boolean> {
  const { store, services } = ctx;
  const suggested = `${projectFileBase(ctx)}${PROJECT_EXTENSION}`;
  let revision = store.revision();
  const make = (): Blob => {
    revision = store.revision();
    return services.project.serialize(store.get());
  };
  let result;
  try {
    result = await services.projectFiles.save(make, suggested, { saveAs: opts.saveAs === true });
  } catch (err) {
    result = { kind: 'FAILED' as const, reason: err instanceof Error ? err.message : String(err) };
  }
  if (result.kind === 'CANCELLED') return false;
  if (result.kind === 'FAILED') {
    ctx.ui.toast(t('project.saveFailed', { name: suggested, reason: result.reason }));
    return false;
  }
  store.dispatch({ type: 'meta/saved', revision });
  ctx.ui.toast(t('toast.saved', { name: result.name }));
  return true;
}

/**
 * Runs `proceed` now, or after asking when the project has unsaved changes (UI.md §4.3: in place, three buttons,
 * Esc cancels). Save writes the project first and proceeds only if it was written.
 */
function afterUnsavedCheck(ctx: Ctx, message: string, proceed: () => void): void {
  if (!ctx.store.get().meta.dirty) return proceed();
  ctx.ui.set({
    prompt: {
      message,
      options: [
        { label: t('project.save'), primary: true, run: () => void saveProject(ctx).then((saved) => saved && proceed()) },
        { label: t('project.dontSave'), run: proceed },
      ],
    },
  });
}

/** New (menu): a fresh project, after asking when there are unsaved changes. */
export function requestNewProject(ctx: Ctx): void {
  afterUnsavedCheck(ctx, t('project.unsavedNew', { name: ctx.store.get().meta.name || t('app.untitled') }), () => newProject(ctx));
}

/** The sentence for a file that did not open (the technical reason is in the console, in English). */
export function projectFaultText(name: string, fault: { code: string; detail: string; schema?: number }): string {
  switch (fault.code) {
    case 'NOT_A_PROJECT':
      return t('project.err.notProject', { name });
    case 'NEWER_VERSION':
      return t('project.err.newer', { name, schema: fault.schema ?? 0 });
    case 'TOO_LARGE':
      return t('project.err.tooLarge', { name });
    default:
      return t('project.err.damaged', { name });
  }
}

/**
 * Opens a project file (the Open dialog, a dropped file): it is read and checked first, so a file that is not a
 * project, is from a newer version or is damaged says so and leaves the open project untouched; then, if there
 * are unsaved changes, the person is asked. The project replaces the open one and the history starts over:
 * the old states belong to another project (and their geometry is released), so undo stops at the opening.
 * `handle` is the file's place for Save (a dropped file's handle, when the browser gives one).
 */
export async function openProjectFile(ctx: Ctx, file: File, handle?: Promise<unknown> | unknown): Promise<void> {
  ctx.ui.set({ importMessage: t('project.opening', { name: file.name }) });
  let outcome;
  try {
    outcome = await ctx.services.project.open(file);
  } catch (err) {
    outcome = { ok: false as const, fault: { code: 'DAMAGED' as const, detail: err instanceof Error ? err.message : String(err) } };
  }
  ctx.ui.set({ importMessage: null });
  if (!outcome.ok) {
    console.warn(`project ${file.name}: ${outcome.fault.detail}`);
    ctx.ui.toast(projectFaultText(file.name, outcome.fault));
    return;
  }
  const { state, warnings } = outcome;
  const place: Promise<unknown> = Promise.resolve(handle).catch(() => null);
  afterUnsavedCheck(ctx, t('project.unsavedOpen', { name: ctx.store.get().meta.name || t('app.untitled'), file: file.name }), () => {
    const cur = ctx.store.get();
    // Language and theme are the person's, not the project's.
    replaceProject(ctx, { ...state, meta: { ...state.meta, lang: cur.meta.lang, theme: cur.meta.theme } });
    ctx.ui.toast(t('project.opened', { name: file.name }));
    for (const w of warnings) ctx.ui.toast(t(w.code === 'MISSING_IMAGES' ? 'project.warn.missingImages' : 'project.warn.missingMeshes', { n: w.count }));
    void place.then((h) => ctx.services.projectFiles.adopt(h ?? null));
  });
}

/**
 * General ▸ On start ▸ Last project: the file opened or saved last is offered in the header (reading it again needs
 * a click, the browser's permission). True when there was one to offer; otherwise the start is an empty project.
 */
export async function offerLastProject(ctx: Ctx): Promise<boolean> {
  const pf = ctx.services.projectFiles;
  const last = pf.last ? await pf.last() : null;
  if (!last || !pf.reopen) return false;
  const reopen = pf.reopen.bind(pf);
  ctx.ui.set({
    prompt: {
      message: t('project.reopenLast', { name: last.name }),
      options: [
        {
          label: t('project.reopen'),
          primary: true,
          run: () =>
            void reopen(last.handle).then((file) => {
              if (file) void openProjectFile(ctx, file, last.handle);
              else ctx.ui.toast(t('project.reopenFailed', { name: last.name }));
            }),
        },
      ],
      cancelLabel: t('project.notNow'),
    },
  });
  return true;
}

/** Open (menu, Ctrl/⌘ O): the dialog, then `openProjectFile`. */
export async function openProject(ctx: Ctx): Promise<void> {
  const picked = await ctx.services.projectFiles.pick();
  if (picked) await openProjectFile(ctx, picked.file, picked.handle);
}

/**
 * The files of a drop and, for each, the promise of its file handle when the browser gives one (Chromium: Save
 * then writes back to the dropped project). Call it inside the drop event: the handles are only there then.
 */
export function readDrop(dt: DataTransfer | null): { files: File[]; handles: Promise<unknown>[] } {
  const files: File[] = [];
  const handles: Promise<unknown>[] = [];
  for (const item of dt ? [...dt.items] : []) {
    const file = item.kind === 'file' ? item.getAsFile() : null;
    if (!file) continue;
    files.push(file);
    const get = (item as { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle;
    handles.push(get ? get.call(item).catch(() => null) : Promise.resolve(null));
  }
  // Browsers that list the files but not the items.
  if (files.length === 0 && dt) {
    for (const f of dt.files) {
      files.push(f);
      handles.push(Promise.resolve(null));
    }
  }
  return { files, handles };
}

// --- Environment images (E5) -------------------------------------------------------------------

const HDRI_EXTENSIONS = ['hdr', 'exr', 'rgbe', 'pic'];
const PLATE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/** One image file to read: the system's open dialog on the desktop (through the launcher), the file input in the browser. */
async function pickImage(ctx: Ctx, title: StringKey, kind: StringKey, extensions: readonly string[]): Promise<File | undefined> {
  const dialogs = ctx.services.dialogs;
  const files = dialogs
    ? ((await dialogs.openFiles({ title: t(title), filters: [{ name: t(kind), extensions: [...extensions] }, allFiles()] })) ?? [])
    : await pickFiles(extensions.map((e) => `.${e}`).join(','));
  return files[0];
}

/** An HDRI file by its name (dropped on the window it lights the scene instead of being imported). */
export function isHdriFile(file: File): boolean {
  return /\.(hdr|exr|rgbe|pic)$/i.test(file.name);
}

/** The toast for an image the environment could not take (the reader's error code: io/hdri.ts ImageFileError). */
export function imageErrorText(name: string, err: unknown, plate: boolean): string {
  const code = (err as { code?: unknown } | null)?.code;
  const detail = err instanceof Error ? err.message : String(err);
  if (code === 'FORMAT') return t(plate ? 'env.error.plateFormat' : 'env.error.hdriFormat', { name });
  if (code === 'TOO_LARGE') return t('env.error.tooLarge', { name });
  if (code === 'UNSUPPORTED') return t('env.error.unsupported', { name, detail });
  return t('env.error.damaged', { name, detail });
}

/** Environment ▸ Load HDRI…: the file lights the scene (kind HDRI), in one undoable step. */
export async function loadEnvironmentHdri(ctx: Ctx, file?: File): Promise<boolean> {
  const f = file ?? (await pickImage(ctx, 'dialog.loadHdri', 'dialog.hdri', HDRI_EXTENSIONS));
  if (!f) return false;
  try {
    const ref = await ctx.services.images.loadHdri(f);
    ctx.store.dispatch({ type: 'env/set', patch: { kind: 'HDRI', hdri: ref }, label: L('undo.envHdri', { name: ref.name }) });
    return true;
  } catch (err) {
    ctx.ui.toast(imageErrorText(f.name, err, false));
    return false;
  }
}

/** Environment ▸ Background image ▸ Load image…: the picture behind the part (background BACKPLATE). */
export async function loadBackplateImage(ctx: Ctx, file?: File): Promise<boolean> {
  const f = file ?? (await pickImage(ctx, 'dialog.loadPlate', 'dialog.images', PLATE_EXTENSIONS));
  if (!f) return false;
  try {
    const ref = await ctx.services.images.loadBackplate(f);
    ctx.store.dispatch({ type: 'env/set', patch: { background: 'BACKPLATE', backplate: ref }, label: L('undo.envPlate', { name: ref.name }) });
    return true;
  } catch (err) {
    ctx.ui.toast(imageErrorText(f.name, err, true));
    return false;
  }
}

/** Files dropped on the window: a project opens, an HDRI lights the scene, models go to the import sheet. */
export function dropFiles(ctx: Ctx, files: readonly File[], handles: readonly Promise<unknown>[] = []): void {
  const i = files.findIndex(isProjectFile);
  if (i >= 0) {
    if (files.length > 1) ctx.ui.toast(t('project.dropIgnored'));
    void openProjectFile(ctx, files[i], handles[i]);
    return;
  }
  // An HDRI lights the scene; the other files are models.
  const hdri = files.find(isHdriFile);
  if (hdri) void loadEnvironmentHdri(ctx, hdri);
  const models = files.filter((f) => !isHdriFile(f));
  if (models.length > 0) void importFiles(ctx, models);
}

/** The engine's scene for the output image, as the RSB file `rt` renders on the command line. */
export async function exportScene(ctx: Ctx): Promise<void> {
  const saved = await saveExport(ctx, ctx.services.exportScene(ctx.store.get()), `${projectFileBase(ctx)}.rsb`, t('dialog.exportScene'), { name: t('dialog.scene'), extensions: ['rsb'] });
  if (saved) ctx.ui.toast(t('toast.saved', { name: saved }));
}

export async function exportViewport(ctx: Ctx): Promise<void> {
  const blob = await ctx.services.captureViewport();
  if (!blob) return;
  const saved = await saveExport(ctx, blob, `${projectFileBase(ctx)}-viewport.png`, t('dialog.exportImage'), { name: t('dialog.pngImage'), extensions: ['png'] });
  if (saved) ctx.ui.toast(t('toast.saved', { name: saved }));
}

export function renameProject(ctx: Ctx, name: string): void {
  ctx.store.dispatch({ type: 'meta/rename', name: name.trim(), label: L('undo.renameProject') });
}

// --- Preferences ---------------------------------------------------------------

export function setTheme(ctx: Ctx, theme: ThemeSetting): void {
  setSetting(ctx, 'general.theme', theme);
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
  setSetting(ctx, 'general.lang', lang);
}

// --- Settings (UI.md §2.9): application state, saved at once, never undone ------------------------------

/** Replaces the settings; the theme and the language also reach the project's meta, which the interface follows. */
export function applySettings(ctx: Ctx, next: Settings): void {
  if (next !== ctx.ui.get().settings) ctx.ui.set({ settings: next });
  const meta = ctx.store.get().meta;
  if (meta.theme !== next['general.theme']) ctx.store.dispatch({ type: 'meta/theme', theme: next['general.theme'] });
  if (meta.lang !== next['general.lang']) ctx.store.dispatch({ type: 'meta/lang', lang: next['general.lang'] });
}

export function setSetting<K extends SettingKey>(ctx: Ctx, key: K, value: Settings[K]): void {
  applySettings(ctx, withSetting(ctx.ui.get().settings, key, value));
}

export function resetOneSetting(ctx: Ctx, key: SettingKey): void {
  applySettings(ctx, resetSetting(ctx.ui.get().settings, key));
}

/** Reset this section; the number of settings that changed back. */
export function resetSettingsSection(ctx: Ctx, section: SectionId): number {
  const before = ctx.ui.get().settings;
  const after = resetSection(before, section);
  const n = (Object.keys(before) as SettingKey[]).filter((k) => before[k] !== after[k]).length;
  applySettings(ctx, after);
  return n;
}

/**
 * Opens the Settings window: at the section last opened, at a section (`engine`), at a part of one
 * (`ai.models`), or at a row (`engine.threads`), which is brought into view and highlighted.
 */
export function openSettings(ctx: Ctx, target?: string, opts: { chooser?: boolean } = {}): void {
  let section: SectionId = ctx.ui.get().settingsSection;
  let focus: string | null = null;
  if (target) {
    if (isSection(target)) section = target;
    else {
      const row = SETTING_ROWS.find((r) => r.id === target);
      const head = target.split('.')[0];
      if (row) section = row.section;
      else if (isSection(head)) section = head;
      focus = target;
    }
  }
  if (section === 'desktop' && !ctx.ui.get().desktop) section = 'general';
  const nonce = (ctx.ui.get().settingsWindow?.nonce ?? 0) + 1;
  ctx.ui.set({ settingsWindow: { section, focus, nonce, ...(opts.chooser ? { chooser: true } : {}) }, settingsSection: section, paletteOpen: false, renderWindow: null });
}

export function closeSettings(ctx: Ctx): void {
  if (ctx.ui.get().settingsWindow) ctx.ui.set({ settingsWindow: null });
}

/**
 * The desktop portable's first start (AI-POST.md §2.2): the Settings window opens at AI ▸ Models as a chooser
 * (one, several or none), once. main.ts calls it when the launcher answers.
 */
export function maybeShowModelChooser(ctx: Ctx, o: { portable: boolean; pending: boolean }): boolean {
  const show = showFirstRunChooser({ desktop: ctx.ui.get().desktop !== null, portable: o.portable, pending: o.pending, shown: ctx.ui.get().chooserShown });
  if (show) {
    openSettings(ctx, 'ai.models', { chooser: true });
    ctx.ui.set({ chooserShown: true });
  }
  return show;
}

/** The person already answered our own question about closing (Ctrl/⌘ W on the desktop): the page closes without another. */
let closeAnswered = false;

/** Whether closing the page should ask first (General ▸ Confirm before closing; the page's beforeunload asks it). */
export function shouldConfirmClose(ctx: Ctx): boolean {
  return !closeAnswered && ctx.ui.get().settings['general.confirmClose'] && ctx.store.get().meta.dirty;
}

/** The close questions on screen (closing again while one is asked does not stack another). */
const closeQuestions = new WeakSet<ConfirmSpec>();

/**
 * Closing the desktop window, the one flow for every way to ask it: Ctrl/⌘ W and Ctrl/⌘ Q (guards.ts) and, in
 * Repackshot's own window (P3c), the window's own close (its close button, Alt F4, the taskbar, the system menu, which
 * the window turns into `close-requested`). Our unsaved-changes question (UI.md §4.3, when General ▸ Confirm before
 * closing is on: Save · Don't save · Cancel), then the window closes: `close-ok` to our own window, `window.close()` in
 * the browser's app window. Never the browser's own "Leave?" dialog.
 */
export function requestCloseWindow(ctx: Ctx): void {
  const host = ctx.services.windowHost;
  const close = ctx.services.desktop?.closeWindow;
  if (!host && !close) return;
  const go = () => {
    // Our own window has no beforeunload to quieten: it closes when told.
    if (host) return host.closeOk();
    if (!close) return;
    closeAnswered = true;
    close();
    // A window that did not close (the browser refused): the next close asks again.
    setTimeout(() => (closeAnswered = false), 1500);
  };
  if (!ctx.ui.get().settings['general.confirmClose']) return go();
  const asking = ctx.ui.get().prompt;
  if (asking && closeQuestions.has(asking)) return;
  afterUnsavedCheck(ctx, t('project.unsavedClose', { name: ctx.store.get().meta.name || t('app.untitled') }), go);
  const spec = ctx.ui.get().prompt;
  if (!spec || spec === asking) return;
  closeQuestions.add(spec);
  // The question sits under the project name, in the header: the Settings window, which is modal, makes way.
  if (ctx.ui.get().settingsWindow) ctx.ui.set({ settingsWindow: null });
}

/** Settings ▸ Render engine ▸ Measure performance: a real run of the example scene with the engine in use. */
let measuring: AbortController | null = null;
export async function measurePerformance(ctx: Ctx, seconds = 10): Promise<void> {
  if (measuring) return;
  const controller = new AbortController();
  measuring = controller;
  const startedAt = performance.now();
  ctx.ui.set({ perf: { state: 'RUNNING', startedAt, elapsed: 0 } });
  try {
    const result = await ctx.services.engine.measure({ seconds, signal: controller.signal, onProgress: (elapsed) => ctx.ui.set({ perf: { state: 'RUNNING', startedAt, elapsed } }) });
    ctx.ui.set({ perf: { state: 'DONE', result }, throughput: result.pixelSamplesPerSecond });
  } catch (err) {
    if (controller.signal.aborted) ctx.ui.set({ perf: { state: 'STOPPED' } });
    else ctx.ui.set({ perf: { state: 'FAILED', reason: err instanceof Error ? err.message : String(err) } });
  } finally {
    measuring = null;
  }
}

export function stopMeasuring(): void {
  measuring?.abort();
}

/** What this computer has, for the AI models (once per session unless asked again). */
export async function detectHardware(ctx: Ctx, again = false): Promise<void> {
  const h = ctx.ui.get().hardware;
  if (h.state === 'DETECTING' || (h.state === 'DONE' && !again)) return;
  ctx.ui.set({ hardware: { state: 'DETECTING', info: h.info } });
  try {
    ctx.ui.set({ hardware: { state: 'DONE', info: await ctx.services.hardware(again) } });
  } catch (err) {
    ctx.ui.set({ hardware: { state: 'DONE', info: { detected: false, where: ctx.ui.get().desktop ? 'desktop' : 'web', error: err instanceof Error ? err.message : String(err), cores: null, ramGiB: null, gpus: [], webgpu: null, maxBufferBytes: null } } });
  }
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

/** What a click at the Faces level does with the faces already selected. */
export type FaceClick = 'set' | 'add' | 'toggle' | 'remove';

/**
 * A click on a face at the Faces level (phase M1). The whole face under the pointer: a CAD face of a STEP or IGES
 * part, otherwise the surface that continues from the triangle (core/faces.ts). `loose` (Shift) takes only the
 * triangle that was hit. `mode`: replace the selection with it (plain click), add it (Shift), take it in or out
 * (Ctrl: out when the triangle that was hit is already selected), take it out (Alt).
 */
export function selectFaceAt(ctx: Ctx, part: NodeId, tri: number, how: { loose?: boolean; mode?: FaceClick } = {}): void {
  const s = ctx.store.get();
  const node = s.scene.nodes[part];
  if (!node || node.kind !== 'PART') return;
  const data = node.mesh ? getMesh(node.mesh.id) : undefined;
  const indices = how.loose || !data ? [tri] : cadFaceRegion(data, tri, { faceRanges: node.faceRanges });
  if (indices.length === 0) return;
  const held = s.selection.faces?.part === part && s.selection.faces.indices.includes(tri);
  const mode = how.mode ?? 'set';
  ctx.store.dispatch({ type: 'scene/selectFaces', part, indices, mode: mode === 'toggle' ? (held ? 'remove' : 'add') : mode });
}

/** The part that selection by box works on at the Faces level: the selected one, else the one at the middle of the box. */
function facesTarget(ctx: Ctx, rect: Rect): NodeId | null {
  const s = ctx.store.get();
  const chosen = s.selection.faces?.part ?? partsUnder(s, selectedNodes(s))[0];
  if (chosen && s.scene.nodes[chosen]?.kind === 'PART') return chosen;
  const hit = ctx.services.viewport?.pick((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2);
  return hit && s.scene.nodes[hit.node]?.kind === 'PART' ? hit.node : null;
}

/**
 * Selection by box with the Select tool (UI.md §4.1; core/box-select.ts has the rules): the models, groups or parts
 * the rectangle reaches at the level in force, or at Faces the whole faces of the part being worked on that show in it
 * (`xray`: also the hidden ones). `combine` replaces the selection, adds to it or takes from it. Returns how many items
 * (faces' triangles) it reached; null when the viewport cannot project the parts. Selection is not undoable.
 */
export function selectInBox(ctx: Ctx, box: { rect: Rect; mode: BoxMode }, combine: BoxCombine, opts: { xray?: boolean } = {}): number | null {
  const port = ctx.services.viewport;
  const projection = port?.projection();
  if (!port || !projection) return null;
  const s = ctx.store.get();
  if (s.selection.level !== 'FACES') {
    const hit = itemsInBox(s, box.rect, box.mode, s.selection.level, projection);
    ctx.store.dispatch({ type: 'scene/select', ids: applyBox(selectedNodes(s), hit, combine), mode: 'set', level: s.selection.level });
    return hit.length;
  }
  const part = facesTarget(ctx, box.rect);
  const node = part ? s.scene.nodes[part] : undefined;
  const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
  const mvp = part ? projection.mvp(part) : null;
  if (!part || !node || !data || !mvp) {
    if (combine === 'replace') ctx.store.dispatch({ type: 'scene/select', ids: [], mode: 'set', level: 'FACES' });
    return 0;
  }
  // What shows through the rectangle; a viewport that cannot tell leaves the geometry to decide, as X-ray does.
  const visible = opts.xray ? null : port.visibleTriangles(part, box.rect);
  const indices = facesInBox({ data, faceRanges: node.faceRanges, mvp, width: projection.width, height: projection.height, rect: box.rect, mode: box.mode, visible });
  ctx.store.dispatch({ type: 'scene/selectFaces', part, indices, mode: combine === 'replace' ? 'set' : combine });
  return indices.length;
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

// --- Viewport mode (UI.md §2.1) -------------------------------------------------------

/** The reason Full cannot run now, or null when it can. */
export function fullModeReason(ctx: Ctx): StringKey | null {
  switch (ctx.ui.get().engine) {
    case 'READY':
      return null;
    case 'LOADING':
      return 'header.fullLoading';
    case 'NO_WASM':
      return 'header.fullNoWasm';
    case 'NO_WORKERS':
      return 'header.fullNoWorkers';
    case 'OUTDATED':
      return 'header.fullOutdated';
    default:
      return 'header.fullFailed';
  }
}

/** Fast (rasterised preview) or Full (the path tracer) in the viewport: interface state, remembered, not undone. */
export function setViewportMode(ctx: Ctx, mode: ViewportMode): void {
  if (mode === 'FULL') {
    const reason = fullModeReason(ctx);
    if (reason) {
      ctx.ui.toast(t(reason));
      return;
    }
  }
  ctx.ui.set({ viewportMode: mode });
}

/** Ctrl/⌘ ⇧ R. */
export function toggleViewportMode(ctx: Ctx): void {
  setViewportMode(ctx, effectiveMode(ctx.ui.get()) === 'FULL' ? 'FAST' : 'FULL');
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

/** Separate by CAD faces (STEP, IGES): each part under the targets with CAD faces becomes one part per face. */
export function separateByCadFaces(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = targetsOf(ctx, ids);
  if (!hasCadFaces(s, target)) return;
  ctx.store.dispatch({ type: 'scene/separateByCadFaces', ids: target, label: L('undo.separateCad', { target: targetLabel(s, target) }) });
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
  if (isLibraryKey(key)) {
    // An own type: its definition goes into the project, which keeps it if the library item is deleted later.
    const item = findItem(ctx.ui.get().library, 'productType', key.slice(LIBRARY_PREFIX.length));
    const custom: StudioPreset | undefined = item ? presetOfItem(item) : (ctx.store.get().studio.customPreset ?? undefined);
    if (!custom || custom.key !== key) return;
    ctx.store.dispatch({ type: 'studio/setPreset', key, custom, label: L('undo.productType', { name: custom.label }) });
    return;
  }
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

/** What a setup is called: the catalogue label, or the name of the library item behind a `LIB:` key. */
function setupName(ctx: Ctx, key: string): Label {
  if (!isLibraryKey(key)) return setupLabel(key);
  const name = findItem(ctx.ui.get().library, 'lightSetup', key.slice(LIBRARY_PREFIX.length))?.name ?? ctx.store.get().studio.customSetup?.name ?? key;
  return { en: name, es: name };
}

export function chooseSetup(ctx: Ctx, key: string): void {
  if (isLibraryKey(key)) {
    // An own setup is applied like a catalogue one: normalised to the exposure of the product type in force.
    const item = findItem(ctx.ui.get().library, 'lightSetup', key.slice(LIBRARY_PREFIX.length));
    if (item) ctx.store.dispatch({ type: 'studio/applySetup', setup: customSetupOf(item), label: L('undo.setup', { name: setupName(ctx, key) }) });
    return;
  }
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
    message: t('light.replaceModified', { setup: setupName(ctx, key)[getLang()] }),
    options: [{ label: t('common.yes'), primary: true, run: () => chooseSetup(ctx, key) }],
    cancelLabel: t('common.no'),
  };
}

/** What a dragged or chosen material is, before it is resolved: a catalogue key, an instance, or a library item. */
export interface MaterialRef {
  preset?: string;
  material?: MaterialId;
  library?: string;
}

/**
 * The name of what an assignment reaches, in both languages: a node, "3 parts", "1 face of Body". `faces` is how
 * many faces the triangles of the target are (a drop reaches one; the selection may hold several, or loose triangles).
 */
function assignTarget(s: ProjectState, base: AssignAction, whole: boolean, faces?: number): Label {
  if (base.faces) {
    const part = s.scene.nodes[base.faces.part]?.name ?? '';
    const n = faces ?? base.faces.indices.length;
    return n === 1 ? L('inspector.face', { part }) : L('inspector.faces', { n, part });
  }
  return targetLabel(s, whole ? [] : base.targets);
}

/**
 * Does the assignment, or returns the inline confirmation when the target holds materials that differ among
 * themselves (UI §4.1): replace all, or keep the ones there are. One undo entry either way.
 */
function submitAssign(ctx: Ctx, base: AssignAction, matLabel: Label, tgt: Label): ConfirmSpec | null {
  const s = ctx.store.get();
  const label = L(base.copy ? 'undo.assignCopy' : 'undo.assign', { material: matLabel, target: tgt });
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

/** The assignment source of a reference and its name, or null when what it names is gone (a deleted library item). */
function resolveMaterialRef(ctx: Ctx, src: MaterialRef): { source: DroppedMaterial; name: Label } | null {
  const s = ctx.store.get();
  if (src.library) {
    // A material of the library (by item id) is offered to the store as the instance the item describes.
    const item = findItem(ctx.ui.get().library, 'material', src.library);
    return item ? { source: { library: { id: item.id, instance: instanceFromItem(item) } }, name: { en: item.name, es: item.name } } : null;
  }
  if (src.material) return s.materials[src.material] ? { source: { material: src.material }, name: materialLabel(s.materials[src.material]) } : null;
  if (src.preset) return materialPreset(src.preset) ? { source: { preset: src.preset }, name: presetLabel(src.preset) } : null;
  return null;
}

/**
 * Assigns a material to the selection at its level (UI §4.1). When the
 * target holds different materials, returns the inventory to confirm.
 */
export function requestAssign(ctx: Ctx, src: MaterialRef, ids?: NodeId[]): ConfirmSpec | null {
  const s = ctx.store.get();
  const ref = resolveMaterialRef(ctx, src);
  if (!ref) return null;
  const base = assignAction(s, ref.source, 'REPLACE', ids);
  return submitAssign(ctx, base, ref.name, assignTarget(s, base, !ids && selectedNodes(s).length === 0 && base.targets.length === s.scene.roots.length));
}

/**
 * A material dropped on something (UI §2.2, §2.3; the rules are in core/material-drop.ts): one assignment, one
 * undo entry ("Assign Gold to Body"). `copy` (Alt) gives the target an instance of its own. May return the
 * inline confirmation, like `requestAssign`.
 */
export function requestDrop(ctx: Ctx, src: MaterialRef, target: DropTarget, copy = false): ConfirmSpec | null {
  const s = ctx.store.get();
  const ref = resolveMaterialRef(ctx, src);
  if (!ref) return null;
  const base = dropAction(ref.source, target, copy);
  return submitAssign(ctx, base, ref.name, assignTarget(s, base, false, 1));
}

/** Parses a drag payload: "preset:GOLD", "material:m3" or "library:<id>" (a material of the user's library). */
export function parseMaterialDrag(data: string): MaterialRef | null {
  if (data.startsWith('preset:')) return { preset: data.slice(7) };
  if (data.startsWith('material:')) return { material: data.slice(9) };
  if (data.startsWith('library:')) return { library: data.slice(8) };
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

/**
 * Saves the scene as a studio of the library (the Studios tab). Without a name (the palette, the shortcut) it
 * gets "Studio N" and can be renamed in the tab.
 */
export async function saveStudio(ctx: Ctx, name?: string): Promise<void> {
  const lib = ctx.ui.get().library;
  const given = name === undefined ? '' : cleanName(name);
  const chosen = given || t('studios.default', { n: lib.studios.length + 1 });
  const state = ctx.store.get();
  const thumb = await captureThumb(ctx);
  commitItem(ctx, (l) => fromCurrentStudio(state, l, chosen, { thumb }));
}

/** Restores a studio of the library or, failing that, one saved inside the project (older files). One undo entry. */
export function restoreStudio(ctx: Ctx, id: string): void {
  const item = findItem(ctx.ui.get().library, 'studio', id);
  if (item) {
    ctx.store.dispatch({ type: 'studio/restore', id, snapshot: savedStudioOf(item), label: L('undo.restoreStudio', { name: item.name }) });
    return;
  }
  const st = ctx.store.get().studio.saved.find((x) => x.id === id);
  if (!st) return;
  ctx.store.dispatch({ type: 'studio/restore', id, label: L('undo.restoreStudio', { name: st.name }) });
}

/** A studio saved inside the project (an older file) moves to the library; it leaves the project (undoable). */
export function moveStudioToLibrary(ctx: Ctx, id: string): void {
  const st = ctx.store.get().studio.saved.find((x) => x.id === id);
  if (!st) return;
  ctx.ui.set({ library: migrateSavedStudios(ctx.ui.get().library, [st]) });
  ctx.store.dispatch({ type: 'studio/deleteSaved', id, label: L('undo.deleteStudio', { name: st.name }) });
  ctx.ui.toast(t('library.saved', { name: st.name }));
}

// --- The user's library (U4) --------------------------------------------------------

/** Size of the pictures of setups, product types and studios. */
const THUMB_W = 160;
const THUMB_H = 120;

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

/**
 * A 160 × 120 picture of the viewport as the engine draws it now: the preview engine renders one rasterised
 * frame at that size (a few milliseconds), so the picture is the product's own render, not a drawing. Undefined
 * when there is no engine or a render is running; the item then shows a generic icon.
 */
export async function captureThumb(ctx: Ctx): Promise<string | undefined> {
  if (!ctx.services.viewport || isRendering(ctx) || ctx.store.get().render.running) return undefined;
  try {
    const blob = await ctx.services.renderImage({ width: THUMB_W, height: THUMB_H, maxSamples: 1, maxSeconds: 1, transparent: false, format: 'JPEG', quick: true });
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  }
}

/** Adds an item made from the library as it is right now (it may have changed while a picture was rendered). */
function commitItem(ctx: Ctx, make: (lib: Library) => LibraryItem | null): void {
  const lib = ctx.ui.get().library;
  const item = make(lib);
  if (!item) return;
  const next = addItem(lib, item);
  if (next === lib) return;
  ctx.ui.set({ library: next });
  const saved = allItems(next).find((i) => i.id === item.id);
  ctx.ui.toast(t('library.saved', { name: saved?.name ?? item.name }));
}

/** The name the inline field starts with. */
export function suggestMaterialName(ctx: Ctx, id: MaterialId): string {
  const m = ctx.store.get().materials[id];
  if (!m) return '';
  return m.name || (m.origin ? presetLabel(m.origin)[getLang()] : materialName(m));
}

export function suggestSetupName(ctx: Ctx): string {
  const s = ctx.store.get();
  return s.studio.lightSetup === 'PRESET' ? studioLabel(s.studio.preset, s.studio.customPreset)[getLang()] : setupName(ctx, s.studio.lightSetup)[getLang()];
}

export function suggestTypeName(ctx: Ctx): string {
  const s = ctx.store.get();
  return studioLabel(s.studio.preset, s.studio.customPreset)[getLang()];
}

export function suggestStudioName(ctx: Ctx): string {
  return t('studios.default', { n: ctx.ui.get().library.studios.length + 1 });
}

/** Save material as…: the sphere is rendered by the product, like the catalogue's. */
export async function saveMaterialToLibrary(ctx: Ctx, id: MaterialId, name: string): Promise<void> {
  const mat = ctx.store.get().materials[id];
  if (!mat || !cleanName(name)) return;
  const thumb = (await ctx.services.viewport?.materialThumbnail(mat, thumbKey(mat)).catch(() => null)) ?? undefined;
  commitItem(ctx, (lib) => fromMaterialInstance(lib, mat, name, { thumb }));
}

/** Save light setup as…: the lights as they are, with a picture of the viewport. */
export async function saveSetupToLibrary(ctx: Ctx, name: string): Promise<void> {
  const state = ctx.store.get();
  if (!cleanName(name)) return;
  if (!fromCurrentRig(state, ctx.ui.get().library, name)) {
    ctx.ui.toast(t('library.noRig'));
    return;
  }
  const thumb = await captureThumb(ctx);
  commitItem(ctx, (lib) => fromCurrentRig(state, lib, name, { thumb }));
}

/** Save as product type…: the studio on screen as a type of your own. */
export async function saveProductTypeToLibrary(ctx: Ctx, name: string): Promise<void> {
  const state = ctx.store.get();
  if (!cleanName(name)) return;
  const thumb = await captureThumb(ctx);
  commitItem(ctx, (lib) => fromCurrentProductType(state, lib, name, { thumb }));
}

export function renameLibraryItem(ctx: Ctx, kind: LibraryKind, id: string, name: string): void {
  ctx.ui.set({ library: renameItem(ctx.ui.get().library, kind, id, name) });
}

/**
 * Deletes an item of the library. The project does not depend on the library: a material in use stays as the
 * instance it is (no longer linked to the item), a setup or a product type in use stays as the values it set.
 */
export function deleteLibraryItem(ctx: Ctx, kind: LibraryKind, id: string): void {
  const lib = ctx.ui.get().library;
  const item = allItems(lib).find((i) => i.kind === kind && i.id === id);
  if (!item) return;
  ctx.ui.set({ library: removeItem(lib, kind, id) });
  if (kind === 'material') ctx.store.dispatch({ type: 'material/unlinkLibrary', library: id, label: L('undo.libraryRemoved', { name: { en: item.name, es: item.name } }) });
}

/** Export library: the JSON file, downloaded (the browser) or where the save dialog says (the desktop). */
export async function exportLibraryFile(ctx: Ctx): Promise<void> {
  const lib = ctx.ui.get().library;
  if (libraryIsEmpty(lib)) {
    ctx.ui.toast(t('library.exportEmpty'));
    return;
  }
  const name = await saveExport(ctx, ctx.services.library.export(lib), 'repackshot-library.json', t('dialog.exportLibrary'), { name: t('dialog.library'), extensions: ['json'] });
  if (name) ctx.ui.toast(t('library.exported', { n: allItems(lib).length, name }));
}

/** Merges the text of a library file into the library and says what happened. */
export function importLibraryText(ctx: Ctx, text: string): ImportResult {
  const r = ctx.services.library.import(text, ctx.ui.get().library);
  if (r.error) {
    ctx.ui.toast(t('library.importFailed', { reason: r.error }));
    return r;
  }
  if (r.lib !== ctx.ui.get().library) ctx.ui.set({ library: r.lib });
  if (r.skipped.length === 0) {
    ctx.ui.toast(t('library.imported', { added: r.added }));
  } else {
    const first = r.skipped[0];
    const reason = first.code === 'duplicate' ? t('library.skip.duplicate') : `${t('library.skip.invalid')} (${first.reason})`;
    ctx.ui.toast(t('library.importedSkipped', { added: r.added, skipped: r.skipped.length, reason }));
  }
  return r;
}

export async function importLibraryFile(ctx: Ctx, file: File): Promise<void> {
  importLibraryText(ctx, await file.text());
}

/** Import library: the system file picker, then the merge. */
export async function importLibraryDialog(ctx: Ctx): Promise<void> {
  const dialogs = ctx.services.dialogs;
  const [file] = dialogs ? ((await dialogs.openFiles({ title: t('dialog.importLibrary'), filters: [{ name: t('dialog.library'), extensions: ['json'] }, allFiles()] })) ?? []) : await pickFiles('.json,application/json');
  if (file) await importLibraryFile(ctx, file);
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

// --- Render (UI.md §2.5, §2.7, §2.8) -----------------------------------------------------

/** Opens the render window (Render…, Ctrl/⌘ ⏎); pressed while it is open, renders. */
export function openRenderWindow(ctx: Ctx): void {
  const w = ctx.ui.get().renderWindow;
  if (w) {
    void renderFromWindow(ctx);
    return;
  }
  ctx.ui.set({ renderWindow: { kind: 'NEW' }, paletteOpen: false });
}

export function closeRenderWindow(ctx: Ctx): void {
  if (ctx.ui.get().renderWindow) ctx.ui.set({ renderWindow: null });
}

/** The settings the window shows: the project's, or the draft of the job being edited. */
export function windowSettings(ctx: Ctx): RenderSettings {
  const w = ctx.ui.get().renderWindow;
  return w?.kind === 'EDIT' ? w.draft : settingsOf(ctx.store.get().render);
}

/** Changes a setting of the window: the project's (undoable, one entry per gesture), or the draft of an edit. `label`: the undo entry's name (default: Render settings). */
export function setRenderSettings(ctx: Ctx, patch: Partial<RenderSettings>, gesture?: string, label?: Label): void {
  const w = ctx.ui.get().renderWindow;
  if (w?.kind === 'EDIT') {
    ctx.ui.set({ renderWindow: { ...w, draft: patchSettings(w.draft, patch) } });
    return;
  }
  ctx.store.dispatch({ type: 'render/set', patch, label: label ?? L('undo.render'), ...(gesture ? { gesture } : {}) });
}

/** Asks again for the folder's permission while the click still counts as a user gesture. */
async function folderAccess(ctx: Ctx, s: RenderSettings): Promise<void> {
  if (s.destination.kind !== 'FOLDER') return;
  if (!(await ctx.services.files.ensureAccess(s.destination.id))) ctx.ui.toast(t(ctx.services.files.desktop ? 'rw.folderDeniedDesktop' : 'rw.folderDenied'));
}

/** Adds jobs made from settings (first or last); returns the new jobs' ids. */
function enqueueSettings(ctx: Ctx, settings: RenderSettings, position: 'FIRST' | 'LAST'): string[] {
  const before = new Set(ctx.store.get().render.queue.map((j) => j.id));
  ctx.store.dispatch({ type: 'render/enqueue', at: Date.now(), position, settings, label: L('undo.enqueue') });
  return ctx.store.get().render.queue.filter((j) => !before.has(j.id)).map((j) => j.id);
}

/**
 * Render: the job (one per camera with "All cameras") goes first in the queue and starts now; the
 * window closes and the Queue button shows the progress. "Render just this one".
 */
export async function renderFromWindow(ctx: Ctx): Promise<void> {
  const w = ctx.ui.get().renderWindow;
  if (w?.kind === 'EDIT') {
    saveJobEdit(ctx);
    return;
  }
  const settings = settingsOf(ctx.store.get().render);
  closeRenderWindow(ctx);
  await renderWith(ctx, settings);
}

/** Ctrl/⌘ ⇧ ⏎: renders at once with the window's last settings, without opening it. */
export async function renderNow(ctx: Ctx): Promise<void> {
  const w = ctx.ui.get().renderWindow;
  if (w) {
    await renderFromWindow(ctx);
    return;
  }
  await renderWith(ctx, settingsOf(ctx.store.get().render));
}

async function renderWith(ctx: Ctx, settings: RenderSettings): Promise<void> {
  const access = folderAccess(ctx, settings);
  const ids = enqueueSettings(ctx, settings, 'FIRST');
  await access;
  if (ids.length === 0) return;
  if (runOnly(ctx, ids) === 'NEXT') ctx.ui.toast(t('rw.startsAfter'));
}

/** + Add to queue: last in the queue, not started; the window stays open for the next one. */
export async function addToQueueFromWindow(ctx: Ctx): Promise<void> {
  const w = ctx.ui.get().renderWindow;
  if (w?.kind === 'EDIT') return;
  const settings = settingsOf(ctx.store.get().render);
  const access = folderAccess(ctx, settings);
  enqueueSettings(ctx, settings, 'LAST');
  await access;
  const n = ctx.store.get().render.queue.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  ctx.ui.toast(n === 1 ? t('rw.added1') : t('rw.added', { n }));
}

/** The palette's "Add to queue": the window's settings, last in the queue. */
export function enqueue(ctx: Ctx): void {
  const ids = enqueueSettings(ctx, settingsOf(ctx.store.get().render), 'LAST');
  if (ids.length === 0) return;
  const n = ctx.store.get().render.queue.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
  ctx.ui.toast(n === 1 ? t('rw.added1') : t('rw.added', { n }));
}

/** Edit: the window opens with the job's settings and Save changes. */
export function editJob(ctx: Ctx, id: string): void {
  const job = ctx.store.get().render.queue.find((j) => j.id === id);
  if (!job || job.status === 'RUNNING') return;
  ctx.ui.set({ renderWindow: { kind: 'EDIT', jobId: id, draft: job.settings } });
}

export function saveJobEdit(ctx: Ctx): void {
  const w = ctx.ui.get().renderWindow;
  if (w?.kind !== 'EDIT') return;
  ctx.store.dispatch({ type: 'render/updateJob', id: w.jobId, settings: w.draft, label: L('undo.editJob') });
  ctx.ui.set({ renderWindow: null });
  ctx.ui.toast(t('rw.saved'));
}

export function duplicateJob(ctx: Ctx, id: string): void {
  ctx.store.dispatch({ type: 'render/duplicateJob', id, at: Date.now(), label: L('undo.duplicateJob') });
}

export function removeJob(ctx: Ctx, id: string): void {
  ctx.store.dispatch({ type: 'render/removeJob', id, label: L('undo.removeJob') });
}

export function moveJob(ctx: Ctx, id: string, to: number): void {
  ctx.store.dispatch({ type: 'render/moveJob', id, to, label: L('undo.moveJob') });
}

export function clearFinished(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'render/clearFinished', label: L('undo.clearFinished') });
}

/** Start queue / Pause. */
export function toggleQueue(ctx: Ctx): void {
  if (queueMode(ctx) === 'IDLE') startQueue(ctx);
  else pauseQueue(ctx);
}

export { isRendering, queueMode, stopJob };

export function openQueue(ctx: Ctx): void {
  ctx.ui.set({ drawer: 'queue' });
}

// --- Results -------------------------------------------------------------------------------

/** Loads the results history (at start). */
export async function loadResults(ctx: Ctx): Promise<void> {
  try {
    const [persistent, list] = await Promise.all([ctx.services.results.persistent(), ctx.services.results.list()]);
    ctx.ui.set({ results: list, resultsStorage: persistent ? 'PERSISTENT' : 'MEMORY' });
  } catch {
    ctx.ui.set({ resultsStorage: 'MEMORY' });
  }
}

export function openResult(ctx: Ctx, id: string): void {
  if (!ctx.ui.get().results.some((r) => r.id === id)) {
    ctx.ui.toast(t('rv.missing'));
    return;
  }
  ctx.ui.set({ resultView: { id, compare: null, split: 'SPLIT', position: 0.5 }, renderWindow: null });
}

export function openLastResult(ctx: Ctx): void {
  const r = ctx.ui.get().results[0];
  if (r) openResult(ctx, r.id);
  else ctx.ui.toast(t('render.noResult'));
}

export function closeResult(ctx: Ctx): void {
  if (ctx.ui.get().resultView) ctx.ui.set({ resultView: null });
}

/** Saves a result again (to the folder it went to, or a download). `which`: the engine's image (default) or the one the AI made. */
export async function saveResultAgain(ctx: Ctx, id: string, which: 'RENDER' | 'AI' = 'RENDER'): Promise<void> {
  const meta = ctx.ui.get().results.find((r) => r.id === id);
  const blobs = meta ? await ctx.services.results.get(id) : null;
  const blob = which === 'AI' ? blobs?.ai : blobs?.file;
  if (!meta || !blobs || !blob) {
    ctx.ui.toast(t('rv.missing'));
    return;
  }
  const name = which === 'AI' ? (meta.ai?.name ?? aiFileName(meta.name)) : meta.name;
  if (meta.savedTo.kind === 'FOLDER') await ctx.services.files.ensureAccess(meta.savedTo.id);
  const where = await ctx.services.files.save(meta.savedTo, name, blob);
  ctx.ui.toast(where === 'FOLDER' && meta.savedTo.kind === 'FOLDER' ? t('render.doneFolder', { name, folder: meta.savedTo.name }) : t('render.done', { name }));
}

export async function deleteResult(ctx: Ctx, id: string): Promise<void> {
  try {
    await ctx.services.results.remove(id);
  } catch {
    // Gone already.
  }
  const v = ctx.ui.get().resultView;
  ctx.ui.set({
    results: ctx.ui.get().results.filter((r) => r.id !== id),
    ...(v && v.id === id ? { resultView: null } : v && v.compare === id ? { resultView: { ...v, compare: null } } : {}),
  });
}

/** Settings ▸ Storage ▸ Library ▸ Free up: the library emptied (main.ts saves it like any other change). */
export function clearLibrary(ctx: Ctx): void {
  ctx.ui.set({ library: emptyLibrary() });
}

export async function clearHistory(ctx: Ctx): Promise<void> {
  try {
    await ctx.services.results.clear();
  } catch {
    // Nothing to clear.
  }
  ctx.ui.set({ results: [], resultView: null });
}

/** Choose folder…: the browser's folder picker; the folder becomes the destination. */
export async function chooseFolder(ctx: Ctx): Promise<void> {
  const f = await ctx.services.files.chooseFolder();
  if (f) setRenderSettings(ctx, { destination: { kind: 'FOLDER', id: f.id, name: f.name } });
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
