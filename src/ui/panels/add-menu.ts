// Add ▸ Primitive (phase U9): the same entries in the header's menu, behind the + of the Scene panel, in the
// viewport's menu on empty space and (one by one) in the command palette.

import { PRIMITIVES, type PrimitiveKind } from '../../data/primitives';
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
