// The units both engines agree on (phase E4; area-light convention corrected by the light-power
// fix). The rig speaks in the photographer's terms of the recipes
// (`LightInstance.power`: watts at part size 1 for an area light, W/m2 for a sun); the path tracer
// speaks radiometry (RSB `LGHT.power`: the flux in watts of a one-sided Lambertian panel, scene
// millimetres read as 1e-3 m; `MATL.emission_power`: radiance). These are the conversions, derived,
// not tuned by eye, and the preview uses the same numbers so Fast and Full agree in brightness.
//
// The recipes were tuned by eye in Blender Cycles, so the watts mean what Cycles makes of them.
// There an area light of power P and area A has the radiance L = P / (4 A) (Cycles' area light
// scales its emission by `0.25 * invarea`; Blender issue 108505 derives the factor), and a recipe
// light's watts, stated at part size 1, grow with u^2 for a part of u metres. An isotropic point
// source, E = P / (4 pi d^2), is the unit of the recipes' `share` (`specIrradiance`, which
// normalises the setups to one another and stays as it is), not what the renderer shows, which is
// pi times brighter on axis.

/** Millimetres of one part size at which the recipes' watts are stated (part size 1 = 1 m). */
export const RECIPE_PART_SIZE_MM = 1000;

/**
 * Flux of an area light for the engine (RSB `LGHT.power`, W).
 *
 * Cycles turns the rig's power P into the radiance L = P / (4 A) over an area of A square metres.
 * The engine's panel of flux F has the radiance L = F / (pi A), so F = pi L A = (pi / 4) P: the area
 * cancels. For a part of S metres the recipe's power grows with S^2 and the distances are
 * S times longer, so the same look needs S^2 times the flux: F = (pi / 4) * power * S^2.
 *
 * Seen from far away on its axis, a panel of flux F gives E = F / (pi d^2) (its intensity is F / pi),
 * so at `dist` part sizes the irradiance is E = power / (4 dist^2): what Cycles delivers for the same
 * recipe, and pi times the isotropic-source E = power / (4 pi dist^2) the recipes' `share` is stated in.
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

/**
 * Flux of a point light (and of the sphere of an AREA light of shape SPHERE) for the engine (RSB `LGHT.power` of
 * kind 3, W, isotropic), phase L4. Its watts are defined to mean what a panel's mean: **a point of P watts is as
 * bright on its axis as a panel of P watts facing the product from the same distance**. A panel gives E = power / (4 dist^2) there (`areaLightFlux`), so the point's
 * intensity is power * S^2 / 4 W/sr for a part of S metres, and its isotropic flux F = 4 pi I = pi * power * S^2.
 * Like a panel's, it is then pi times the measure the recipes are normalised with (`specIrradiance`,
 * power / (4 pi dist^2)), so setups that mix panels, points and spots keep their balance. (Cycles' point light
 * would be pi times dimmer for the same watts.) A spot (kind 4) reads the same number as the point light it would be
 * without its cone: its axis is as bright as that point light's, whatever the cone.
 */
export function pointLightFlux(power: number, partSizeMm: number): number {
  const s = (partSizeMm > 0 ? partSizeMm : RECIPE_PART_SIZE_MM) / RECIPE_PART_SIZE_MM;
  return Math.PI * power * s * s;
}

/**
 * Intensity of a point or spot light for the preview (three.js PointLight and SpotLight, decay 2, distances in
 * millimetres): E = I / d^2 with d in mm must be the engine's E = power / (4 dist^2) with d = dist * S mm, so
 * I = power * S^2 / 4 with S the part size in mm. Not the part size in metres: three.js reads its millimetres as
 * they are.
 */
export function pointLightIntensity(power: number, partSizeMm: number): number {
  const s = partSizeMm > 0 ? partSizeMm : RECIPE_PART_SIZE_MM;
  return (power * s * s) / 4;
}

/**
 * Lumens per watt of the photometric definition (light of 555 nm). The light's lumens (L4, the aid next to its
 * watts) are its flux in the engine times this times the luminance of its colour (Rec. 709 Y, white = 1): the
 * convention of renderers that work in RGB, not a lamp's efficacy.
 */
export const LUMENS_PER_WATT = 683;

/** Rec. 709 luminance of a linear RGB colour. */
export function luminance(rgb: readonly number[]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * Share of a point's flux a spot sends into its cone: the solid angle of its mask (1 inside the inner cone, a
 * smoothstep to 0 at the edge, as the engine and the preview draw it) over 4 pi, integrated in 256 steps.
 */
export function spotFraction(coneDeg: number, blend: number): number {
  const half = (Math.min(179, Math.max(1, coneDeg)) * Math.PI) / 360;
  const inner = half * (1 - Math.min(1, Math.max(0, blend)));
  const cosOuter = Math.cos(half);
  const cosInner = Math.cos(inner);
  const steps = 256;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const a = ((i + 0.5) / steps) * half;
    const c = Math.cos(a);
    let mask = 1;
    if (cosInner > cosOuter && c < cosInner) {
      const t = Math.min(1, Math.max(0, (c - cosOuter) / (cosInner - cosOuter)));
      mask = t * t * (3 - 2 * t);
    }
    sum += mask * Math.sin(a) * (half / steps);
  }
  // Solid angle = 2 pi * integral of mask sin(a) da; over the sphere's 4 pi.
  return sum / 2;
}
