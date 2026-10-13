// The units both engines agree on (phase E4; area-light convention corrected by the light-power
// fix). The rig speaks in the photographer's terms of the EZ Packshot recipes
// (`LightInstance.power`: watts at part size 1 for an area light, W/m2 for a sun); the path tracer
// speaks radiometry (RSB `LGHT.power`: the flux in watts of a one-sided Lambertian panel, scene
// millimetres read as 1e-3 m; `MATL.emission_power`: radiance). These are the conversions, derived,
// not tuned by eye, and the preview uses the same numbers so Fast and Full agree in brightness.
//
// The recipes were tuned by eye in Blender Cycles, so the watts mean what Cycles makes of them.
// There an area light of power P and area A has the radiance L = P / (4 A) (Cycles' area light
// scales its emission by `0.25 * invarea`; Blender issue 108505 derives the factor), and EZ Packshot
// writes `energy = energy_factor * u^2` for a part of u metres (`apply_light_data`). The comment
// next to that line in the add-on speaks of an isotropic point source, E = P / (4 pi d^2): that is
// the unit of the recipes' `share` (`specIrradiance`, which normalises the setups to one another and
// stays as it is), not what the renderer shows, which is pi times brighter on axis.

/** Millimetres of one part size at which the recipes' watts are stated (part size 1 = 1 m). */
export const RECIPE_PART_SIZE_MM = 1000;

/**
 * Flux of an area light for the engine (RSB `LGHT.power`, W).
 *
 * Cycles turns the rig's power P into the radiance L = P / (4 A) over an area of A square metres.
 * The engine's panel of flux F has the radiance L = F / (pi A), so F = pi L A = (pi / 4) P: the area
 * cancels. For a part of S metres the recipe's power is `energy_factor * S^2` and the distances are
 * S times longer, so the same look needs S^2 times the flux: F = (pi / 4) * power * S^2.
 *
 * Seen from far away on its axis, a panel of flux F gives E = F / (pi d^2) (its intensity is F / pi),
 * so at `dist` part sizes the irradiance is E = power / (4 dist^2): what Cycles delivers for the same
 * recipe, and pi times the isotropic-source E = power / (4 pi dist^2) of the comment in the add-on.
 */
export function areaLightFlux(power: number, partSizeMm: number): number {
  const s = (partSizeMm > 0 ? partSizeMm : RECIPE_PART_SIZE_MM) / RECIPE_PART_SIZE_MM;
  return (Math.PI / 4) * power * s * s;
}

/**
 * Radiance of an area light of `power` (rig watts) over `areaInPartSizes2` (its area in square part
 * sizes): Cycles' L = P / (4 A), which is the engine's F / (pi A) with F from `areaLightFlux` and A
 * in m2, and no longer depends on the part size: power / (4 area). The preview's RectAreaLight takes
 * radiance, so this is its intensity.
 */
export function areaLightRadiance(power: number, areaInPartSizes2: number): number {
  return power / (4 * Math.max(areaInPartSizes2, 1e-9));
}

/**
 * A sun's `power` is already an irradiance (W/m2), which is what the engine
 * reads and what a three.js DirectionalLight's intensity is (its diffuse
 * radiance is albedo / pi times it, like the engine's Lambert lobe).
 */
export const SUN_IRRADIANCE_PER_POWER = 1;

/**
 * Radiance of an emissive material per watt of its `emitPower` (RSB
 * `MATL.emission_power` = emitPower x this, with `emission` its colour). The
 * catalogue's emitter watts are a level, not a flux over a known area, so
 * this is the factor the preview has used for them since U1 and the engine
 * now shares.
 */
export const EMIT_RADIANCE_PER_WATT = 0.06;
