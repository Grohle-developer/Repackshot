// The context menu of a part, group or model (UI.md §2.2, phase U3), shared
// by the scene tree and the viewport: the whole structure is always there, in
// the documented order; what does not apply to the selection is disabled.

import { allParts, effectiveVisible, partsUnder, type NodeId } from '../../core/scene';
import { groupTargets, hasCadFaces, hasFaceMaterials, movableTargets, pivotModeOf, PIVOT_MODES, sharesMaterial } from '../../core/transform';
import { primitivesUnder } from '../../core/primitive-ops';
import * as anim from '../anim-commands';
import * as cmd from '../commands';
import * as phys from '../physics';
import type { MenuEntry, MenuItems } from '../components/widgets';
import { dyn, lightName } from '../names';
import type { Ctx } from '../reactive';
import { kbdFor } from '../shortcuts';
import { getLang, t } from '../strings';
import { openMaterialEditor } from '../graph-commands';

export interface PartMenuOptions {
  /** Starts renaming in place (the tree row); the viewport focuses the inspector's name field instead. */
  rename?: () => void;
  /** Opens the Scale… panel where the menu was opened (the tree row, the clicked point); without it, the Scale tool. */
  scale?: () => void;
}

/** The entries of the context menu for `ids` (scene nodes). */
export function partMenu(ctx: Ctx, ids: NodeId[], opts: PartMenuOptions = {}): MenuItems {
  const s = ctx.store.get();
  const nodes = ids.filter((id) => s.scene.nodes[id]);
  const none = nodes.length === 0;
  const moving = movableTargets(s, nodes);
  const fixed = moving.length === 0;
  const parts = partsUnder(s, nodes);
  const noParts = parts.length === 0;
  const mats = cmd.materialsOf(ctx, nodes);
  const first = s.scene.nodes[nodes[0]];
  const allHidden = !none && nodes.every((id) => s.scene.nodes[id].visible === false);
  const allLocked = !none && nodes.every((id) => s.scene.nodes[id].locked);
  const anyHidden = allParts(s).some((p) => !effectiveVisible(s, p));
  const groups = groupTargets(s, nodes).filter((g) => !nodes.some((id) => s.scene.nodes[id].parent === g));
  const atRoot = nodes.every((id) => s.scene.nodes[id].parent === null);
  const clip = ctx.ui.get().materialClipboard;
  const pin = none ? null : anim.pinState(s, nodes);

  const pivot: MenuItems = PIVOT_MODES.map((mode) => ({
    label: t(dyn(`pivot.${mode}`)),
    note: none ? undefined : t(dyn(`pivot.tip.${mode}`)),
    checked: !none && pivotModeOf(first) === mode,
    disabled: none,
    run: () => (mode === 'CUSTOM' ? cmd.pickPivot(ctx, nodes) : cmd.setPivot(ctx, mode, nodes)),
  }));
  const moveTo: MenuEntry[] = [
    ...groups.map((g) => ({ label: s.scene.nodes[g].name, run: () => cmd.moveToGroup(ctx, g, nodes) })),
    { label: t('ops.topLevel'), disabled: atRoot, run: () => cmd.moveToGroup(ctx, null, nodes) },
  ];
  const material: MenuItems = [
    { label: t('ops.unlink'), disabled: !sharesMaterial(s, nodes), run: () => cmd.unlinkMaterial(ctx, nodes) },
    { label: t('ops.linkWith'), disabled: noParts || allParts(s).length < 2, run: () => cmd.pickLinkMaterial(ctx, nodes) },
    { label: t('ops.copyMaterial'), kbd: kbdFor('copyMaterial'), disabled: mats.length !== 1, run: () => cmd.copyMaterial(ctx, nodes) },
    { label: t('ops.pasteMaterial'), kbd: kbdFor('pasteMaterial'), disabled: noParts || !clip, run: () => cmd.pasteMaterial(ctx, nodes) },
    { label: t('ops.selectByMaterial'), disabled: mats.length !== 1, run: () => cmd.selectByMaterial(ctx, nodes) },
    null,
    // M3a: the material editor, on the one material of the selection (Simple goes to Nodes first).
    { label: t('ops.editNodes'), disabled: mats.length !== 1, run: () => openMaterialEditor(ctx, mats[0]) },
  ];
  const geometry: MenuItems = [
    { label: t('ops.flip'), disabled: noParts, run: () => cmd.flipNormals(ctx, nodes) },
    {
      label: t('ops.smoothing'),
      disabled: noParts,
      run: () => {
        if (nodes.some((id) => !s.selection.ids.includes(id))) ctx.store.dispatch({ type: 'scene/select', ids: nodes, mode: 'set' });
        cmd.focusInspectorField(ctx, 'smoothAngle');
      },
    },
    // Parts read from STEP or IGES carry their CAD faces (phase I2); the others have none to cut.
    { label: t('ops.separateCad'), disabled: !hasCadFaces(s, nodes), run: () => cmd.separateByCadFaces(ctx, nodes) },
    { label: t('ops.separateMaterial'), disabled: !hasFaceMaterials(s, nodes), run: () => cmd.separateByMaterial(ctx, nodes) },
    // Primitives (phase U9): freeze the measures.
    // (A note on a disabled entry would read "coming soon": only the enabled one explains itself.)
    primitivesUnder(s, nodes).length > 0
      ? { label: t('primitive.convert'), note: t('primitive.convertAux'), run: () => cmd.convertToMesh(ctx, nodes) }
      : { label: t('primitive.convert'), disabled: true },
  ];

  return [
    { label: t('ops.frame'), kbd: kbdFor('frame'), disabled: none, run: () => cmd.frameSelection(ctx, nodes) },
    { label: t('ops.move'), kbd: kbdFor('tool.move'), disabled: fixed, run: () => cmd.startMove(ctx, nodes) },
    { label: t('ops.scale'), disabled: fixed, run: () => (opts.scale ? opts.scale() : cmd.startScale(ctx, nodes)) },
    { label: t('tree.rest'), disabled: fixed, run: () => cmd.restOnFloor(ctx, moving) },
    { label: t('tree.center'), disabled: fixed, run: () => cmd.centerSelection(ctx, moving) },
    { label: t('ops.centerRest'), disabled: fixed, run: () => cmd.centerAndRest(ctx, nodes) },
    // Physics (S2): the selection falls onto the floor and whatever is under it, and the bar opens.
    { label: t('ops.drop'), icon: 'drop', note: fixed ? undefined : t('ops.dropAux'), disabled: fixed || noParts, run: () => phys.drop(ctx, nodes) },
    // S9: a sheet of cloth falls over the selection and drapes.
    { label: t('ops.drape'), note: noParts ? undefined : t('ops.drapeAux'), disabled: noParts, run: () => phys.drape(ctx, nodes) },
    { label: t('ops.reset'), disabled: fixed, run: () => cmd.resetTransform(ctx, nodes) },
    { label: t('ops.pivot'), disabled: none, submenu: pivot },
    { label: t('ops.cameraTarget'), disabled: none, run: () => cmd.setCameraTarget(ctx, nodes) },
    // F1: the camera that is seen keeps it in focus (Focus ▸ Object), wherever either goes.
    { label: t('ops.focusOn'), icon: 'focus', disabled: none, run: () => cmd.focusOnNodes(ctx, nodes) },
    // N6: animate it (the timeline's wizard, with it as the target), and keep it still in the explodes that hold it.
    { label: t('anim.animateThis', { name: none ? '' : first.name }), icon: 'film', disabled: none || !anim.nodeTarget(s, nodes[0]), run: () => anim.openWizard(ctx, anim.nodeTarget(s, nodes[0])) },
    pin ? { label: pin.pinned ? t('ops.unpinExplode') : t('ops.pinExplode'), run: () => anim.togglePin(ctx, nodes) } : { label: t('ops.pinExplode'), disabled: true },
    // L4: a light of the rig aimed at the selection (the centre of its bounds).
    { label: t('ops.aimLight'), icon: 'light', disabled: none || s.studio.lights.length === 0, submenu: s.studio.lights.map((l) => ({ label: lightName(s, l.id, getLang()), run: () => cmd.aimLightAtNodes(ctx, l.id, nodes) })) },
    null,
    { label: allHidden ? t('tree.show') : t('tree.hide'), kbd: kbdFor('hide'), disabled: none, run: () => cmd.toggleHide(ctx, nodes) },
    { label: t('tree.isolate'), kbd: kbdFor('isolate'), disabled: none, run: () => cmd.isolateSelection(ctx, nodes) },
    { label: t('tree.showAll'), kbd: kbdFor('showAll'), disabled: !anyHidden, run: () => cmd.showAll(ctx) },
    { label: allLocked ? t('tree.unlock') : t('tree.lock'), disabled: none, run: () => cmd.toggleLock(ctx, nodes) },
    null,
    { label: t('common.duplicate'), kbd: kbdFor('duplicate'), disabled: none, run: () => cmd.duplicate(ctx, false, nodes) },
    { label: t('ops.duplicateLinked'), kbd: kbdFor('duplicateLinked'), disabled: none, run: () => cmd.duplicate(ctx, true, nodes) },
    {
      label: t('ops.pattern'),
      disabled: fixed,
      submenu: [
        { label: t('pattern.LINEAR'), run: () => cmd.createPattern(ctx, 'LINEAR', nodes) },
        { label: t('pattern.CIRCULAR'), run: () => cmd.createPattern(ctx, 'CIRCULAR', nodes) },
      ],
    },
    { label: t('ops.group'), kbd: kbdFor('group'), disabled: fixed, run: () => cmd.groupSelection(ctx, nodes) },
    { label: t('ops.ungroup'), kbd: kbdFor('ungroup'), disabled: !nodes.some((id) => s.scene.nodes[id].kind === 'GROUP'), run: () => cmd.ungroupSelection(ctx, nodes) },
    { label: t('ops.moveToGroup'), disabled: fixed || moveTo.every((e) => e.disabled), submenu: moveTo },
    null,
    { label: t('ops.material'), disabled: noParts, submenu: material },
    { label: t('ops.geometry'), disabled: noParts, submenu: geometry },
    null,
    { label: t('common.rename'), disabled: nodes.length !== 1, run: () => (opts.rename ? opts.rename() : cmd.focusInspectorField(ctx, 'name')) },
    { label: t('common.delete'), kbd: kbdFor('delete'), disabled: none, run: () => cmd.deleteSelection(ctx, nodes) },
  ];
}
