// Settings ▸ AI post-processing (UI.md §2.9, AI-POST.md §2.2–§2.4 and §5),
// in this order: Active model (the model in use and its configuration),
// Models (every model of the catalogue and the imported ones, with their
// state, downloads, licences accepted before the first download, Use and
// Delete, Import model…), and Hardware (what was detected and the
// recommendation, with the row of the table that decides it). While the
// pipeline of phase X3 does not exist the section says so in one line, and
// everything else works. Every size comes from the data, every speed and
// time left from the bytes that arrived (io/downloads.ts).

import type { Recommendation } from '../../core/ai-recommend';
import type { AiRuntimeReport } from '../../core/ai-runtimes';
import { aiRuntime, AI_RUNTIMES } from '../../data/ai-runtimes';
import type { AiRecommendRow } from '../../data/ai-models';
import {
  activeModel,
  allModels,
  blobsToDelete,
  FILE_ROLES,
  fallbackActive,
  findModel,
  fitsMemory,
  formatBytes,
  IMPORT_FAMILIES,
  IMPORT_ROLES,
  MANIFEST_FORMAT,
  modelState,
  recommendationView,
  rowBadges,
  runsHere,
  type ImportOutcome,
  type ManifestProblem,
  type ModelState,
  type ModelsSnapshot,
  type ModelView,
} from '../../core/models';
import { composePrompt, DEFAULT_SYSTEM_PROMPT, isDefaultSystemPrompt, MAX_SYSTEM_PROMPT, normaliseSystemPrompt, SHORT_SYSTEM_PROMPT } from '../../core/ai-prompt';
import type { RowMeta, SettingMeta } from '../../core/settings';
import { aiRuntimeQuery, promptContext, recommendationOf } from '../ai-query';
import { openVcRuntime, runtimeActions, runtimeWatch, startChosenRuntime, type RuntimeAction } from '../ai-runtime-state';
import { runtimeNotice } from './ai-runtime-notice';
import * as cmd from '../commands';
import { select, textArea, textField, toggle } from '../components/controls';
import { showConfirmIn } from '../components/widgets';
import { h, icon } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { formatNumber, getLang, lbl, t } from '../strings';
import type { UiState } from '../ui-state';
import { formatDuration } from './render-window';
import { infoRow, rowLabel, rowShell, settingRow } from './settings-rows';
import { licenceDetails, MODEL_LICENCE_PATHS, type SettingsHooks } from './settings-sections';

const size = (bytes: number) => formatBytes(bytes, getLang());
/** Why there is no model store, in words. */
const storeReason = (code: string) => (code === 'opfs' ? t('set.ai.noOpfs') : code);
const pct = (done: number, total: number) => (total > 0 ? Math.floor((100 * done) / total) : 0);

// The Runtime row's buttons and the page of Microsoft's Visual C++ runtime moved to ui/ai-runtime-state.ts with the
// warnings that use them too (phase U10); they are still exported from here.
export { openVcRuntime, runtimeActions, VC_RUNTIME_URL, type RuntimeAction } from '../ai-runtime-state';

/** The recommendation for what was detected, by the rule of the catalogue (P2's core/ai-recommend.ts). */
export function currentRecommendation(ctx: Ctx): Recommendation | null {
  return recommendationOf(ctx.ui.get());
}


const modelName = (m: ModelView) => lbl(m.label);

/** "GPU with 6–12 GB": a row of the recommendation table, from its data. */
export function tableRowText(row: AiRecommendRow | undefined): string {
  if (!row) return '–';
  const n = (v: number) => formatNumber(v, getLang(), 1);
  if (row.device === 'web') return row.webgpu ? t('set.hw.rowWebGpu', { min: n(row.minBufferGiB ?? 0) }) : t('set.hw.rowWebNone');
  const min = row.minGiB ?? 0;
  const max = row.maxGiB ?? null;
  const gpu = row.device === 'gpu';
  if (max === null) return t(gpu ? 'set.hw.rowGpuMin' : 'set.hw.rowCpuMin', { min: n(min) });
  if (min <= 0) return t(gpu ? 'set.hw.rowGpuMax' : 'set.hw.rowCpuMax', { max: n(max) });
  return t(gpu ? 'set.hw.rowGpuRange' : 'set.hw.rowCpuRange', { min: n(min), max: n(max) });
}

/** The state of a model row as text: "Downloading 42 % · 1.2 GB of 6.4 GB · 12 MB/s · 3 min". */
export function stateText(st: ModelState, model: ModelView, here: 'web' | 'desktop'): string {
  if (!runsHere(model, here) && st.kind !== 'READY' && st.kind !== 'IN_USE' && st.kind !== 'UNAVAILABLE') return t('set.ai.state.desktopOnly');
  switch (st.kind) {
    case 'UNAVAILABLE':
      return st.reason ? `${t('set.ai.state.UNAVAILABLE')} (${lbl(st.reason)})` : t('set.ai.state.UNAVAILABLE');
    case 'NOT_DOWNLOADED':
      return st.done > 0 ? t('set.ai.state.kept', { done: size(st.done) }) : t('set.ai.state.NOT_DOWNLOADED');
    case 'QUEUED':
      return t('set.ai.state.QUEUED', { pct: pct(st.done, st.total) });
    case 'DOWNLOADING': {
      const parts = [t('set.ai.state.DOWNLOADING', { pct: pct(st.done, st.total), done: size(st.done), total: size(st.total) })];
      if (st.bytesPerSecond !== null) parts.push(t('set.ai.state.speed', { rate: size(st.bytesPerSecond) }));
      if (st.etaSeconds !== null) parts.push(formatDuration(st.etaSeconds));
      return parts.join(' · ');
    }
    case 'PAUSED':
      return st.error && st.error !== 'damaged' ? t('set.ai.state.pausedError', { pct: pct(st.done, st.total), error: st.error }) : t('set.ai.state.PAUSED', { pct: pct(st.done, st.total) });
    case 'VERIFYING':
      return t('set.ai.state.VERIFYING');
    case 'READY':
      return t('set.ai.state.READY');
    case 'IN_USE':
      return t('set.ai.state.IN_USE');
    case 'DAMAGED':
      return t('set.ai.state.DAMAGED', { files: st.files.join(', ') });
  }
}

/** The recommendation as a sentence, with the row of the table that decides it (Hardware, and the Models list). */
export function recommendationSentence(ctx: Ctx): { view: ReturnType<typeof recommendationView>; text: string; nameOf: (k: string) => string } {
  const u = ctx.ui.get();
  const snap = u.models;
  const info = u.hardware.info;
  const rec = currentRecommendation(ctx);
  const view = recommendationView(rec);
  const tableRow = rec?.rowId ? snap?.catalogue.recommendation.find((r) => r.id === rec.rowId) : undefined;
  const nameOf = (k: string) => {
    const m = snap ? findModel(snap, k) : undefined;
    return m ? modelName(m) : k;
  };
  let text: string;
  switch (view.kind) {
    case 'FAILED':
      text = info?.detected && snap && snap.catalogue.recommendation.length === 0 ? t('set.hw.recNoTable') : t('set.hw.recFailed');
      break;
    case 'NO_ROW':
      text = t('set.hw.recNoRow');
      break;
    case 'NONE':
      text = t('set.hw.recNone', { row: tableRowText(tableRow) });
      break;
    case 'MODEL':
      text = t('set.hw.recModel', { name: nameOf(view.key), row: tableRowText(tableRow) });
      break;
  }
  return { view, text, nameOf };
}

// ------------------------------------------------------------------ Active model

function activeRow(ctx: Ctx, scope: Scope): HTMLElement {
  const name = h('div', { class: 'sw-strong' });
  const line = h('div', { class: 'note tabular' });
  const precision = h('div', { class: 'note' });
  const warn = h('div', { class: 'sw-warn', role: 'status' });
  const parts = rowShell('ai.active', { control: null, wide: true });
  parts.el.append(h('div', { class: 'sw-active' }, name, line, precision, warn));
  scope.watch(
    (_s, u) => [u.models, u.hardware, u.settings['ai.active'], u.settings['ai.device'], u.settings['ai.gpu']] as const,
    () => {
      const u = ctx.ui.get();
      const snap = u.models;
      if (!snap || !snap.ready) {
        name.textContent = t('set.ai.none');
        line.textContent = snap?.error ? t('set.ai.noStore', { reason: storeReason(snap.error) }) : t('set.ai.loading');
        precision.textContent = '';
        warn.replaceChildren();
        return;
      }
      const models = allModels(snap);
      const rec = currentRecommendation(ctx);
      const key = activeModel(u.settings['ai.active'], models, snap.installed, rec);
      const m = key ? models.find((x) => x.key === key) : undefined;
      parts.el.dataset.active = key;
      if (!m) {
        const r = rec?.recommended ? findModel(snap, rec.recommended) : undefined;
        name.textContent = t('set.ai.none');
        line.textContent = r ? t('set.ai.noneRec', { name: modelName(r) }) : t('set.ai.noneNoRec');
        precision.textContent = '';
        warn.replaceChildren();
        return;
      }
      name.replaceChildren(modelName(m), ...(m.commercial ? [] : [h('span', { class: 'sw-badge aux' }, t('set.ai.noncommercial'))]));
      line.textContent = t('set.ai.activeLine', { quant: m.quantization, licence: m.licence.spdx, size: size(m.totalBytes) });
      precision.textContent = `${t('set.ai.precision')}: ${t('set.ai.precisionOne', { quant: m.quantization })}`;
      const fit = fitsMemory(m, u.hardware.info, u.settings['ai.device'], u.settings['ai.gpu']);
      warn.replaceChildren(...(fit && !fit.fits ? [h('span', { class: 'sw-warn-dot', 'aria-hidden': 'true' }), t('set.ai.doesNotFit', { need: formatNumber(fit.needGiB, getLang(), 1), what: t(u.settings['ai.device'] === 'GPU' ? 'set.ai.vram' : 'set.ai.ram'), have: formatNumber(fit.haveGiB, getLang(), 1) })] : []));
    },
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return parts.el;
}

/**
 * What stands for the graphics card when none is listed: still detecting, the whole detection failed, the launcher
 * could not ask for the graphics cards at all (desktop), or it asked and there is none. Only the last one is "no
 * graphics card"; the others are not facts about the computer.
 */
export function noGpuText(hw: UiState['hardware']): string {
  if (hw.state !== 'DONE') return t('set.hw.detecting');
  const info = hw.info;
  if (!info || !info.detected) return t('set.hw.notDetected');
  if (info.where === 'desktop') return info.gpuDetectionFailed ? t('set.hw.gpuFailed') : t('set.hw.noGpu');
  return t('set.hw.notReported');
}

/**
 * Which GPU (desktop only): the graphics cards the launcher detected (`/api/hardware`, names and VRAM), kept in
 * step with the detection, which may answer after the section is drawn ("Detecting…" until then).
 */
function gpuRow(ctx: Ctx, scope: Scope, row: RowMeta): HTMLElement | null {
  if (!ctx.ui.get().desktop) return null;
  const host = h('div', { class: 'sw-gpu' });
  scope.watch(
    (_s, u) => [u.hardware, u.settings['ai.gpu']] as const,
    ([hw, chosen]) => {
      const gpus = hw.info?.gpus ?? [];
      const sel = select(
        gpus.length
          ? gpus.map((g, i) => ({ value: String(i), label: g.vramGiB !== null ? `${g.name} · ${t('set.hw.gib', { n: formatNumber(g.vramGiB, getLang(), 1) })}` : g.name }))
          : [{ value: '0', label: noGpuText(hw), disabled: true }],
        String(Math.min(chosen, Math.max(0, gpus.length - 1))),
        (v) => cmd.setSetting(ctx, 'ai.gpu', Number(v)),
        rowLabel('ai.gpu'),
      );
      (sel.el as HTMLSelectElement).disabled = gpus.length < 2;
      host.dataset.gpus = String(gpus.length);
      host.replaceChildren(sel.el);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  return settingRow(ctx, scope, row as SettingMeta, { control: host, visible: (s) => s['ai.device'] === 'GPU' });
}

// ------------------------------------------------------------------ Models

/** A RAIL licence's use restrictions: its Attachment A, to the end (the whole text when it has none). */
export function useRestrictionsOf(text: string): string {
  const at = text.search(/^\s*Attachment A\s*$/m);
  return at >= 0 ? text.slice(at).trim() : text;
}

function licencePanel(ctx: Ctx, m: ModelView, onAccept: () => void, onCancel: () => void): HTMLElement {
  const path = MODEL_LICENCE_PATHS[m.licence.spdx];
  const restrictions = h('pre', { class: 'sw-licence-text' }, t('set.ai.loadingText'));
  if (m.licence.useRestrictions) {
    void (path ? ctx.services.licenceText(path) : Promise.resolve(null)).then((text) => {
      // The use restrictions are the licence's Attachment A: shown in full before the download.
      restrictions.textContent = text ? useRestrictionsOf(text) : t('set.ai.textMissing');
    });
  }
  const accept = h('button', { type: 'button', class: 'btn btn-primary', onclick: onAccept }, t('set.ai.accept'));
  const el = h(
    'div',
    { class: 'sw-licence-panel', role: 'region', 'aria-label': t('set.ai.licenceTitle', { name: modelName(m) }) },
    h('div', { class: 'sw-strong' }, t('set.ai.licenceTitle', { name: modelName(m) })),
    h('p', { class: 'note' }, t('set.ai.licenceIntro', { spdx: m.licence.spdx })),
    h('p', { class: 'note' }, m.commercial ? t('set.ai.licenceCommercial') : t('set.ai.licenceNoCommercial')),
    ...(m.licence.useRestrictions ? [h('p', { class: 'note sw-strong' }, t('set.ai.licenceRestrictions')), restrictions] : []),
    path ? licenceDetails(ctx, t('set.ai.licenceFull'), path) : h('p', { class: 'note' }, t('set.ai.textMissing')),
    h('p', { class: 'note' }, `${t('set.ai.licenceSource')}: `, h('a', { href: m.licence.url, target: '_blank', rel: 'noopener noreferrer', class: 'sw-link' }, m.licence.url)),
    h('div', { class: 'sw-inline' }, accept, h('button', { type: 'button', class: 'btn', onclick: onCancel }, t('common.cancel'))),
  );
  queueMicrotask(() => accept.focus());
  return el;
}

function modelRow(ctx: Ctx, key: string): { el: HTMLElement; update(snap: ModelsSnapshot, rec: Recommendation | null): void } {
  const nameEl = h('div', { class: 'sw-model-name' });
  const meta = h('div', { class: 'note tabular' });
  const stateEl = h('div', { class: 'sw-model-state note tabular', 'aria-live': 'off' });
  const bar = h('div', { class: 'sw-bar', 'aria-hidden': 'true' }, h('span'));
  const actions = h('div', { class: 'sw-model-actions' });
  const panel = h('div', { class: 'sw-model-panel' });
  const el = h('div', { class: 'sw-model', 'data-model': key, role: 'listitem' }, h('div', { class: 'sw-model-main' }, nameEl, meta, stateEl, bar), actions, panel);
  const svc = ctx.services.models!;
  let lastKind = '';
  let lastBadges = '';

  const remove = (m: ModelView, snap: ModelsSnapshot) => {
    const keep = Object.keys(snap.downloads).filter((k) => k !== m.key);
    const freed = blobsToDelete(allModels(snap), snap.installed, m.key, keep).reduce((a, sha) => a + (m.files.find((f) => f.sha256 === sha)?.bytes ?? 0), 0);
    showConfirmIn(panel, {
      message: t('set.ai.deleteConfirm', { name: modelName(m), size: size(freed) }),
      options: [
        {
          label: t('set.ai.delete'),
          primary: true,
          run: async () => {
            const wasActive = activeModel(ctx.ui.get().settings['ai.active'], allModels(snap), snap.installed, currentRecommendation(ctx)) === m.key;
            await svc.remove(m.key);
            // Deleting the model in use falls back to the recommendation (or the default), never to a noncommercial one.
            if (wasActive || ctx.ui.get().settings['ai.active'] === m.key) {
              const now = svc.snapshot();
              cmd.setSetting(ctx, 'ai.active', fallbackActive(allModels(now), now.installed, currentRecommendation(ctx), m.key));
            }
          },
        },
      ],
    });
  };
  const download = async (m: ModelView) => {
    const r = await svc.download(m.key);
    // The first start's chooser: the runtime the models need goes down with the first model started (U10).
    if (r === 'started') void startChosenRuntime(ctx);
    if (r === 'needsLicence') {
      panel.replaceChildren(
        licencePanel(
          ctx,
          m,
          () => {
            panel.replaceChildren();
            svc.acceptLicence(m.key);
            void svc.download(m.key);
            void startChosenRuntime(ctx);
          },
          () => panel.replaceChildren(),
        ),
      );
    }
  };
  const button = (label: string, run: () => void, primary = false, iconName?: Parameters<typeof icon>[0]) => h('button', { type: 'button', class: `btn btn-sm${primary ? ' btn-primary' : ''}`, 'aria-label': `${label}: ${nameEl.textContent ?? ''}`, onclick: run }, iconName ? icon(iconName, 14) : null, label);

  return {
    el,
    update(snap, rec) {
      const m = findModel(snap, key);
      if (!m) return;
      const here: 'web' | 'desktop' = ctx.ui.get().desktop ? 'desktop' : 'web';
      const active = activeModel(ctx.ui.get().settings['ai.active'], allModels(snap), snap.installed, rec);
      const st = modelState(m, snap, active);
      const b = rowBadges(m, rec);
      const badgeKey = JSON.stringify([b, m.isDefault, m.source, getLang()]);
      if (badgeKey !== lastBadges) {
        lastBadges = badgeKey;
        nameEl.replaceChildren(
          h('span', null, modelName(m)),
          ...[
            b.recommended ? t('set.ai.recommended') : null,
            !b.recommended && b.offered ? t('set.ai.offered') : null,
            m.isDefault ? t('set.ai.default') : null,
            m.source === 'imported' ? t('set.ai.imported') : null,
            b.noncommercial ? t('set.ai.noncommercial') : null,
            b.restrictions ? t('set.ai.restrictions') : null,
          ]
            .filter((x): x is string => x !== null)
            .map((x, i) => h('span', { class: `sw-badge aux${i === 0 && b.recommended ? ' is-strong' : ''}` }, x)),
        );
        meta.textContent = [t(dyn(`set.ai.family.${m.family}`)), m.quantization, m.licence.spdx, size(m.totalBytes)].join(' · ');
        el.toggleAttribute('data-recommended', b.recommended);
      }
      stateEl.textContent = stateText(st, m, here);
      el.dataset.state = st.kind;
      const progress = st.kind === 'DOWNLOADING' || st.kind === 'PAUSED' || st.kind === 'QUEUED' || st.kind === 'VERIFYING' ? pct(st.done, st.total) : null;
      bar.style.display = progress === null ? 'none' : '';
      (bar.firstElementChild as HTMLElement).style.width = `${progress ?? 0}%`;
      if (st.kind === 'DOWNLOADING') el.dataset.done = String(st.done);
      const runnable = runsHere(m, here);
      const kind = `${st.kind}|${runnable}|${snap.ready}`;
      if (kind === lastKind) return;
      lastKind = kind;
      const focused = actions.contains(document.activeElement) ? (document.activeElement as HTMLElement).textContent : null;
      const list: HTMLElement[] = [];
      if (snap.ready) {
        switch (st.kind) {
          case 'NOT_DOWNLOADED':
            if (runnable && m.source === 'catalogue') list.push(button(t('set.ai.download'), () => void download(m), true, 'download'));
            break;
          case 'QUEUED':
          case 'DOWNLOADING':
            list.push(button(t('set.ai.pause'), () => svc.pause(key), false, 'pause'));
            list.push(button(t('set.ai.cancel'), () => showConfirmIn(panel, { message: t('set.ai.cancelConfirm', { name: modelName(m) }), options: [{ label: t('set.ai.cancel'), primary: true, run: () => void svc.cancel(key) }], cancelLabel: t('common.no') })));
            break;
          case 'PAUSED':
            list.push(button(t('set.ai.resume'), () => svc.resume(key), true, 'play'));
            list.push(button(t('set.ai.cancel'), () => showConfirmIn(panel, { message: t('set.ai.cancelConfirm', { name: modelName(m) }), options: [{ label: t('set.ai.cancel'), primary: true, run: () => void svc.cancel(key) }], cancelLabel: t('common.no') })));
            break;
          case 'DAMAGED':
            if (runnable && m.source === 'catalogue') list.push(button(t('set.ai.retry'), () => void download(m), true, 'download'));
            list.push(button(t('set.ai.cancel'), () => void svc.cancel(key)));
            break;
          case 'READY':
            list.push(button(t('set.ai.use'), () => cmd.setSetting(ctx, 'ai.active', key), true));
            list.push(button(t('set.ai.delete'), () => remove(m, svc.snapshot()), false, 'trash'));
            break;
          case 'IN_USE':
            list.push(button(t('set.ai.delete'), () => remove(m, svc.snapshot()), false, 'trash'));
            break;
          default:
            break;
        }
      }
      actions.replaceChildren(...list);
      if (focused) (list.find((b) => b.textContent === focused) ?? list[0])?.focus();
    },
  };
}

/** One problem of an import, as a sentence. */
function problemText(p: ManifestProblem): string {
  if ('file' in p) return t(dyn(`set.ai.problem.${p.code}`), { file: p.file });
  if (p.code === 'notManifest') return t('set.ai.problem.notManifest');
  return t(dyn(`set.ai.problem.${p.code}`), { field: p.field });
}

function outcomeText(o: ImportOutcome): string {
  if (o.kind === 'rejected') return t('set.ai.importFailed', { reason: o.problems.map(problemText).join('; ') });
  if (o.kind === 'failed') return t('set.ai.importFailed', { reason: t(dyn(`set.ai.fail.${o.reason}`), { file: o.file ?? '', message: o.message ?? '' }) });
  return '';
}

/** The inline form that fills a missing model.repackshot.json (AI-POST.md §5). */
function manifestForm(ctx: Ctx, files: readonly File[], listed: { name: string; bytes: number }[], done: (o: ImportOutcome) => void): HTMLElement {
  const svc = ctx.services.models!;
  const values = { name: listed[0]?.name.replace(/\.[^.]+$/, '') ?? '', family: 'sdxl', role: 'img2img', quantization: '', spdx: '', url: '', commercial: false, textPrompt: true, source: '' };
  const roles = listed.map(() => 'transformer');
  const text = (k: 'name' | 'quantization' | 'spdx' | 'url' | 'source') => {
    const f = textField(values[k], (v) => (values[k] = v), t(dyn(`set.ai.form.${k}`)));
    f.el.addEventListener('input', () => (values[k] = (f.el as HTMLInputElement).value));
    return f.el;
  };
  const field = (label: string, control: Node) => h('label', { class: 'sw-form-field' }, h('span', { class: 'note' }, label), control);
  const errors = h('div', { class: 'sw-warn', role: 'alert' });
  // X4b: whether the model follows a text prompt (the job's own is sent to it), as its manifest's `capabilities`.
  const textPromptToggle = toggle(true, (v) => {
    values.textPrompt = v;
    textPromptToggle.set(v);
  }, t('set.ai.form.textPrompt'));
  const form = h(
    'form',
    { class: 'sw-form', 'aria-label': t('set.ai.formTitle') },
    h('div', { class: 'sw-strong' }, t('set.ai.formTitle')),
    h('p', { class: 'note' }, t('set.ai.formIntro')),
    field(t('set.ai.form.name'), text('name')),
    field(t('set.ai.form.family'), select(IMPORT_FAMILIES.map((f) => ({ value: f, label: t(dyn(`set.ai.family.${f}`)) })), values.family, (v) => (values.family = v), t('set.ai.form.family')).el),
    field(t('set.ai.form.role'), select(IMPORT_ROLES.map((r) => ({ value: r, label: t(dyn(`set.ai.role.${r}`)) })), values.role, (v) => (values.role = v), t('set.ai.form.role')).el),
    field(t('set.ai.form.quantization'), text('quantization')),
    field(t('set.ai.form.spdx'), text('spdx')),
    field(t('set.ai.form.url'), text('url')),
    h('div', { class: 'sw-form-field sw-inline' }, toggle(false, () => {}, t('set.ai.form.commercial')).el, h('span', { class: 'note' }, t('set.ai.form.commercial'))),
    h('div', { class: 'sw-form-field sw-inline', 'data-form': 'textPrompt' }, textPromptToggle.el, h('span', { class: 'note' }, t('set.ai.form.textPrompt'))),
    field(t('set.ai.form.source'), text('source')),
    ...listed.map((f, i) => field(t('set.ai.form.fileRole', { file: f.name }), select(FILE_ROLES.map((r) => ({ value: r, label: t(dyn(`set.ai.fileRole.${r}`)) })), roles[i], (v) => (roles[i] = v), t('set.ai.form.fileRole', { file: f.name })).el)),
    errors,
    h('div', { class: 'sw-inline' }, h('button', { type: 'submit', class: 'btn btn-primary' }, t('set.ai.form.import')), h('button', { type: 'button', class: 'btn', onclick: () => done({ kind: 'rejected', problems: [] }) }, t('common.cancel'))),
  );
  const commercialToggle = form.querySelector('.toggle') as HTMLButtonElement;
  commercialToggle.addEventListener('click', () => {
    values.commercial = !values.commercial;
    commercialToggle.setAttribute('aria-checked', String(values.commercial));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const manifest = {
      format: MANIFEST_FORMAT,
      schema: 1,
      name: values.name,
      family: values.family,
      role: values.role,
      quantization: values.quantization,
      licence: { spdx: values.spdx, url: values.url, commercialUse: values.commercial },
      files: listed.map((f, i) => ({ name: f.name, role: roles[i], bytes: f.bytes })),
      capabilities: { textPrompt: values.textPrompt },
      source: values.source,
    };
    const r = await svc.importFiles(files, manifest);
    if (r.kind === 'rejected' && r.problems.length > 0) errors.textContent = outcomeText(r);
    else done(r);
  });
  return form;
}

function modelsBlock(ctx: Ctx, scope: Scope): HTMLElement {
  const svc = ctx.services.models;
  const where = h('p', { class: 'note' });
  const recLine = h('p', { class: 'note sw-rec-line', 'aria-live': 'polite' });
  const list = h('div', { class: 'sw-models', role: 'list', 'aria-label': t('set.ai.models') });
  const rows = new Map<string, ReturnType<typeof modelRow>>();
  const importStatus = h('div', { class: 'note', role: 'status', 'aria-live': 'polite' });
  const importPanel = h('div', { class: 'sw-import-panel' });
  const imported = async (files: File[]) => {
    if (!files.length || !svc) return;
    importPanel.replaceChildren();
    const handle = (r: ImportOutcome) => {
      if (r.kind === 'needsManifest') importPanel.replaceChildren(manifestForm(ctx, files, r.files, handle));
      else {
        importPanel.replaceChildren();
        if (r.kind === 'done') {
          const m = findModel(svc.snapshot(), r.key);
          importStatus.textContent = t('set.ai.importDone', { name: m ? modelName(m) : r.key });
        } else importStatus.textContent = outcomeText(r);
      }
    };
    handle(await svc.importFiles(files, null));
  };
  const pick = (folder: boolean) => {
    // The desktop: the system's dialogs, and the files stay in the launcher (read in ranges, hashed there: tens of GB).
    const dialogs = ctx.services.dialogs;
    if (dialogs) {
      const chosen = folder
        ? dialogs.openFolderFiles({ title: t('dialog.importAiFolder'), folderItem: t('dialog.folderItem') })
        : dialogs.openFiles({ title: t('dialog.importAiFiles'), multiple: true, lazy: true, filters: [{ name: t('dialog.aiFiles'), extensions: ['safetensors', 'gguf', 'onnx', 'onnx_data', 'json', 'txt'] }, { name: t('dialog.allFiles'), extensions: ['*'] }] });
      void chosen.then((files) => imported(files ?? []));
      return;
    }
    const input = h('input', { type: 'file', multiple: true, style: 'display:none' }) as HTMLInputElement;
    if (folder) input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => {
      const files = input.files ? [...input.files] : [];
      input.remove();
      void imported(files);
    });
    document.body.appendChild(input);
    input.click();
  };
  const importBtn = h('button', { type: 'button', class: 'btn', onclick: () => pick(false), disabled: !svc }, icon('upload', 14), t('set.ai.importFiles'));
  const folderBtn = h('button', { type: 'button', class: 'btn', onclick: () => pick(true), disabled: !svc }, icon('folder', 14), t('set.ai.importFolder'));
  const importRow = h('div', { class: 'sw-row is-wide', 'data-row': 'ai.import' }, h('div', { class: 'sw-inline' }, importBtn, folderBtn), h('p', { class: 'note' }, t('set.ai.importHint')), importStatus, importPanel);
  scope.watch(
    (_s, u) => [u.models, u.hardware, u.settings['ai.active'], u.settings['ai.device'], u.settings['ai.gpu']] as const,
    () => {
      const u = ctx.ui.get();
      const snap = u.models;
      if (!snap) {
        where.textContent = t('set.ai.noStore', { reason: '–' });
        list.replaceChildren();
        return;
      }
      where.textContent = snap.error ? t('set.ai.noStore', { reason: storeReason(snap.error) }) : !snap.ready ? t('set.ai.loading') : snap.kind === 'native' ? t('set.ai.whereDesktop', { dir: snap.location ?? '' }) : snap.kind === 'memory' ? t('set.ai.whereMemory') : t('set.ai.whereWeb');
      // The desktop lists what can run there: a model made only for the browser (the web build) is not one.
      const here: 'web' | 'desktop' = u.desktop ? 'desktop' : 'web';
      const keys = allModels(snap)
        .filter((m) => here === 'web' || runsHere(m, 'desktop') || snap.installed.includes(m.key))
        .map((m) => m.key);
      if (keys.join('|') !== [...rows.keys()].join('|')) {
        for (const k of [...rows.keys()]) if (!keys.includes(k)) rows.delete(k);
        for (const k of keys) if (!rows.has(k)) rows.set(k, modelRow(ctx, k));
        list.replaceChildren(...(keys.length ? keys.map((k) => rows.get(k)!.el) : [h('p', { class: 'note' }, t('set.ai.noModels'))]));
      }
      const rec = currentRecommendation(ctx);
      for (const r of rows.values()) r.update(snap, rec);
      recLine.textContent = u.hardware.state === 'DONE' ? t('set.hw.recLine', { text: recommendationSentence(ctx).text }) : t('set.hw.detecting');
      const imp = snap.importing;
      if (imp) importStatus.textContent = t('set.ai.importing', { phase: imp.phase === 'HASHING' ? t('set.ai.importHashing') : t('set.ai.importCopying'), name: imp.name, pct: pct(imp.done, imp.total) });
    },
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return h('section', { class: 'sw-block', 'data-block': 'models', 'data-part': 'ai.models', 'aria-labelledby': 'sw-b-models' }, h('h4', { class: 'sw-block-title aux', id: 'sw-b-models' }, t('set.block.models')), where, recLine, h('div', { 'data-row': 'ai.models' }, chooserBanner(ctx, scope), list), importRow);
}

// ------------------------------------------------------------------ Hardware

function hardwareBlock(ctx: Ctx, scope: Scope): HTMLElement {
  const body = h('div', { class: 'sw-hw' });
  scope.watch(
    (_s, u) => [u.hardware, u.models, u.settings['ai.device'], u.settings['ai.gpu']] as const,
    () => {
      const u = ctx.ui.get();
      const hw = u.hardware;
      if (hw.state !== 'DONE') {
        body.replaceChildren(h('p', { class: 'note' }, t('set.hw.detecting')));
        return;
      }
      const info = hw.info;
      const missing = info?.where === 'desktop' ? t('set.hw.notDetected') : t('set.hw.notReported');
      const gib = (v: number | null) => (v === null ? missing : t('set.hw.gib', { n: formatNumber(v, getLang(), 1) }));
      const rows: HTMLElement[] = [];
      if (!info || !info.detected) rows.push(h('p', { class: 'sw-warn', role: 'status' }, t('set.hw.failed', { reason: info?.error ?? '–' })));
      if (info) {
        const g = info.gpus[Math.min(u.settings['ai.gpu'], Math.max(0, info.gpus.length - 1))];
        if (info.cpu) rows.push(infoRow('hw.cpu', t('set.hw.cpu'), info.cpu));
        rows.push(infoRow('hw.gpu', t('set.hw.gpu'), g?.name ?? (info.detected ? noGpuText(hw) : missing)));
        if (info.where === 'desktop' && info.device === 'cpu' && u.settings['ai.device'] === 'GPU') rows.push(h('p', { class: 'note' }, t('set.hw.noUsableGpu')));
        rows.push(infoRow('hw.vram', t('set.hw.vram'), gib(g?.vramGiB ?? null)));
        rows.push(infoRow('hw.ram', t('set.hw.ram'), info.ramGiB === null ? missing : info.ramCapped ? t('set.hw.ramCapped', { n: formatNumber(info.ramGiB, getLang(), 0) }) : gib(info.ramGiB)));
        rows.push(infoRow('hw.cores', t('set.hw.cores'), info.cores === null ? missing : String(info.cores)));
        if (info.where === 'web') {
          rows.push(infoRow('hw.webgpu', t('set.hw.webgpu'), info.webgpu === null ? t('set.hw.notReported') : info.webgpu ? t('common.yes') : t('common.no')));
          rows.push(infoRow('hw.maxBuffer', t('set.hw.maxBuffer'), info.maxBufferBytes === null ? t('set.hw.notReported') : size(info.maxBufferBytes)));
        }
      }
      const { view, text: recText, nameOf } = recommendationSentence(ctx);
      const recRow = infoRow('hw.recommendation', t('set.hw.recommendation'), h('span', { class: 'sw-strong', 'data-rec': view.kind === 'MODEL' ? view.key : view.kind }, recText));
      if ((view.kind === 'NONE' || view.kind === 'MODEL') && view.skipped.length > 0) recRow.querySelector('.sw-aux')?.replaceChildren(t('set.hw.recSkipped', { names: view.skipped.map(nameOf).join(', ') }));
      const aux = recRow.querySelector('.sw-aux') as HTMLElement | null;
      if (aux) aux.style.display = aux.textContent ? '' : 'none';
      rows.push(recRow);
      if (info?.where === 'web' && info.webgpu === false) rows.push(h('p', { class: 'note' }, t('set.hw.webCannot')));
      rows.push(h('div', { class: 'sw-inline' }, h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'hw-again', onclick: () => void cmd.detectHardware(ctx, true) }, t('set.hw.again'))));
      body.replaceChildren(...rows);
    },
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return h('section', { class: 'sw-block', 'data-block': 'hardware', 'data-part': 'ai.hardware', 'aria-labelledby': 'sw-b-hardware' }, h('h4', { class: 'sw-block-title aux', id: 'sw-b-hardware' }, t('set.block.hardware')), h('div', { 'data-row': 'ai.hardware' }, body));
}

/** Advanced: guard tolerances, folded by default. */
function guardBlock(ctx: Ctx, scope: Scope, rows: RowMeta[]): HTMLElement {
  const det = h('details', { class: 'sw-block sw-advanced', 'data-block': 'guard' }, h('summary', { class: 'sw-block-title aux' }, t('set.block.guard')), ...rows.map((r) => settingRow(ctx, scope, r as SettingMeta))) as HTMLDetailsElement;
  if (ctx.ui.get().settingsWindow?.focus?.startsWith('ai.guard')) det.open = true;
  return det;
}

/** "Post-processing arrives in a coming version", where the pipeline is not built (the web before X3d): the service says. */
function aiTop(ctx: Ctx, scope: Scope): HTMLElement {
  void cmd.detectHardware(ctx);
  const note = h('p', { class: 'note sw-ai-soon' }, t('set.ai.soon'));
  const service = ctx.services.ai?.service;
  if (service) {
    note.style.display = 'none';
    void service
      .status()
      .then((st) => (note.style.display = st.reason === 'NOT_BUILT' ? '' : 'none'))
      .catch(() => (note.style.display = ''));
  }
  // A model is installed and the inference runtime is not (or does not start): the first thing the section says (U10).
  return h('div', { class: 'sw-ai-top' }, runtimeNotice(ctx, scope, 'settings'), note);
}

/** The desktop portable's first start (AI-POST.md §2.2): at the top of the list, which is where the deep link lands. */
function chooserBanner(ctx: Ctx, scope: Scope): HTMLElement {
  const chooser = h('div', { class: 'sw-chooser', role: 'region', 'aria-label': t('set.ai.chooserTitle') });
  // The inference runtime beside the models (phase U10), as the installer's page offers it: the build the rule chose for
  // this computer, ticked, and the person can untick it. It downloads with the first model the person starts.
  const runtimeRow = h('div', { class: 'sw-chooser-runtime', 'data-chooser-runtime': '', hidden: true });
  const watch = runtimeWatch(ctx);
  const drawRuntime = () => {
    const rt = watch?.report?.runtime;
    const offer = rt && watch?.report?.choice?.key && (rt.state === 'missing' || rt.state === 'paused') ? rt : null;
    runtimeRow.hidden = !offer;
    if (!offer) {
      runtimeRow.replaceChildren();
      return;
    }
    const on = ctx.ui.get().settingsWindow?.chooserRuntime !== false;
    const box = toggle(on, () => {
      const w = ctx.ui.get().settingsWindow;
      if (w) ctx.ui.set({ settingsWindow: { ...w, chooserRuntime: w.chooserRuntime === false } });
    }, t('set.ai.chooserRuntime', { backend: offer.backend === 'VULKAN' ? 'Vulkan' : 'CPU', size: size(offer.bytes) }));
    runtimeRow.replaceChildren(box.el, h('span', { class: 'note' }, t('set.ai.chooserRuntime', { backend: offer.backend === 'VULKAN' ? 'Vulkan' : 'CPU', size: size(offer.bytes) })));
  };
  if (watch) scope.onDispose(watch.subscribe(drawRuntime));
  scope.watch(
    (_s, u) => [u.settingsWindow?.chooser === true, u.settingsWindow?.chooserRuntime !== false] as const,
    ([on]) => {
      chooser.style.display = on ? '' : 'none';
      chooser.replaceChildren(
        ...(on
          ? [
              h('div', { class: 'sw-strong' }, t('set.ai.chooserTitle')),
              h('p', { class: 'note' }, t('set.ai.chooserText')),
              runtimeRow,
              h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.ui.set({ chooserShown: true, settingsWindow: { ...ctx.ui.get().settingsWindow!, chooser: false } }) }, t('set.ai.chooserDone')),
            ]
          : []),
      );
      drawRuntime();
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  return chooser;
}

// ------------------------------------------------------------------ Runtime (desktop: stable-diffusion.cpp, X3b)

const RUNTIME_BUSY = ['downloading', 'verifying', 'installing'];

/**
 * The inference runtime the rule chose (AI-POST.md §7.1): which build and why, its state (downloading with
 * progress, paused, checking, installed with the version it reported), the device it runs on, and Download,
 * Pause, Resume, Remove and Install from a file. Everything shown is what the launcher said.
 */
function runtimeRow(ctx: Ctx, scope: Scope): HTMLElement | null {
  if (!ctx.ui.get().desktop) return null;
  const port = ctx.services.aiRuntime ?? null;
  const name = h('div', { class: 'sw-model-name' });
  const line = h('div', { class: 'sw-model-state note tabular', 'aria-live': 'polite' });
  const why = h('div', { class: 'note' });
  const meta = h('div', { class: 'note tabular' });
  const warn = h('div', { class: 'sw-warn', role: 'status' });
  const bar = h('div', { class: 'sw-bar', 'aria-hidden': 'true' }, h('span'));
  const actions = h('div', { class: 'sw-model-actions' });
  const hint = h('p', { class: 'note' });
  const panel = h('div', { class: 'sw-model-panel' });
  const parts = rowShell('ai.runtime', { control: null, wide: true });
  parts.el.append(h('div', { class: 'sw-model', 'data-runtime': '' }, h('div', { class: 'sw-model-main' }, name, line, why, meta, warn, bar, hint), actions, panel));
  if (!port) {
    line.textContent = t('set.rt.notInLauncher');
    return parts.el;
  }
  const svc = port;
  let report: AiRuntimeReport | null = null;
  let failure: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastActions = '';
  const query = () => aiRuntimeQuery(ctx.ui.get());
  const refresh = async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      report = await svc.status(query());
      failure = null;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    if (disposed) return;
    draw();
    // Quick while something moves, slowly otherwise (the loaded model, an idle release).
    const busy = report?.runtime ? RUNTIME_BUSY.includes(report.runtime.state) : false;
    timer = setTimeout(() => void refresh(), busy ? 400 : 3000);
  };
  const act = (run: () => Promise<unknown>) => () =>
    void run()
      .catch((e: unknown) => {
        failure = e instanceof Error ? e.message : String(e);
      })
      .then(refresh);
  const button = (label: string, run: () => Promise<unknown>, primary = false, iconName?: Parameters<typeof icon>[0]) => h('button', { type: 'button', class: `btn btn-sm${primary ? ' btn-primary' : ''}`, 'aria-label': `${label}: ${t('set.ai.runtime')}`, onclick: act(run) }, iconName ? icon(iconName, 14) : null, label);
  function draw(): void {
    const r = report;
    const rt = r?.runtime ?? null;
    const entry = rt ? aiRuntime(rt.key) : undefined;
    warn.replaceChildren();
    hint.textContent = '';
    bar.style.display = 'none';
    if (!r) {
      name.textContent = 'stable-diffusion.cpp';
      line.textContent = failure ? t('set.rt.unreachable', { error: failure }) : t('set.rt.loading');
      return;
    }
    if (!rt || !r.choice?.key) {
      name.textContent = 'stable-diffusion.cpp';
      line.textContent = t('set.rt.noBuild', { os: r.platform.os, arch: r.platform.arch });
      why.textContent = '';
      meta.textContent = '';
      actions.replaceChildren();
      lastActions = '';
      return;
    }
    name.replaceChildren(h('span', null, entry ? lbl(entry.label) : rt.key), ...(rt.verified.length === 0 ? [h('span', { class: 'sw-badge aux' }, t('set.rt.unverified'))] : []));
    const pctDone = pct(rt.done, rt.total);
    switch (rt.state) {
      case 'missing':
        line.textContent = t('set.rt.state.missing', { size: size(rt.bytes) });
        break;
      case 'downloading':
        line.textContent = t('set.rt.state.downloading', { pct: pctDone, done: size(rt.done), total: size(rt.total) });
        break;
      case 'paused':
        line.textContent = t('set.rt.state.paused', { pct: pctDone });
        break;
      case 'verifying':
        line.textContent = t('set.rt.state.verifying');
        break;
      case 'installing':
        line.textContent = t('set.rt.state.installing');
        break;
      case 'installed': {
        const loaded = r.sidecar.state !== 'stopped' && r.sidecar.label ? ` · ${t('set.rt.loaded', { label: r.sidecar.label })}` : '';
        line.textContent = t('set.rt.state.installed', { version: rt.version ?? '–' }) + loaded;
        break;
      }
    }
    if (rt.state === 'downloading' || rt.state === 'paused' || rt.state === 'verifying') {
      bar.style.display = '';
      (bar.firstElementChild as HTMLElement).style.width = `${pctDone}%`;
    }
    why.textContent = [t(dyn(`set.rt.choice.${r.choice.rowId}`)), r.device ? t('set.rt.device', { device: r.device }) : null].filter((x): x is string => !!x).join(' · ');
    const licence = AI_RUNTIMES.release.licences.map((l) => l.spdx).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    meta.textContent = [t('set.rt.release', { spdx: licence, tag: r.release.tag }), entry ? t('set.rt.requires', { text: lbl(entry.requires) }) : null].filter((x): x is string => !!x).join(' · ');
    const warnings = [
      rt.error ? t('set.rt.failed', { error: rt.error }) : null,
      rt.probeError ? t('set.rt.probeError', { error: rt.probeError }) : null,
      rt.vcRuntime === 'missing' ? t('set.rt.vcRuntime') : null,
      !r.downloader && rt.state !== 'installed' ? t('set.rt.noCurl') : null,
      // AI-POST.md §7.1: a model the installed build does not load says so, with the reason.
      r.reason === 'MODEL_UNSUPPORTED' && r.activeModel ? t('set.rt.modelUnsupported', { name: r.activeModel, reason: r.detail ?? '–' }) : null,
      failure ? t('set.rt.unreachable', { error: failure }) : null,
    ].filter((x): x is string => x !== null);
    warn.replaceChildren(...warnings.flatMap((w) => [h('span', { class: 'sw-warn-dot', 'aria-hidden': 'true' }), w, h('br')]));
    if (rt.state === 'missing' || rt.state === 'paused') hint.textContent = t('set.rt.fromFileHint', { name: rt.name });
    const key = rt.key;
    const actionKey = `${key}|${rt.state}|${rt.vcRuntime === 'missing'}|${getLang()}`;
    if (actionKey === lastActions) return;
    lastActions = actionKey;
    const fromFile = () => button(t('set.rt.fromFile'), () => svc.installFromFile(key, { title: t('dialog.aiRuntime'), filterName: t('dialog.zipFiles') }), false, 'folder');
    const remove = () =>
      h('button', {
        type: 'button',
        class: 'btn btn-sm',
        'aria-label': `${t('set.ai.delete')}: ${t('set.ai.runtime')}`,
        onclick: () => showConfirmIn(panel, { message: t('set.rt.removeConfirm', { size: size(rt.state === 'installed' ? rt.bytes : rt.done) }), options: [{ label: t('set.ai.delete'), primary: true, run: act(() => svc.remove(key)) }] }),
      }, icon('trash', 14), t('set.ai.delete'));
    const make: Record<RuntimeAction, () => HTMLElement> = {
      download: () => button(t('set.ai.download'), () => svc.download(key), true, 'download'),
      fromFile,
      pause: () => button(t('set.ai.pause'), () => svc.pause(key), false, 'pause'),
      resume: () => button(t('set.ai.resume'), () => svc.download(key), true, 'play'),
      remove,
      // The Windows builds need Microsoft's Visual C++ runtime: its official page, in the system's browser.
      vcRuntime: () =>
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', 'data-vc-runtime': '', 'data-tip': t('set.rt.vcRuntimeTip'), onclick: () => void openVcRuntime(ctx, rt).catch(() => undefined) }, icon('download', 14), t('set.rt.vcRuntimeInstall')),
      probe: () => button(t('set.rt.probe'), () => svc.probe(key)),
    };
    const list = runtimeActions(rt).map((a) => make[a]());
    actions.replaceChildren(...list);
  }
  scope.onDispose(() => {
    disposed = true;
    if (timer) clearTimeout(timer);
  });
  scope.watch(
    (_s, u) => [u.settings['ai.backend'], u.settings['ai.device'], u.settings['ai.active'], u.models, u.hardware, getLang()] as const,
    () => void refresh(),
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return parts.el;
}

/**
 * The system prompt line under its field (X4b), for the model in use: a model that reads a limited number of tokens gets
 * the default's short form while the default is unedited, or the person's own text, of which the end is left out when
 * it does not fit even alone (the scene's and the job's words give way first).
 */
export function systemPromptLine(system: string, model: Pick<ModelView, 'label' | 'maxPromptTokens'> | null): string {
  const limit = model?.maxPromptTokens ?? null;
  if (!model || limit === null) return '';
  const name = modelName(model as ModelView);
  if (isDefaultSystemPrompt(system)) return t('set.ai.sp.short', { model: name, limit });
  const fit = composePrompt({ system, scene: '', user: '' }, { textPrompt: true, maxPromptTokens: limit });
  if (fit.cut.system !== 'NONE') return t('set.ai.sp.cut', { model: name, limit });
  return t('set.ai.sp.fit', { model: name, used: fit.tokens + 2, limit });
}

/** Settings ▸ AI post-processing ▸ System prompt (X4b): a multi-line field, Restore default, and what the model in use gets. */
function systemPromptRow(ctx: Ctx, scope: Scope): HTMLElement {
  // The row is the whole of its block: the block's title says what it is (the label stays for screen readers).
  const parts = rowShell('ai.systemPrompt', { aux: t('set.ai.systemPrompt.aux'), control: null, stacked: true, hideLabel: true });
  const count = h('span', { class: 'note tabular sw-sp-count' });
  const field = textArea({
    value: ctx.ui.get().settings['ai.systemPrompt'],
    maxLength: MAX_SYSTEM_PROMPT,
    rows: 8,
    ariaLabel: t('set.ai.systemPrompt'),
    normalise: (v) => normaliseSystemPrompt(v) ?? '',
    onCommit: (v) => cmd.setSetting(ctx, 'ai.systemPrompt', v),
    onInput: (v) => update(v),
  });
  field.el.classList.add('sw-sp-field');
  const restore = h('button', { type: 'button', class: 'btn', 'data-sp': 'restore', onclick: () => cmd.resetOneSetting(ctx, 'ai.systemPrompt') }, icon('refresh', 14), t('set.ai.sp.restore'));
  const line = h('div', { class: 'note sw-sp-line', role: 'status' });
  const shortText = h('details', { class: 'sw-sp-short' }, h('summary', { class: 'note' }, t('set.ai.sp.shortForm')), h('p', { class: 'note sw-sp-short-text' }, SHORT_SYSTEM_PROMPT));
  const update = (typed?: string) => {
    const u = ctx.ui.get();
    const text = typed !== undefined ? (normaliseSystemPrompt(typed) ?? '') : u.settings['ai.systemPrompt'];
    count.textContent = t('rw.aiPromptCount', { n: text.length, max: MAX_SYSTEM_PROMPT });
    const pc = promptContext(u, null);
    const l = systemPromptLine(text, pc.model);
    line.textContent = l;
    line.style.display = l ? '' : 'none';
    shortText.style.display = pc.caps.maxPromptTokens !== null && isDefaultSystemPrompt(text) ? '' : 'none';
    const isDefault = text === DEFAULT_SYSTEM_PROMPT;
    (restore as HTMLButtonElement).disabled = isDefault;
    parts.el.classList.toggle('is-changed', !isDefault);
    parts.el.dataset.changed = isDefault ? '0' : '1';
  };
  parts.el.insertBefore(h('div', { class: 'sw-value-block sw-sp', 'data-value': 'ai.systemPrompt' }, field.el, h('div', { class: 'sw-inline sw-sp-foot' }, count, h('span', { style: 'flex:1' }), restore), line, shortText), parts.ctrlEl);
  scope.watch(
    (_s, u) => [u.settings['ai.systemPrompt'], u.models, u.settings['ai.active'], u.hardware, getLang()] as const,
    ([v]) => {
      field.set(v);
      update(document.activeElement === field.el ? field.el.value : undefined);
    },
    (a, b) => a.every((x, i) => x === b[i]),
  );
  return parts.el;
}

export const AI_HOOKS: SettingsHooks = {
  rows: { 'ai.active': (ctx, scope) => activeRow(ctx, scope), 'ai.gpu': gpuRow, 'ai.runtime': (ctx, scope) => runtimeRow(ctx, scope), 'ai.systemPrompt': (ctx, scope) => systemPromptRow(ctx, scope) },
  blocks: { models: (ctx, scope) => modelsBlock(ctx, scope), hardware: (ctx, scope) => hardwareBlock(ctx, scope), guard: guardBlock },
  rowOptions: {},
  top: { ai: aiTop },
};
