// The units both engines agree on (phase E4). The rig speaks in the
// photographer's terms of the EZ Packshot recipes (`LightInstance.power`:
// watts at part size 1 for an area light, W/m2 for a sun; irradiance
// modelled as `power / (4 pi dist^2)`, `specIrradiance`); the path tracer
// speaks radiometry (RSB `LGHT.power`: the flux in watts of a one-sided
// Lambertian panel, scene millimetres read as 1e-3 m; `MATL.emission_power`:
// radiance). These are the conversions, derived, not tuned by eye, and the
// preview uses the same numbers so Fast and Full agree in brightness.

/** Millimetres of one part size at which the recipes' watts are stated (part size 1 = 1 m). */
export const RECIPE_PART_SIZE_MM = 1000;

/**
 * Flux of an area light for the engine (RSB `LGHT.power`, W).
 *
 * The rig's irradiance model is that of an isotropic source of `power` watts at
 * `dist` part sizes: E = power / (4 pi d^2), with d in metres when the part is
 * 1 m. A one-sided Lambertian panel of flux F has radiant intensity F / pi on
 * its axis, so far away it gives E = F / (pi d^2). Equal irradiance on the part
 * means F = power / 4. For a part of S metres the distances are S times longer,
 * so keeping the irradiance the rig promises needs S^2 times the flux:
 * F = power * S^2 / 4.
 */
export function areaLightFlux(power: number, partSizeMm: number): number {
  const s = (partSizeMm > 0 ? partSizeMm : RECIPE_PART_SIZE_MM) / RECIPE_PART_SIZE_MM;
  return (power * s * s) / 4;
}

/**
 * Radiance of an area light of `power` (rig watts) over `areaInPartSizes2`
 * (its area in square part sizes): the engine's F / (pi A) with F from
 * `areaLightFlux` and A in m2, which no longer depends on the part size:
 * power / (4 pi area). The preview's RectAreaLight takes radiance, so this is
 * its intensity.
 */
export function areaLightRadiance(power: number, areaInPartSizes2: number): number {
  return power / (4 * Math.PI * Math.max(areaInPartSizes2, 1e-9));
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
