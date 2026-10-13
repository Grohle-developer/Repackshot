// Optional URL parameters for demos and screenshots (documented in
// src/ui/README.md). Each one goes through the same commands a user would
// trigger, so the result is a normal, undoable state.

import { lightSetup } from '../data/light-setups';
import { materialPreset } from '../data/materials';
import { sequencePreset } from '../data/animation';
import { studioPreset } from '../data/studios';
import type { Lang } from '../data/types';
import type { ThemeSetting } from '../core/store';
import * as cmd from './commands';
import type { Ctx } from './reactive';
import { TOOLS, type Drawer, type Tool, type ViewportMode } from './ui-state';

export interface UrlParams {
  example: boolean;
  preset?: string;
  setup?: string;
  theme?: ThemeSetting;
  lang?: Lang;
  drawer?: Drawer;
  panels?: 'collapsed';
  select?: string;
  catalog?: boolean;
  material?: string;
  sequence?: string;
  t?: number;
  guide?: number;
  tool?: Tool;
  /** The viewport mode (Fast or Full), for screenshots. */
  mode?: ViewportMode;
  /** Opens the render window in Image or Animation mode. */
  render?: 'IMAGE' | 'ANIMATION';
  /** Opens the Settings window at a section, a part of one or a row (`ai.models`, `engine.threads`). */
  settings?: string;
}

export function readUrlParams(search: string): UrlParams {
  const q = new URLSearchParams(search);
  const out: UrlParams = { example: q.get('example') === '1' };
  const preset = q.get('preset')?.toUpperCase();
  if (preset && studioPreset(preset)) out.preset = preset;
  const setup = q.get('setup')?.toUpperCase();
  if (setup && (setup === 'PRESET' || lightSetup(setup))) out.setup = setup;
  const theme = q.get('theme');
  if (theme === 'dark' || theme === 'light' || theme === 'system') out.theme = theme;
  const lang = q.get('lang');
  if (lang === 'en' || lang === 'es') out.lang = lang;
  const drawer = q.get('drawer');
  if (drawer === 'animation' || drawer === 'queue') out.drawer = drawer;
  if (q.get('panels') === 'collapsed') out.panels = 'collapsed';
  const select = q.get('select');
  if (select) out.select = select.toLowerCase();
  if (q.get('catalog') === '1' || q.get('catalog') === 'open') out.catalog = true;
  const material = q.get('material')?.toUpperCase();
  if (material && materialPreset(material)) out.material = material;
  const sequence = q.get('sequence')?.toUpperCase();
  if (sequence && sequencePreset(sequence)) out.sequence = sequence;
  const t = Number(q.get('t'));
  if (q.get('t') !== null && Number.isFinite(t)) out.t = Math.max(0, t);
  const guide = Number(q.get('guide'));
  if (q.get('guide') !== null && Number.isInteger(guide) && guide >= 1 && guide <= 6) out.guide = guide - 1;
  const tool = q.get('tool')?.toLowerCase();
  if (tool && (TOOLS as readonly string[]).includes(tool)) out.tool = tool as Tool;
  const mode = q.get('mode')?.toLowerCase();
  if (mode === 'fast' || mode === 'full') out.mode = mode === 'fast' ? 'FAST' : 'FULL';
  const render = q.get('render')?.toLowerCase();
  if (render === 'image' || render === 'animation') out.render = render === 'image' ? 'IMAGE' : 'ANIMATION';
  const settings = q.get('settings');
  if (settings !== null) out.settings = /^[A-Za-z0-9.]{0,64}$/.test(settings) ? settings : '';
  return out;
}

export function applyUrlParams(ctx: Ctx, p: UrlParams): void {
  if (p.example) cmd.loadExample(ctx);
  if (p.preset) {
    cmd.setProductType(ctx, p.preset);
    cmd.buildStudio(ctx);
  }
  if (p.setup) {
    cmd.chooseSetup(ctx, p.setup);
    // Show the style of the chosen setup so it is visible in the catalogue.
    const style = lightSetup(p.setup)?.style;
    if (style && p.setup !== 'PRESET') ctx.ui.set({ lightStyle: style });
  }
  if (p.select) {
    const s = ctx.store.get();
    const node = Object.values(s.scene.nodes).find((n) => n.key === p.select || n.name.toLowerCase() === p.select);
    if (node) ctx.store.dispatch({ type: 'scene/select', ids: [node.id], mode: 'set', level: node.kind === 'MODEL' ? 'MODEL' : node.kind === 'GROUP' ? 'GROUP' : 'PART' });
  }
  if (p.material) cmd.requestAssign(ctx, { preset: p.material });
  if (p.catalog) {
    const s = ctx.store.get();
    const m = s.selection.ids.map((id) => s.scene.nodes[id]?.material).find(Boolean);
    const cat = m ? s.materials[m]?.category : undefined;
    ctx.ui.set({ catalogOpen: true, ...(cat ? { materialCategory: cat } : {}) });
  }
  if (p.sequence) ctx.store.dispatch({ type: 'anim/preset', key: p.sequence });
  if (p.t !== undefined) ctx.store.dispatch({ type: 'anim/playhead', t: p.t });
  if (p.drawer) ctx.ui.set({ drawer: p.drawer });
  if (p.panels === 'collapsed') ctx.ui.set({ leftCollapsed: true, rightCollapsed: true });
  if (p.guide !== undefined) ctx.ui.set({ guideStep: p.guide });
  if (p.tool) cmd.setTool(ctx, p.tool);
  // The chosen mode, applied as soon as the engine allows (Full waits for it to load).
  if (p.mode) ctx.ui.set({ viewportMode: p.mode });
  if (p.render) {
    if (ctx.store.get().render.mode !== p.render) ctx.store.dispatch({ type: 'render/set', patch: { mode: p.render } });
    cmd.openRenderWindow(ctx);
  }
  if (p.settings !== undefined) cmd.openSettings(ctx, p.settings || undefined);
}
