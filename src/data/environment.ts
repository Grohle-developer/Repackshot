// Procedural world environment.
//
// With no HDRI file the world used to light the scene with a flat colour: a
// light preset washed the shadows out, and a dark one left chrome reflecting
// black. The studio dome replaces it: a vertical grey gradient built by
// procedure, without any file, like a studio cyclorama. It is what gives
// chrome something to reflect and the shadows a fill that does not wash them
// out. The active light setup picks the world kind (WorldKind):
//
//   STUDIO  table dome: dark floor, mid horizon, bright zenith
//   SKY     physical sky with the sun of the rig itself
//   FLAT    flat colour, for whoever wants it on purpose
//
// A user-supplied HDRI still wins over all three.
//
// The dome is a three-stop ramp over the elevation of the viewing direction,
// 0 looking straight down, 0.5 at the horizon, 1 straight up. Each stop is a
// linear grey value (r = g = b); the result is scaled by the environment
// strength of the studio preset (StudioPreset.envStrength).

/** Dome grey looking straight down (ramp position 0). */
export const DOME_FLOOR = 0.12;
/** Dome grey at the horizon (ramp position 0.5). */
export const DOME_HORIZON = 0.45;
/** Dome grey looking straight up (ramp position 1). */
export const DOME_ZENITH = 0.85;

/**
 * Highest radiance of the bright field that the camera sees behind the part
 * (a light with `camera: true`). Above this it only burns out and triggers
 * glare in post. A silhouette panel is around 1.5.
 */
export const FIELD_MAX_STRENGTH = 4.0;

/** Width of the soft edge of the bright field, as a fraction of its radius. */
export const FIELD_SOFT = 0.35;
