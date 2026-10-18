// What ▶ Start in the physics bar will simulate (phase U16, UI.md §2.5), from the scene as it is: the parts the run
// moves (the stored Dynamic roles, S2 `physicsSpec`), the rain, dust and snow of the effects that fall on the parts and
// on how many parts each settles (S3c `wetPartsSpec`, with U16's Physics ▸ Weather: the parts that keep dry or bare), and
// the front glass of the active camera when the scene feeds it (S3b). The drawer turns it into one line; nothing here
// is made up: it is the same selection the run itself makes (ui/physics.ts `simulate`).

import { activeCamera, isPanoramic } from './camera';
import { glassFromScene } from './optics';
import { physicsSpec } from './physics';
import type { NodeId } from './scene';
import type { ProjectState } from './store';
import { feedingEffects } from './wet';
import { wetPartsSpec } from './wet-parts';

/** What a Start would simulate. */
export interface StartPlan {
  /** The parts the bodies move (a group that falls as one body counts each of its parts). */
  dynamicParts: number;
  /** With rain on the parts: the parts it wets, and those under it that keep dry. */
  rain: { parts: number; dry: number } | null;
  /** With dust or snow on the parts: which, the parts it settles on (those that stay), and those that keep bare. */
  settle: { dust: boolean; snow: boolean; parts: number; bare: number } | null;
  /** The front glass of the active camera, fed by the scene, gets the rain or the dust. */
  glass: boolean;
}

/** True when the plan has nothing to run (Start would say so and do nothing). */
export function planIsEmpty(p: StartPlan): boolean {
  return p.dynamicParts === 0 && !p.rain && !p.settle && !p.glass;
}

export function startPlan(state: ProjectState): StartPlan {
  const bodies = physicsSpec(state);
  const moving = new Map<NodeId, number>();
  (bodies?.bodies ?? []).forEach((b, i) => b.pieces.forEach((p) => moving.set(p.part, i)));
  const wet = wetPartsSpec(state, moving);
  let rain: StartPlan['rain'] = null;
  let settle: StartPlan['settle'] = null;
  if (wet) {
    const kinds = new Set(wet.sources.map((s) => s.kind));
    if (kinds.has('DROPS')) {
      const dry = wet.parts.filter((p) => p.dry).length;
      rain = { parts: wet.parts.length - dry, dry };
    }
    if (kinds.has('DUST') || kinds.has('SNOW')) {
      // Dust and snow settle only on the parts that stay (S3e).
      const staying = wet.parts.filter((p) => p.body === undefined);
      const bare = staying.filter((p) => p.noDust).length;
      settle = { dust: kinds.has('DUST'), snow: kinds.has('SNOW'), parts: staying.length - bare, bare };
    }
  }
  const cam = activeCamera(state);
  const g = cam.optics?.frontGlass;
  const glass = !!g?.on && glassFromScene(g) && !isPanoramic(cam.projection) && feedingEffects(state).length > 0;
  return { dynamicParts: moving.size, rain, settle, glass };
}
