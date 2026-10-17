// Add ▸ Primitive (phase U9): the same entries in the header's menu, behind the + of the Scene panel, in the
// viewport's menu on empty space and (one by one) in the command palette. Add ▸ Light (phase L4): the lights of
// the Lights tab's Add light, in the same places.

import { PRIMITIVES, type PrimitiveKind } from '../../data/primitives';
import { NEW_LIGHT_KINDS, type NewLightKind } from '../../core/lighting';
import * as cmd from '../commands';
import type { MenuItems } from '../components/widgets';
import type { IconName } from '../icons';
import { dyn } from '../names';
import type { Ctx } from '../reactive';
import { t } from '../strings';

const ICONS: Readonly<Record<PrimitiveKind, IconName>> = {
  BOX: 'primBox',
  PLANE: 'primPlane',
  DISC: 'primDisc',
  CYLINDER: 'primCylinder',
  PEDESTAL: 'primPedestal',
  SPHERE: 'primSphere',
  CONE: 'primCone',
  TORUS: 'primTorus',
  CAPSULE: 'primCapsule',
  TUBE: 'primTube',
  STEPS: 'primSteps',
  SWEEP: 'primSweep',
};

/** The primitives of the catalogue, under a "Primitive" heading; each tooltip says where it goes. */
export function primitiveMenuItems(ctx: Ctx): MenuItems {
  return [
    { heading: t('add.primitive') },
    ...PRIMITIVES.map((p) => ({ label: t(dyn(`prim.${p.key}`)), icon: ICONS[p.key], note: t(dyn(`prim.tip.${p.role}`)), run: () => cmd.addPrimitive(ctx, p.key) })),
  ];
}

const LIGHT_ICONS: Readonly<Record<NewLightKind, IconName>> = {
  RECTANGLE: 'lightRect',
  DISK: 'lightDisc',
  SPHERE: 'lightSphere',
  POINT: 'lightPoint',
  SPOT: 'lightSpot',
  SUN: 'lightSun',
};

/** Add light ▸ (UI.md §2.2): area (rectangle, disc, sphere), point, spot, sun, and IES… (L5: a profile file, which makes the light). */
export function lightMenuItems(ctx: Ctx, opts: { heading?: boolean } = {}): MenuItems {
  return [
    ...(opts.heading === false ? [] : [{ heading: t('lights.heading') }]),
    ...NEW_LIGHT_KINDS.map((k) => ({ label: t(dyn(`lights.addKind.${k}`)), icon: LIGHT_ICONS[k], note: t(dyn(`lights.addTip.${k}`)), run: () => cmd.addLight(ctx, k) })),
    { label: t('lights.addKind.IES'), icon: 'lightIes' as IconName, note: t('lights.addTip.IES'), run: () => void cmd.addIesLight(ctx) },
  ];
}
