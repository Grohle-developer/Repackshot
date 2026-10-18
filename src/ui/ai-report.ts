// The guard's report as the interface words it (AI-POST.md §4 "When the job finishes", UI.md §2.8), for the results viewer
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

/** What the guard did, in a form both a full report and a stored example (X6) give. */
export interface GuardSummary {
  verdict: GuardReport['verdict'];
  usedFraction: number;
  capped?: GuardReport['capped'];
  /** Each material's kept share of its colour change (1 or absent: all of it). */
  materials?: readonly { name: string; kept?: number }[];
  /** Why the guard sent attempts back, in its own (English) words. */
  sentBack?: readonly string[];
}

/** Below this share of the picture a cap that held a band back is not worth a line. */
export const CAPPED_WORTH = 0.02;

/** The check groups a sent-back reason names (the guard's English words, AI-POST.md §7.2). */
export function sentBackGroups(reasons: readonly string[]): ReportItem['key'][] {
  const out = new Set<ReportItem['key']>();
  for (const r of reasons) {
    if (/edges moved|outside the|pixels changed outside|detail SSIM|high-band SSIM/i.test(r)) out.add('geometry');
    if (/colour of|ΔE00|ΔE mean/i.test(r)) out.add('materials');
    if (/focus changed|sharpness changed/i.test(r)) out.add('focus');
    if (/size|came back/i.test(r)) out.add('resolution');
  }
  return [...out];
}

/**
 * What the guard did, in plain words (X6): whether it let all of the AI's change through, where its caps held a control's
 * band back (Light, Bounces, Wear, the style's overall change), how much of a material's colour change it kept, and why
 * it lowered the strength. Empty for a rejection (the note says it).
 */
export function guardWords(r: GuardSummary): string[] {
  if (r.verdict === 'REJECTED') return [];
  const out: string[] = [];
  const pct = (v: number) => Math.max(1, Math.min(100, Math.round(v * 100)));
  if (r.verdict === 'LIMITED') {
    const groups = sentBackGroups(r.sentBack ?? []);
    out.push(groups.length > 0 ? t('rv.aiLimitedWhy', { pct: pct(r.usedFraction), what: groups.map((k) => t(dyn(`rv.aiCheck.${k}`))).join(', ') }) : t('rv.aiLimited', { pct: pct(r.usedFraction) }));
  }
  const c = r.capped;
  if (c) {
    for (const k of ['light', 'bounce', 'wear'] as const) if (c[k] >= CAPPED_WORTH) out.push(t(dyn(`rv.aiCapped.${k}`), { pct: pct(c[k]) }));
    if (c.style >= 0.5) out.push(t('rv.aiCapped.style'));
  }
  const kept = (r.materials ?? []).filter((m) => m.kept !== undefined && m.kept < 1);
  for (const m of kept) out.push(t('rv.aiKept', { name: m.name, pct: Math.round((m.kept ?? 1) * 100) }));
  if (out.length === 0 && r.verdict === 'ACCEPTED') out.push(t('rv.aiGuardAll'));
  return out;
}
