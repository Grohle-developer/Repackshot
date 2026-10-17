// Inspector ▸ Textures (phase M2a, UI.md §2.4): the image slots of the selected material (colour, roughness,
// metal, normal, alpha, emission) with their previews, Load… and Remove and how each reads its image; the shared
// mapping (projection, axis, size in mm, rotation, offset, repeat, edges); and the labels, in order, with their
// size and finish, Move label and Add label…. Every control is a store action; a drag of a field is one undo entry.

import { partMaterials, triangleMaterials, type MaterialId, type MaterialInstance } from '../../core/materials';
import { partsUnder, type NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { getMesh } from '../../core/meshes';
import {
  PREVIEW_LABELS_MAX,
  TEXTURE_AXES,
  TEXTURE_CHANNELS,
  TEXTURE_PROJECTIONS,
  TEXTURE_SLOTS,
  TEXTURE_WRAPS,
  type TextureLabel,
  type TextureMapping,
  type TextureSlotKey,
} from '../../core/textures';
import { colorField, field, lengthField, numberField, segmented, select, slider, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, icon } from '../dom';
import { dyn, materialLabel } from '../names';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { L, formatNumber, getLang, t } from '../strings';
import * as tx from '../texture-commands';

/** The one material the selection carries, or null (none, or several). */
function singleMaterial(s: ProjectState, ids: readonly NodeId[], faces: boolean): MaterialId | null {
  const out: MaterialId[] = [];
  if (faces && s.selection.faces) {
    const node = s.scene.nodes[s.selection.faces.part];
    if (node) {
      const per = triangleMaterials(node);
      for (const i of s.selection.faces.indices) if (per[i] && !out.includes(per[i]!)) out.push(per[i]!);
    }
  } else for (const p of partsUnder(s, ids)) for (const m of partMaterials(s.scene.nodes[p])) if (!out.includes(m)) out.push(m);
  return out.length === 1 ? out[0] : null;
}

/** What rebuilds the section: the material, which slots hold images and the shape of their mappings, the labels. */
function structureKey(m: MaterialInstance | undefined): string {
  if (!m) return '';
  const t = m.textures;
  const slots = TEXTURE_SLOTS.map((k) => {
    const s = t[k];
    return s ? `${k}:${s.image.id}:${s.mapping ? 'own' : ''}:${s.height ? 'h' : ''}:${s.cutout ? 'c' : ''}` : '';
  }).join(',');
  return `${m.id}|${m.family}|${slots}|${t.mapping.projection}|${t.labels.map((l) => `${l.id}:${l.image.id}`).join(',')}`;
}

const mm = (v: number) => formatNumber(v, getLang(), 1);

/** A small preview of an image of the registry (or an empty square). */
function preview(id: string | null, size = 36): HTMLElement {
  const url = id ? tx.imageUrl(id) : null;
  return url
    ? h('img', { class: 'tex-thumb', src: url, alt: '', width: size, height: size, draggable: false })
    : h('span', { class: 'tex-thumb tex-thumb-empty', style: `width:${size}px;height:${size}px` });
}

function slotRow(ctx: Ctx, sc: Scope, matId: MaterialId, key: TextureSlotKey): HTMLElement {
  const { store } = ctx;
  const mat = store.get().materials[matId];
  const slot = mat.textures[key];
  const name = t(dyn(`texture.slot.${key}`));
  const aux = slot ? `${slot.image.name} · ${t('texture.size', { w: slot.image.width, h: slot.image.height })}` : t('texture.empty');
  const load = h('button', { type: 'button', class: 'btn sm', 'data-texture-load': key, onclick: () => void tx.loadSlotImage(ctx, matId, key) }, icon('upload', 14), slot ? t('texture.replace') : t('texture.load'));
  const remove = slot ? h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('common.remove'), 'data-tip': t('common.remove'), onclick: () => tx.removeSlotImage(ctx, matId, key) }, icon('trash', 14)) : null;
  const head = h(
    'div',
    { class: 'tex-slot-head', 'data-tip': t(dyn(`texture.slotAux.${key}`)) },
    preview(slot?.image.id ?? null),
    h('div', { class: 'stack', style: 'gap:2px;min-width:0;flex:1' }, h('div', { class: 'tex-slot-name' }, name), h('div', { class: 'aux tex-slot-file', title: aux }, aux)),
    load,
    remove,
  );
  const rows: HTMLElement[] = [head];
  if (slot) {
    const cur = () => store.get().materials[matId]?.textures[key];
    const patch = (p: Parameters<typeof tx.patchSlot>[3], g?: string) => tx.patchSlot(ctx, matId, key, p, g);
    if (key === 'roughness' || key === 'metal' || key === 'alpha' || (key === 'normal' && slot.height)) {
      const ch = segmented(
        TEXTURE_CHANNELS.map((c) => ({ value: c, label: t(dyn(`texture.channel.${c}`)) })),
        slot.channel,
        (v) => patch({ channel: v }),
        { full: true, ariaLabel: t('texture.channel') },
      );
      const inv = toggle(slot.invert, (v) => patch({ invert: v }), t('texture.invert'));
      sc.watch(() => cur(), (s) => s && (ch.set(s.channel), inv.set(s.invert)));
      rows.push(field(t('texture.channel'), ch.el), field(t('texture.invert'), inv.el));
    }
    if (key === 'normal') {
      const height = toggle(slot.height, (v) => patch({ height: v, strength: v ? 0.2 : 1 }), t('texture.heightMap'));
      const strength = numberField({ value: slot.strength, min: 0, max: slot.height ? 50 : 10, step: slot.height ? 0.01 : 0.05, digits: 2, unit: slot.height ? 'mm' : '', ariaLabel: t('texture.strength'), onChange: (v, g) => patch({ strength: v }, g) });
      sc.watch(() => cur(), (s) => s && (height.set(s.height), strength.set(s.strength)));
      rows.push(field(t('texture.heightMap'), height.el), field(t('texture.strength'), strength.el));
      if (slot.height) rows.push(h('div', { class: 'note' }, t('texture.heightAux')));
    }
    if (key === 'alpha') {
      const cut = toggle(slot.cutout, (v) => patch({ cutout: v }), t('texture.cutout'));
      rows.push(field(t('texture.cutout'), cut.el));
      sc.watch(() => cur(), (s) => s && cut.set(s.cutout));
      if (slot.cutout) {
        const cutoff = slider({ value: slot.cutoff, min: 0, max: 1, step: 0.01, ariaLabel: t('texture.cutoff'), onChange: (v, g) => patch({ cutoff: v }, g) });
        sc.watch(() => cur(), (s) => s && cutoff.set(s.cutoff));
        rows.push(field(t('texture.cutoff'), cutoff.el));
      }
    }
    if (key === 'emission') {
      const tint = colorField(slot.tint, (rgb, g) => patch({ tint: [rgb[0], rgb[1], rgb[2]] }, g), t('texture.tint'));
      const strength = numberField({ value: slot.strength, min: 0, max: 1000, step: 0.1, digits: 2, ariaLabel: t('texture.strength'), onChange: (v, g) => patch({ strength: v }, g) });
      sc.watch(() => cur(), (s) => s && (tint.set(s.tint), strength.set(s.strength)));
      rows.push(field(t('texture.tint'), tint.el), field(t('texture.strength'), strength.el));
    }
    if (slot.mapping) {
      rows.push(
        h(
          'div',
          { class: 'row tex-own' },
          h('span', { class: 'note' }, t('texture.ownMapping')),
          h('button', { type: 'button', class: 'btn sm', onclick: () => tx.shareMapping(ctx, matId, key) }, t('texture.useShared')),
        ),
      );
    }
  }
  return h('div', { class: `tex-slot${slot ? ' has-image' : ''}`, 'data-texture-slot': key }, ...rows);
}

function mappingBlock(ctx: Ctx, sc: Scope, matId: MaterialId): HTMLElement {
  const { store } = ctx;
  const m0 = store.get().materials[matId].textures.mapping;
  const cur = () => store.get().materials[matId]?.textures.mapping;
  const set = (patch: Partial<TextureMapping>, g?: string) => tx.setMapping(ctx, matId, patch, g);
  const proj = select(
    TEXTURE_PROJECTIONS.map((p) => ({ value: p, label: t(dyn(`texture.projection.${p}`)) })),
    m0.projection,
    (v) => set({ projection: v as TextureMapping['projection'] }),
    t('texture.projection'),
  );
  const axis = segmented(
    TEXTURE_AXES.map((a) => ({ value: a, label: a })),
    m0.axis,
    (v) => set({ axis: v }),
    { full: true, ariaLabel: t('texture.axis') },
  );
  const uvSet = segmented(
    [
      { value: '0' as const, label: '1' },
      { value: '1' as const, label: '2' },
    ],
    m0.uvSet === 1 ? '1' : '0',
    (v) => set({ uvSet: v === '1' ? 1 : 0 }),
    { full: true, ariaLabel: t('texture.uvSet') },
  );
  const size = lengthField({ value: m0.sizeMm, min: 0.01, max: 1e6, step: 1, digits: 2, ariaLabel: t('texture.sizeMm'), onChange: (v, g) => set({ sizeMm: v }, g) });
  const rot = slider({ value: m0.rotationDeg, min: -360, max: 360, step: 1, digits: 1, unit: '°', ariaLabel: t('texture.rotation'), onChange: (v, g) => set({ rotationDeg: v }, g) });
  const offU = numberField({ value: m0.offset[0], step: 0.01, digits: 3, label: 'U', ariaLabel: `${t('texture.offset')} U`, onChange: (v, g) => set({ offset: [v, cur()?.offset[1] ?? 0] }, g) });
  const offV = numberField({ value: m0.offset[1], step: 0.01, digits: 3, label: 'V', ariaLabel: `${t('texture.offset')} V`, onChange: (v, g) => set({ offset: [cur()?.offset[0] ?? 0, v] }, g) });
  const repU = numberField({ value: m0.repeat[0], min: 0.01, max: 1000, step: 0.05, digits: 2, label: 'U', ariaLabel: `${t('texture.repeat')} U`, onChange: (v, g) => set({ repeat: [v, cur()?.repeat[1] ?? 1] }, g) });
  const repV = numberField({ value: m0.repeat[1], min: 0.01, max: 1000, step: 0.05, digits: 2, label: 'V', ariaLabel: `${t('texture.repeat')} V`, onChange: (v, g) => set({ repeat: [cur()?.repeat[0] ?? 1, v] }, g) });
  const wrap = select(
    TEXTURE_WRAPS.map((w) => ({ value: w, label: t(dyn(`texture.wrap.${w}`)) })),
    m0.wrap,
    (v) => set({ wrap: v as TextureMapping['wrap'] }),
    t('texture.wrap'),
  );
  const fit = h('button', { type: 'button', class: 'btn sm', 'data-tip': t('texture.fitPartAux'), onclick: () => set({ sizeMm: cur()?.projection === 'CYLINDRICAL' ? Math.round(Math.PI * tx.materialPartSize(ctx, matId) * 100) / 100 : tx.materialPartSize(ctx, matId) }) }, t('texture.fitPart'));
  const axisRow = field(t('texture.axis'), axis.el);
  const uvRow = field(t('texture.uvSet'), uvSet.el);
  const sizeRow = field(t('texture.sizeMm'), size.el, fit);
  const sizeNote = h('div', { class: 'note' });
  sc.watch(
    () => cur(),
    (m) => {
      if (!m) return;
      proj.set(m.projection);
      axis.set(m.axis);
      uvSet.set(m.uvSet === 1 ? '1' : '0');
      size.set(m.sizeMm);
      rot.set(m.rotationDeg);
      offU.set(m.offset[0]);
      offV.set(m.offset[1]);
      repU.set(m.repeat[0]);
      repV.set(m.repeat[1]);
      wrap.set(m.wrap);
      axisRow.style.display = m.projection === 'UV' || m.projection === 'BOX' ? 'none' : '';
      uvRow.style.display = m.projection === 'UV' ? '' : 'none';
      sizeRow.style.display = m.projection === 'UV' || m.projection === 'SPHERICAL' ? 'none' : '';
      sizeNote.style.display = sizeRow.style.display;
      sizeNote.textContent = m.projection === 'CYLINDRICAL' ? t('texture.sizeCylAux') : t('texture.sizeAux');
    },
  );
  // A part without UVs shows nothing with UV: say so.
  const noUv = h('div', { class: 'note', style: 'display:none' }, t('texture.uvMissing'));
  sc.watch(
    (s) => [cur()?.projection, s.scene.nodes] as const,
    ([p]) => {
      const parts = tx.partsWith(ctx, matId);
      const missing = parts.some((id) => {
        const n = store.get().scene.nodes[id];
        return n.mesh && !n.primitive && !hasUvs(n.mesh.id);
      });
      noUv.style.display = p === 'UV' && missing ? '' : 'none';
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  return h(
    'div',
    { class: 'stack tex-mapping', 'data-texture-mapping': '' },
    h('div', { class: 'subhead' }, t('texture.mapping')),
    field(t('texture.projection'), proj.el),
    noUv,
    axisRow,
    uvRow,
    sizeRow,
    sizeNote,
    field(t('texture.rotation'), rot.el),
    field(t('texture.offset'), h('div', { class: 'field-row2' }, offU.el, offV.el)),
    field(t('texture.repeat'), h('div', { class: 'field-row2' }, repU.el, repV.el)),
    field(t('texture.wrap'), wrap.el),
  );
}

/** A mesh of the registry has texture coordinates (one that is not registered is not counted against). */
const hasUvs = (meshId: string): boolean => {
  const data = getMesh(meshId);
  return !data || data.uvs !== undefined;
};

function labelRow(ctx: Ctx, sc: Scope, matId: MaterialId, label: TextureLabel, index: number, count: number): HTMLElement {
  const { store, ui } = ctx;
  const cur = () => store.get().materials[matId]?.textures.labels.find((l) => l.id === label.id);
  const lbl = () => ({ en: tx.labelName(store.get().materials[matId], label.id), es: tx.labelName(store.get().materials[matId], label.id) });
  const set = (patch: Partial<Omit<TextureLabel, 'id'>>, g?: string) => store.dispatch({ type: 'texture/setLabel', material: matId, labelId: label.id, patch, gesture: g, label: L('undo.labelEdit', { name: lbl() }) });
  const move = h('button', { type: 'button', class: 'btn sm', 'data-label-move': label.id, 'data-tip': t('label.moveAux'), onclick: () => tx.toggleMoveLabel(ctx, matId, label.id) }, icon('move', 14), t('label.move'));
  sc.watch((_s, u) => u.labelTool?.kind === 'move' && u.labelTool.label === label.id, (on) => move.setAttribute('aria-pressed', String(on)));
  const order = (to: number) => store.dispatch({ type: 'texture/moveLabel', material: matId, labelId: label.id, index: to, label: L('undo.labelOrder', { material: materialLabel(store.get().materials[matId]) }) });
  const up = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('label.forward'), 'data-tip': t('label.forward'), disabled: index === count - 1, onclick: () => order(index + 1) }, icon('arrowUp', 14));
  const down = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('label.back'), 'data-tip': t('label.back'), disabled: index === 0, onclick: () => order(index - 1) }, icon('arrowDown', 14));
  const remove = h(
    'button',
    { type: 'button', class: 'icon-btn sm', 'aria-label': t('common.remove'), 'data-tip': t('common.remove'), onclick: () => store.dispatch({ type: 'texture/removeLabel', material: matId, labelId: label.id, label: L('undo.labelRemove', { name: lbl() }) }) },
    icon('trash', 14),
  );
  const width = lengthField({ value: label.widthMm, min: 0.01, max: 1e6, step: 0.5, digits: 2, ariaLabel: t('label.width'), onChange: (v, g) => set({ widthMm: v }, g) });
  const rot = slider({ value: label.rotationDeg, min: -360, max: 360, step: 1, digits: 1, unit: '°', ariaLabel: t('label.rotation'), onChange: (v, g) => set({ rotationDeg: v }, g) });
  const depth = lengthField({ value: label.depthMm, min: 0, max: 1e6, step: 0.5, digits: 2, ariaLabel: t('label.depth'), onChange: (v, g) => set({ depthMm: v }, g) });
  const rough = slider({ value: label.roughness, min: 0, max: 1, step: 0.01, ariaLabel: t('label.roughness'), onChange: (v, g) => set({ roughness: v }, g) });
  const coat = slider({ value: label.coat, min: 0, max: 1, step: 0.01, ariaLabel: t('label.coat'), onChange: (v, g) => set({ coat: v }, g) });
  const relief = slider({ value: label.relief, min: 0, max: 1, step: 0.01, ariaLabel: t('label.relief'), onChange: (v, g) => set({ relief: v }, g) });
  const sizeText = h('div', { class: 'aux' });
  sc.watch(
    () => cur(),
    (l) => {
      if (!l) return;
      width.set(l.widthMm);
      rot.set(l.rotationDeg);
      depth.set(l.depthMm);
      rough.set(l.roughness);
      coat.set(l.coat);
      relief.set(l.relief);
      sizeText.textContent = `${mm(l.widthMm)} × ${mm(l.widthMm / (l.image.width / l.image.height))} mm`;
    },
  );
  const open = ui.get().sections[`label:${label.id}`] !== false;
  const body = h(
    'div',
    { class: 'stack tex-label-body' },
    field(t('label.width'), width.el),
    field(t('label.rotation'), rot.el),
    field(t('label.depth'), depth.el),
    h('div', { class: 'note' }, t('label.depthAux')),
    field(t('label.roughness'), rough.el),
    field(t('label.coat'), coat.el),
    field(t('label.relief'), relief.el),
  );
  body.style.display = open ? '' : 'none';
  const chevron = h('button', { type: 'button', class: 'icon-btn sm', 'aria-expanded': String(open), 'aria-label': label.image.name }, icon(open ? 'chevronDown' : 'chevronRight', 14));
  chevron.addEventListener('click', () => {
    const now = body.style.display === 'none';
    body.style.display = now ? '' : 'none';
    chevron.setAttribute('aria-expanded', String(now));
    chevron.replaceChildren(icon(now ? 'chevronDown' : 'chevronRight', 14));
    ui.set({ sections: { ...ui.get().sections, [`label:${label.id}`]: now } });
  });
  return h(
    'div',
    { class: 'tex-label', 'data-label': label.id },
    h('div', { class: 'tex-slot-head' }, chevron, preview(label.image.id, 28), h('div', { class: 'stack', style: 'gap:2px;min-width:0;flex:1' }, h('div', { class: 'tex-slot-name', title: label.image.name }, label.image.name), sizeText), up, down, remove),
    h('div', { class: 'row', style: 'gap:6px' }, move),
    body,
  );
}

function labelsBlock(ctx: Ctx, sc: Scope, matId: MaterialId): HTMLElement {
  const { store } = ctx;
  const labels = store.get().materials[matId].textures.labels;
  // The list is drawn top to bottom from the one on top.
  const rows = labels.map((l, i) => labelRow(ctx, sc, matId, l, i, labels.length)).reverse();
  const add = h('button', { type: 'button', class: 'btn', 'data-label-add': '', 'data-tip': t('label.addAux'), onclick: () => void tx.addLabel(ctx, matId) }, icon('plus', 14), t('label.add'));
  sc.watch((_s, u) => u.labelTool?.kind === 'place' && u.labelTool.material === matId, (on) => add.setAttribute('aria-pressed', String(on)));
  const shared = h('div', { class: 'note' });
  sc.watch(
    (s) => s.scene.nodes,
    () => {
      const n = tx.partsWith(ctx, matId).length;
      shared.textContent = labels.length > 0 && n > 1 ? t('label.shared', { n }) : '';
      shared.style.display = shared.textContent ? '' : 'none';
    },
  );
  return h(
    'div',
    { class: 'stack tex-labels', 'data-texture-labels': '' },
    h('div', { class: 'subhead' }, t('texture.labels')),
    ...(rows.length ? rows : [h('div', { class: 'note' }, t('label.none'))]),
    labels.length > PREVIEW_LABELS_MAX ? h('div', { class: 'note' }, t('label.previewLimit', { n: PREVIEW_LABELS_MAX })) : null,
    shared,
    add,
  );
}

/** The Textures section of a selection of parts or faces. */
export function texturesSection(ctx: Ctx, scope: Scope, ids: NodeId[], faces: boolean): HTMLElement {
  const { store } = ctx;
  const body = dynamic(
    scope,
    (s) => {
      const id = singleMaterial(s, ids, faces);
      return id ? structureKey(s.materials[id]) : 'none';
    },
    (sc, key) => {
      if (key === 'none' || key === '') return h('p', { class: 'note' }, t('material.mixedAux'));
      const matId = key.split('|')[0];
      const mat = store.get().materials[matId];
      if (!mat) return null;
      const any = TEXTURE_SLOTS.some((k) => mat.textures[k]);
      return h(
        'div',
        { class: 'stack', 'data-textures': matId },
        h('div', { class: 'note' }, t('texture.engineNote')),
        ...TEXTURE_SLOTS.map((k) => slotRow(ctx, sc, matId, k)),
        any ? mappingBlock(ctx, sc, matId) : null,
        labelsBlock(ctx, sc, matId),
      );
    },
  );
  return section(ctx, 'textures', t('section.textures'), body);
}
