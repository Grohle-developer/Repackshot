// Phase M3a in the interface without the DOM: Nodes… opens the editor on the selection's material (Simple goes to
// Nodes in one undo entry), back to Simple asks only when something would be lost, an example is one undo entry
// (the label one brings its picture), a refused link says why, a link moved from one input to another is one
// entry, the Add node search, what the inspector and the editor say about Fast and Full, the layout of the cards,
// and the editor's place and size remembered with the interface.

import { describe, expect, it } from 'vitest';
import { MATERIAL_GRAPHS } from '../src/data/material-graphs';
import { getImage } from '../src/core/images';
import { graphImageRefs, newNode, outputNode, type MaterialGraph } from '../src/core/material-graph';
import { createStore } from '../src/core/store';
import { defaultLayout, validateLayout } from '../src/core/settings';
import * as gc from '../src/ui/graph-commands';
import { addNodeMatches } from '../src/ui/panels/material-editor';
import { cardHeight, cardRows, cardTitle, HEAD_H, linkPath, NODE_W, PREVIEW_H, ROW_H, socketPoint } from '../src/ui/panels/graph-canvas';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, STRINGS, t } from '../src/ui/strings';
import { createUiStore } from '../src/ui/ui-state';
import { exampleState, keyIds } from './helpers';

function makeCtx(): Ctx & { toasts: string[] } {
  const toasts: string[] = [];
  const ui = createUiStore();
  const toast = ui.toast.bind(ui);
  ui.toast = (text) => {
    toasts.push(text);
    toast(text);
  };
  return { store: createStore(exampleState()), ui, services: { viewport: null } as unknown as AppServices, toasts };
}

const select = (ctx: Ctx, key: string) => ctx.store.dispatch({ type: 'scene/select', ids: [keyIds(ctx.store.get())[key]], mode: 'set' });
const bodyMat = (ctx: Ctx) => ctx.store.get().scene.nodes[keyIds(ctx.store.get()).body].material!;
const graph = (ctx: Ctx): MaterialGraph => ctx.store.get().materials[bodyMat(ctx)].graph!;

describe('opening the editor', () => {
  it('on the selection’s material turns it to Nodes in one undo entry, and without one says what to do', () => {
    setLang('en');
    const ctx = makeCtx();
    expect(gc.openMaterialEditor(ctx)).toBe(false);
    expect(ctx.toasts).toEqual([t('ge.pickOne')]);
    select(ctx, 'body');
    expect(gc.openMaterialEditor(ctx)).toBe(true);
    expect(ctx.ui.get().materialEditor).toEqual({ material: bodyMat(ctx) });
    expect(graph(ctx).nodes.map((n) => n.type)).toEqual(['OUTPUT']);
    expect(ctx.store.history().undo).toEqual(['Edit Metallic paint with nodes']);
    // Again: already Nodes, no new entry.
    gc.closeMaterialEditor(ctx);
    gc.openMaterialEditor(ctx);
    expect(ctx.store.history().undo).toHaveLength(1);
  });

  it('back to Simple: at once from the minimal graph, after a question from a richer one', () => {
    const ctx = makeCtx();
    const mat = bodyMat(ctx);
    gc.toNodes(ctx, mat);
    expect(gc.toSimple(ctx, mat)).toBeNull();
    expect(ctx.store.get().materials[mat].graph).toBeUndefined();
    gc.toNodes(ctx, mat);
    gc.addGraphNode(ctx, mat, 'NOISE', 0, 0);
    const ask = gc.toSimple(ctx, mat)!;
    expect(ask.message).toBe(`${t('ge.toSimple.title')} ${t('ge.toSimple.text', { n: 1 })}`);
    expect(ctx.store.get().materials[mat].graph).toBeDefined();
    ask.options[0].run();
    expect(ctx.store.get().materials[mat].graph).toBeUndefined();
    expect(ctx.store.history().undo[0]).toBe('Metallic paint (edited) back to Simple');
  });
});

describe('the examples', () => {
  it('lay a graph in one undo entry, the label one with its picture in the registry', () => {
    const ctx = makeCtx();
    const mat = bodyMat(ctx);
    const before = ctx.store.history().undo.length;
    expect(gc.applyExample(ctx, mat, 'PLASTIC_LABEL')).toBe(true);
    expect(ctx.store.history().undo.length).toBe(before + 1);
    expect(ctx.store.history().undo[0]).toMatch(/^Example Plastic with a label on /);
    const [ref] = graphImageRefs(graph(ctx));
    expect(getImage(ref.id)?.rgba8).toBeDefined();
    for (const def of MATERIAL_GRAPHS) expect(gc.applyExample(ctx, mat, def.key), def.key).toBe(true);
    expect(graph(ctx).nodes).toHaveLength(MATERIAL_GRAPHS.at(-1)!.nodes.length);
    ctx.store.undo();
    expect(graph(ctx).nodes).toHaveLength(MATERIAL_GRAPHS.at(-2)!.nodes.length);
  });
});

describe('links from the canvas', () => {
  it('that are refused say why, in words; one that is made names both ends', () => {
    const ctx = makeCtx();
    const mat = bodyMat(ctx);
    gc.toNodes(ctx, mat);
    const out = outputNode(graph(ctx))!.id;
    const a = gc.addGraphNode(ctx, mat, 'NOISE', 0, 0)!;
    expect(gc.connectSockets(ctx, mat, { from: a, output: 'color', to: out, input: 'normal' })).toBe(false);
    expect(ctx.toasts.at(-1)).toBe('A colour cannot go into a normal input.');
    expect(gc.connectSockets(ctx, mat, { from: a, output: 'value', to: a, input: 'scale' })).toBe(false);
    expect(ctx.toasts.at(-1)).toBe(t('ge.link.SELF'));
    expect(gc.connectSockets(ctx, mat, { from: a, output: 'value', to: out, input: 'roughness' })).toBe(true);
    expect(ctx.store.history().undo[0]).toBe('Connect Noise to Material output · Roughness');
  });

  it('picked up from an input and dropped on another is one undo entry; dropped on nothing, a disconnection', () => {
    const ctx = makeCtx();
    const mat = bodyMat(ctx);
    gc.toNodes(ctx, mat);
    const out = outputNode(graph(ctx))!.id;
    const a = gc.addGraphNode(ctx, mat, 'NOISE', 0, 0, (id) => ({ from: id, output: 'value', to: out, input: 'roughness' }))!;
    const entries = ctx.store.history().undo.length;
    gc.relinkSocket(ctx, mat, { node: out, input: 'roughness' }, { node: out, input: 'metallic' });
    expect(graph(ctx).links).toEqual([{ from: a, output: 'value', to: out, input: 'metallic' }]);
    expect(ctx.store.history().undo.length).toBe(entries + 1);
    // Onto an input that cannot take it: nothing changes, and it says why.
    gc.relinkSocket(ctx, mat, { node: out, input: 'metallic' }, { node: out, input: 'normal' });
    expect(graph(ctx).links).toHaveLength(1);
    expect(ctx.toasts.at(-1)).toBe('A number cannot go into a normal input.');
    gc.relinkSocket(ctx, mat, { node: out, input: 'metallic' }, null);
    expect(graph(ctx).links).toEqual([]);
  });
});

describe('what the editor says', () => {
  it('finds nodes by their name, their words and in both languages, never the output', () => {
    expect(addNodeMatches('').flatMap((g) => g.types)).not.toContain('OUTPUT');
    expect(addNodeMatches('').flatMap((g) => g.types)).toHaveLength(18);
    expect(addNodeMatches('perlin').flatMap((g) => g.types)).toEqual(['NOISE']);
    expect(addNodeMatches('ruido').flatMap((g) => g.types)).toEqual(['NOISE']);
    // A word of the node's keywords only.
    expect(addNodeMatches('turbulence').flatMap((g) => g.types)).toEqual(['NOISE']);
    expect(addNodeMatches('normal').flatMap((g) => g.types)).toEqual(expect.arrayContaining(['NORMAL_MAP', 'BUMP']));
    expect(addNodeMatches('zzz')).toEqual([]);
  });

  it('how Fast draws the material, what it approximates, and what Full and Render do (M3b: the engine runs it)', () => {
    setLang('en');
    const ctx = makeCtx();
    const mat = bodyMat(ctx);
    gc.applyExample(ctx, mat, 'GLASS_DIRT');
    const lines = gc.fastNoteLines(ctx.store.get(), mat, graph(ctx));
    expect(lines[0]).toMatch(/slice through the part’s front/);
    expect(lines).toContain(t('ge.fast.note.FRESNEL'));
    expect(lines).toContain('No map for transmission: its mean value.');
    expect(lines.at(-1)).toBe(t('ge.full.note'));
    // M3b: the engine runs the graph; nothing of it is coming soon any more.
    expect(t('ge.full.note')).toMatch(/runs the graph at every point/);
    for (const lang of ['en', 'es'] as const) expect(STRINGS[lang]['ge.full.note']).not.toMatch(/soon|próximamente|M3b/);
    gc.applyExample(ctx, mat, 'PLASTIC_LABEL');
    expect(gc.fastNoteLines(ctx.store.get(), mat, graph(ctx))[0]).toMatch(/through its cylindrical projection/);
    expect(gc.graphStatusText(graph(ctx))).toMatch(/^6 nodes · 8 links · program of \d+ instructions, \d+ \+ \d+ registers$/);
    setLang('es');
    expect(gc.fastNoteLines(ctx.store.get(), mat, graph(ctx))[0]).toMatch(/proyección cilíndrica/);
    setLang('en');
  });
});

describe('the cards of the canvas', () => {
  it('put their sockets where the rows are: the outputs first, then the inputs the parameters show', () => {
    const math = newNode('MATH', 'm', 100, 50)!;
    expect(cardRows(math).map((r) => `${r.dir}:${r.key}`)).toEqual(['out:value', 'in:a', 'in:b']);
    math.params.op = 'MULTIPLY_ADD';
    expect(cardRows(math).map((r) => r.key)).toEqual(['value', 'a', 'b', 'c']);
    math.params.op = 'SINE';
    expect(cardRows(math).map((r) => r.key)).toEqual(['value', 'a']);
    expect(cardTitle(math)).toBe('Maths · Sine');
    expect(socketPoint(math, 'out', 'value')).toEqual({ x: 100 + NODE_W, y: 50 + HEAD_H + PREVIEW_H + ROW_H / 2 });
    expect(socketPoint(math, 'in', 'a')).toEqual({ x: 100, y: 50 + HEAD_H + PREVIEW_H + ROW_H + ROW_H / 2 });
    expect(socketPoint(math, 'in', 'b')).toBeNull();
    expect(cardHeight(math)).toBe(HEAD_H + PREVIEW_H + 2 * ROW_H + 6);
    expect(linkPath(0, 0, 100, 0)).toBe('M 0 0 C 50 0, 50 0, 100 0');
  });

  it('remember the editor’s place and size with the interface, within bounds', () => {
    expect(defaultLayout().materialEditorRect).toBeNull();
    expect(validateLayout({ materialEditorRect: { x: 10, y: 20, w: 900, h: 600 } }).materialEditorRect).toEqual({ x: 10, y: 20, w: 900, h: 600 });
    expect(validateLayout({ materialEditorRect: { x: 10, y: 20, w: 100, h: 1e9 } }).materialEditorRect).toEqual({ x: 10, y: 20, w: 480, h: 8000 });
    expect(validateLayout({ materialEditorRect: { x: 'a', y: 20, w: 100, h: 100 } }).materialEditorRect).toBeNull();
    const saved: unknown[] = [];
    const ui = createUiStore({}, { layout: defaultLayout(), onLayout: (p) => saved.push(p) });
    ui.set({ materialEditorRect: { x: 1, y: 2, w: 700, h: 500 } });
    expect(saved).toEqual([{ materialEditorRect: { x: 1, y: 2, w: 700, h: 500 } }]);
  });
});
