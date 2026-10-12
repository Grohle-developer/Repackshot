// Commands: what buttons, the palette and the keyboard do. Each builds an
// action with a readable bilingual label and dispatches it; commands that
// need an inline confirmation return a ConfirmSpec for the caller to show
// where the user acted (UI.md §4.3).

import { STUDIO_PRESETS, studioPreset } from '../data/studios';
import type { DoctorCheckKey, Lang } from '../data/types';
import { activeCamera } from '../core/camera';
import { buildExample, EXAMPLE_KEYS, type ExampleKey } from '../core/example';
import { actionParts, assignAction, inventoryFor, type MaterialId } from '../core/materials';
import { resolvePick, partsUnder, selectedNodes, type NodeId, type SelectionLevel } from '../core/scene';
import { createInitialState, type ThemeSetting } from '../core/store';
import { supportsAlpha } from '../core/render';
import { doctorCheck } from '../data/doctor';
import type { ConfirmSpec } from './components/widgets';
import { downloadBlob } from './dom';
import { cameraLabel, cameraName, dyn, materialLabel, materialName, presetLabel, setupLabel, studioLabel, targetLabel } from './names';
import { writePref } from './prefs';
import type { Ctx } from './reactive';
import { L, formatClock, getLang, t, type StringKey } from './strings';

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

export const MODEL_ACCEPT = '.glb,.gltf,.obj,.stl';

export async function importFiles(ctx: Ctx, files: readonly File[]): Promise<void> {
  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'obj' || ext === 'stl') {
      const msg = t('import.soon', { format: ext.toUpperCase() });
      ctx.ui.set({ importMessage: msg });
      ctx.ui.toast(msg);
      continue;
    }
    if (ext !== 'glb' && ext !== 'gltf') {
      const msg = t('import.unknown', { name: file.name });
      ctx.ui.set({ importMessage: msg });
      ctx.ui.toast(msg);
      continue;
    }
    ctx.ui.set({ importMessage: t('import.busy', { name: file.name }) });
    try {
      const payload = await ctx.services.importFile(file);
      const replace = ctx.store.get().scene.roots.length === 0;
      ctx.store.transaction(L('undo.import', { name: file.name }), () => {
        ctx.store.dispatch({ type: 'scene/addModel', payload, replace });
        ctx.store.dispatch({ type: 'camera/frame' });
      });
      ctx.ui.set({ importMessage: null });
      ctx.ui.toast(t('import.done', { name: file.name }));
    } catch (err) {
      const msg = t('import.failed', { name: file.name, reason: err instanceof Error ? err.message : String(err) });
      ctx.ui.set({ importMessage: msg });
      ctx.ui.toast(msg);
    }
  }
}

export async function importDialog(ctx: Ctx): Promise<void> {
  const files = await pickFiles(MODEL_ACCEPT);
  if (files.length) await importFiles(ctx, files);
}

export function newProject(ctx: Ctx): void {
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
  const target = ids ?? selectedNodes(s);
  ctx.store.dispatch({ type: 'scene/restOnFloor', ids: target, label: L('undo.rest', { target: targetLabel(s, target) }) });
}

export function centerSelection(ctx: Ctx, ids?: NodeId[]): void {
  const s = ctx.store.get();
  const target = ids ?? selectedNodes(s);
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
    ? L('inspector.faces', { n: base.faces.indices.length, part: s.scene.nodes[base.faces.part]?.name ?? '' })
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
