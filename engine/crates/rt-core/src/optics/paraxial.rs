//! Paraxial (y–nu) optics of a prescription, in one global frame (O2): the cardinal points, the
//! pupils, the focus and the derived semi-apertures that the traced lens needs, from a handful of
//! multiplications. A positive radius has its centre of curvature on the +z side, a mirror reverses
//! the direction of travel and negates the index (the usual signed-index trick), so a folded system
//! is one sequence; a cylinder has power in one meridian only. The trace is in the y (vertical)
//! meridian: an anamorphic adapter's cylinders squeeze the horizontal, so its focal length is its
//! master lens's, as an anamorphic lens is named.

use super::traced::{Surface, SURFACE_CYLINDER_X, SURFACE_CYLINDER_Y, SURFACE_MIRROR};

/// A paraxial ray: height and slope, in the medium after the last surface it met.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParaxialRay {
    /// Height above the axis.
    pub y: f32,
    /// Slope (dy/dz times the sign of the direction of travel).
    pub u: f32,
}

/// The curvature a surface has in the y meridian, or in the x meridian with `x`.
fn power_curvature(s: &Surface, x: bool) -> f32 {
    // A cylinder with its axis along y has no power in the y meridian, one along x none in x.
    let flat = if x {
        SURFACE_CYLINDER_X
    } else {
        SURFACE_CYLINDER_Y
    };
    if s.kind == flat {
        0.0
    } else {
        s.curvature
    }
}

/// Traces a paraxial ray forward (object to image) through `surfaces` from surface `from` to the
/// last, starting in front of `from` with `ray` in a medium of signed index `n0` (1 for air in
/// front of the lens). Returns the ray after the last surface and the heights at each surface met.
pub fn trace_forward(
    surfaces: &[Surface],
    band: usize,
    from: usize,
    ray: ParaxialRay,
    heights: &mut Vec<f32>,
) -> ParaxialRay {
    trace_forward_in(surfaces, band, from, ray, heights, false)
}

/// [`trace_forward`] in the y meridian, or in the x meridian with `x` (an anamorphic lens's
/// squeezed one).
pub fn trace_forward_in(
    surfaces: &[Surface],
    band: usize,
    from: usize,
    ray: ParaxialRay,
    heights: &mut Vec<f32>,
    x: bool,
) -> ParaxialRay {
    heights.clear();
    let ParaxialRay { mut y, mut u } = ray;
    let mut n = if from == 0 {
        1.0
    } else {
        signed_index(surfaces, from - 1, band)
    };
    for i in from..surfaces.len() {
        let s = &surfaces[i];
        heights.push(y);
        let np = signed_index(surfaces, i, band);
        let c = power_curvature(s, x);
        u = (n * u - y * c * (np - n)) / np;
        n = np;
        if i + 1 < surfaces.len() {
            y += s.thickness * u;
        }
    }
    ParaxialRay { y, u }
}

/// The signed index of the medium after surface `i`: negative while the light travels −z (after
/// an odd number of mirrors).
pub fn signed_index(surfaces: &[Surface], i: usize, band: usize) -> f32 {
    let mut sign = 1.0f32;
    for s in &surfaces[..=i] {
        if s.kind == SURFACE_MIRROR {
            sign = -sign;
        }
    }
    sign * surfaces[i].index[band]
}

/// Effective focal length and back focal distance (from the last vertex, along the direction the
/// light leaves in) of `surfaces` for parallel light: `None` for an afocal system.
pub fn efl_bfl(surfaces: &[Surface], band: usize) -> Option<(f32, f32)> {
    let mut h = Vec::new();
    let out = trace_forward(surfaces, band, 0, ParaxialRay { y: 1.0, u: 0.0 }, &mut h);
    if out.u.abs() < 1.0e-9 {
        return None;
    }
    let dir = if signed_index(surfaces, surfaces.len() - 1, band) < 0.0 {
        -1.0
    } else {
        1.0
    };
    Some((-1.0 / out.u, -out.y / out.u * dir))
}

/// Where the image of an axial object point lies, as a distance past the last vertex along the
/// direction the light leaves in, for an object `object_distance` in front of the first vertex
/// (`f32::INFINITY` for parallel light); `None` when the image is at infinity.
pub fn image_distance(surfaces: &[Surface], band: usize, object_distance: f32) -> Option<f32> {
    image_distance_in(surfaces, band, object_distance, false)
}

/// [`image_distance`] in the y meridian, or in the x meridian with `x`.
pub fn image_distance_in(
    surfaces: &[Surface],
    band: usize,
    object_distance: f32,
    x: bool,
) -> Option<f32> {
    let mut h = Vec::new();
    let ray = if object_distance.is_finite() {
        // A ray from the axial object point: height 1 at the first vertex, slope 1 / distance.
        ParaxialRay {
            y: 1.0,
            u: 1.0 / object_distance,
        }
    } else {
        ParaxialRay { y: 1.0, u: 0.0 }
    };
    let out = trace_forward_in(surfaces, band, 0, ray, &mut h, x);
    if out.u.abs() < 1.0e-12 {
        return None;
    }
    let dir = if signed_index(surfaces, surfaces.len() - 1, band) < 0.0 {
        -1.0
    } else {
        1.0
    };
    Some(-out.y / out.u * dir)
}

/// The entrance pupil of a lens whose aperture stop is surface `stop`: its position (on the z of
/// the vertices, the first at 0) and its radius for a stop of radius 1. Paraxial optics is linear,
/// so two rays from object space settle it: the height a ray reaches at the stop is
/// `a y0 + b u0` (height and slope at the first vertex); the ray through the stop's centre crosses
/// the axis at `z0 + b / a`, and a parallel beam of radius `1 / a` just fills the stop.
pub fn entrance_pupil(surfaces: &[Surface], z: &[f32], stop: usize, band: usize) -> (f32, f32) {
    let mut h = Vec::new();
    trace_forward(surfaces, band, 0, ParaxialRay { y: 1.0, u: 0.0 }, &mut h);
    let a = h[stop];
    trace_forward(surfaces, band, 0, ParaxialRay { y: 0.0, u: 1.0 }, &mut h);
    let b = h[stop];
    if a.abs() < 1.0e-12 {
        return (z[0], 1.0);
    }
    (z[0] + b / a, 1.0 / a.abs())
}

/// The paraxial height of a marginal ray (parallel, height 1 at the first vertex) and of a chief
/// ray (through the centre of the stop, slope `tan_field` in object space) at every surface: the
/// semi-aperture a surface needs to pass the beam of a field point, per unit of entrance pupil.
pub fn marginal_and_chief(
    surfaces: &[Surface],
    z: &[f32],
    stop: usize,
    band: usize,
    tan_field: f32,
) -> (Vec<f32>, Vec<f32>) {
    let mut marginal = Vec::new();
    trace_forward(
        surfaces,
        band,
        0,
        ParaxialRay { y: 1.0, u: 0.0 },
        &mut marginal,
    );
    let (pupil_z, _) = entrance_pupil(surfaces, z, stop, band);
    // The chief ray aims at the entrance pupil's centre: at the first vertex it is
    // (z0 − pupil_z) tan above the axis... on the side that makes it cross at the pupil.
    let y0 = (z[0] - pupil_z) * tan_field;
    let mut chief = Vec::new();
    trace_forward(
        surfaces,
        band,
        0,
        ParaxialRay {
            y: y0,
            u: tan_field,
        },
        &mut chief,
    );
    (marginal, chief)
}
