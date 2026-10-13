// The guard's report as the interface words it (AI-POST.md §4 "Al terminar", UI.md §2.8), for the results viewer
// and the preview alike: the checked line and, when the guard had to step in, what it did.

import type { GuardReport } from '../core/ai';
import { failedItems, limitedPercent, reportItems, type ReportItem } from '../core/ai-post';
import { dyn } from './names';
import { formatNumber, getLang, t } from './strings';

const MARK_OK = '✓';
const MARK_NO = '✗';

/** One item of the checked line: "geometry ✓", "materials ✓ (ΔE max 1.8)". */
function itemText(i: ReportItem): string {
  const mark = i.ok ? MARK_OK : MARK_NO;
  if (i.key === 'materials' && i.deltaE !== undefined && i.deltaE !== null) return t('rv.aiCheck.materialsDe', { mark, de: formatNumber(i.deltaE, getLang(), 1) });
  return `${t(dyn(`rv.aiCheck.${i.key}`))} ${mark}`;
}

export interface ReportText {
  /** "Checked: geometry ✓ · materials ✓ (ΔE max 1.8) · resolution ✓ · focus ✓"; null when nothing passed (REJECTED). */
  checked: string | null;
  /** What the guard did when it limited or rejected the AI; null when it accepted at once. */
  note: string | null;
}

export function reportText(r: GuardReport): ReportText {
  if (r.verdict === 'REJECTED') {
    const failed = failedItems(r);
    return { checked: null, note: failed.length > 0 ? t('rv.aiRejected', { what: failed.map((k) => t(dyn(`rv.aiCheck.${k}`))).join(', ') }) : t('rv.aiRejectedAny') };
  }
  const pct = limitedPercent(r);
  return { checked: t('rv.aiChecked', { items: reportItems(r).map(itemText).join(' · ') }), note: pct === null ? null : t('rv.aiLimited', { pct }) };
}

/** "Z-Image-Turbo · Q4 · Vulkan · seed 3 · 8 s": what ran, for the viewer's tooltip. */
export function reportDetails(r: GuardReport, modelName: string): string {
  const backend = r.runtime === 'synthetic' ? t('rv.aiBackend.SYNTHETIC') : r.runtime;
  return t('rv.aiDetails', { model: modelName, backend, seed: r.seed, time: t('time.s', { n: formatNumber(r.seconds, getLang(), r.seconds < 10 ? 1 : 0) }) });
}
