//! Camera optics beyond the plain thin lens: the `LENS` section of an RSB file.
//!
//! # The enhanced thin lens (O1)
//!
//! A camera with a [`Lens`] is still a thin lens of `focal_mm` at `fstop` focused at `focus_dist`
//! (`CAMR`), and a lens whose every knob is neutral renders exactly as the plain thin lens. On top
//! of it, per camera sample:
//!
//! 1. **Pupil.** The point on the aperture comes from the two lens dimensions of the sampler
//!    ([`DIM_LENS`]) through [`pupil::Pupil`]: a round iris, an iris of 3 to 18 straight or curved
//!    blades turned by a rotation, or a picture (an aperture mask that replaces the iris, or a
//!    texture multiplied with it), with a radial density profile (uniform, bright centre, bright
//!    ring, apodized) and a central obstruction. Everything is sampled with its exact density:
//!    nothing is rejected and no sample is weighted, so the stratification of the Sobol points
//!    carries over and the brightness does not change.
//! 2. **Swirl** (artistic, *not physical*): the pupil point is compressed along the image's
//!    radial direction, stretched along the tangential one and turned, in proportion to the
//!    image height `h` (0 on the axis, 1 at the corner of the frame, `field_mm`).
//! 3. **Cat's eye**: the beam of a point off the axis is clipped by a second disc of the pupil's
//!    radius, displaced towards the axis by `cats_eye × h` radii. A sample outside it is blocked:
//!    it still traces its ray (for the coverage of a transparent background) but brings no light,
//!    which is the optical vignetting that comes with the cat's eye of a real lens.
//! 4. **Chromatic aberration by bands** (artistic, *not physical*; decision 3 of the lead): with
//!    `ca_amount > 0` each sample takes one of the bands R, G, B, stratified over the samples of the
//!    pixel ([`PixelSampler::strata`] of [`DIM_LENS_BAND`]: every three consecutive samples are the
//!    three bands, and the three share one point of the pupil, the band's own Sobol sequence,
//!    so the colours of a disc's interior agree instead of speckling), scales its pupil point radially by
//!    `1 + a·CA_SCALE[band]` and moves it by `a·CA_SHIFT[band]·h` along the image's radial
//!    direction, and weighs only its own channel (three times, so the bands average to white).
//!    The focus plane is the same for every band: what is in focus stays sharp; out-of-focus
//!    discs get coloured rims, more of them towards the edge of the frame.
//! 5. **Anamorphic squeeze**: the pupil is `squeeze` times narrower than tall, so the blur discs
//!    are tall ovals. The image is rendered desqueezed: the projection does not change.
//! 6. **Tilt and shift**: the chief ray of a sensor point `(x, y)` (millimetres, from the centre
//!    of the frame) leaves along `forward·f + right·(x + shift_x) + up·(y + shift_y)`: a shift
//!    moves the frame without changing the perspective. A tilt of `tilt_deg` about an axis in the
//!    sensor plane at `tilt_axis_deg` from the camera's right turns the lens plane (the pupil
//!    lies in it) and the plane of sharp focus by the hinge rule (Merklinger, *Principles of View
//!    Camera Focus*): through the focus point on the axis, `focus_dist` in front of the lens, with
//!    the normal `f·forward + u·sin(α)·b` (`u` the focus distance, `b = forward × axis`), so that
//!    it meets the lens's front focal plane on the hinge line `f / sin α` from the lens, and the
//!    sensor plane `f u / (u cos α − f)` behind it on the lens plane (Scheimpflug). A positive tilt
//!    about the horizontal axis tips the lens down: the focus plane leans back towards the floor.
//!    A chief ray that does not meet the focus plane in front of the lens is focused at infinity.
//!
//! The exact passes (X2) keep the plain thin lens: the `coc` pass is the circle of confusion of a
//! round, untilted aperture of `focal_mm / fstop` ([`crate::passes::coc_diameter`]), whatever the
//! lens. The ray of the exact passes ([`crate::render::centre_ray`]) goes through the lens centre
//! and honours the shift.
//!
//! Only `+ − × ÷ sqrt` and the [`fmath`] functions are used, so a lens gives the same pixels on
//! every platform, and the only new random number (the band) lives beyond the Sobol table: a
//! scene without a `LENS` section draws exactly the numbers it drew before.
//!
//! [`DIM_LENS`]: crate::sampler::DIM_LENS
//! [`DIM_LENS_BAND`]: crate::sampler::DIM_LENS_BAND
//! [`PixelSampler::strata`]: crate::sampler::PixelSampler::strata

pub mod pupil;
#[cfg(test)]
mod tests;

use crate::color::Rgb;
use crate::fmath;
use crate::math::{Ray, Vec3};
use crate::sampler::{PixelSampler, DIM_LENS, DIM_LENS_BAND};
use crate::scene::Camera;
use pupil::{Grid, Iris, Profile, Pupil};

/// `LENS.mask_kind` 0: no picture.
pub const MASK_NONE: u32 = 0;
/// `LENS.mask_kind` 1: the picture is the aperture: it replaces the iris.
pub const MASK_APERTURE: u32 = 1;
/// `LENS.mask_kind` 2: the picture is a transmission texture multiplied with the iris.
pub const MASK_TEXTURE: u32 = 2;
/// Largest side of a mask picture.
pub const MAX_MASK_SIZE: u32 = 1024;
/// Most blades of an iris.
pub const MAX_BLADES: u32 = 18;
/// Largest anamorphic squeeze.
pub const MAX_SQUEEZE: f32 = 4.0;
/// Largest tilt, degrees.
pub const MAX_TILT_DEG: f32 = 45.0;
/// Largest central obstruction, as a fraction of the aperture.
pub const MAX_OBSTRUCTION: f32 = 0.95;

/// Chromatic aberration: radial scale of the pupil per band (R, G, B) at `ca_amount` 1. The mean
/// is zero, so the average disc keeps its size: a green rim and a magenta core.
pub const CA_SCALE: [f32; 3] = [-0.06, 0.12, -0.06];
/// Chromatic aberration: shift of the pupil per band along the image's radial direction, in pupil
/// radii at `ca_amount` 1 and the corner of the frame.
pub const CA_SHIFT: [f32; 3] = [0.05, 0.0, -0.05];
/// Swirl at 1 and the corner of the frame: how much the pupil shrinks along the radius...
pub const SWIRL_COMPRESS: f32 = 0.35;
/// ... grows along the tangent...
pub const SWIRL_STRETCH: f32 = 0.25;
/// ... and turns, radians.
pub const SWIRL_TURN: f32 = 0.6;

/// The fields of a `LENS` section, in file order (see [`crate::scene::rsb`]).
#[derive(Clone, Debug, PartialEq)]
pub struct LensParams {
    /// Iris blades: 0 a circle, otherwise 3 to 18.
    pub blades: u32,
    /// 0 straight blades, 1 the inscribed circle.
    pub roundness: f32,
    /// Turn of the iris (and of an aperture mask), degrees counter-clockwise.
    pub rotation_deg: f32,
    /// Radial profile of the pupil (`pupil::PROFILE_*`); unknown values are uniform.
    pub profile: u32,
    /// Strength of the profile, 0 to 1.
    pub profile_param: f32,
    /// Central obstruction as a fraction of the aperture, 0 to 0.95.
    pub obstruction: f32,
    /// Cat's eye, 0 to 1: the offset of the clipping disc, in pupil radii, at the frame's corner.
    pub cats_eye: f32,
    /// Anamorphic squeeze, 1 to 4: the pupil is this many times taller than wide.
    pub squeeze: f32,
    /// Lens shift, millimetres on the sensor (right, up).
    pub shift_x_mm: f32,
    /// See `shift_x_mm`.
    pub shift_y_mm: f32,
    /// Tilt of the lens, degrees (−45 to 45).
    pub tilt_deg: f32,
    /// Direction of the tilt axis in the sensor plane, degrees from the camera's right.
    pub tilt_axis_deg: f32,
    /// Artistic chromatic aberration, 0 to 1.
    pub ca_amount: f32,
    /// Artistic swirl, 0 to 1.
    pub swirl: f32,
    /// Image height, millimetres on the sensor, where `h` is 1 (0: half the image's diagonal).
    pub field_mm: f32,
    /// [`MASK_NONE`], [`MASK_APERTURE`] or [`MASK_TEXTURE`].
    pub mask_kind: u32,
    /// Size of the picture (0 without one).
    pub mask_width: u32,
    /// See `mask_width`.
    pub mask_height: u32,
    /// The picture: 8-bit transmission (255 open), row-major, rows top to bottom, covering
    /// `[−1, 1]²` of the pupil with `y` up and the unit circle inscribed.
    pub mask: Vec<u8>,
}

impl Default for LensParams {
    fn default() -> LensParams {
        LensParams {
            blades: 0,
            roundness: 0.0,
            rotation_deg: 0.0,
            profile: pupil::PROFILE_UNIFORM,
            profile_param: 0.0,
            obstruction: 0.0,
            cats_eye: 0.0,
            squeeze: 1.0,
            shift_x_mm: 0.0,
            shift_y_mm: 0.0,
            tilt_deg: 0.0,
            tilt_axis_deg: 0.0,
            ca_amount: 0.0,
            swirl: 0.0,
            field_mm: 0.0,
            mask_kind: MASK_NONE,
            mask_width: 0,
            mask_height: 0,
            mask: Vec::new(),
        }
    }
}

/// A camera's optics: the parameters of its `LENS` section and what is precomputed from them.
#[derive(Clone, Debug, PartialEq)]
pub struct Lens {
    params: LensParams,
    pupil: Pupil,
    /// `(sin, cos)` of the tilt and of the direction of its axis.
    tilt: (f32, f32),
    tilt_axis: (f32, f32),
}

fn unit(v: f32) -> bool {
    (0.0..=1.0).contains(&v)
}

impl Lens {
    /// Checks `params` and precomputes the pupil. The error says which field is wrong.
    pub fn new(params: LensParams) -> Result<Lens, &'static str> {
        let p = &params;
        if p.blades != 0 && !(3..=MAX_BLADES).contains(&p.blades) {
            return Err("blades must be 0 (a circle) or 3 to 18");
        }
        if !unit(p.roundness) || !unit(p.profile_param) || !unit(p.cats_eye) {
            return Err("roundness, profile_param and cats_eye must be between 0 and 1");
        }
        if !unit(p.ca_amount) || !unit(p.swirl) {
            return Err("ca_amount and swirl must be between 0 and 1");
        }
        if !(0.0..=MAX_OBSTRUCTION).contains(&p.obstruction) {
            return Err("obstruction must be between 0 and 0.95");
        }
        if !(1.0..=MAX_SQUEEZE).contains(&p.squeeze) {
            return Err("squeeze must be between 1 and 4");
        }
        if !(-MAX_TILT_DEG..=MAX_TILT_DEG).contains(&p.tilt_deg) {
            return Err("tilt_deg must be between -45 and 45");
        }
        if p.field_mm < 0.0 {
            return Err("field_mm must not be negative");
        }
        let iris = Iris::new(p.blades, p.roundness, p.rotation_deg);
        let profile = Profile::new(p.profile, p.profile_param, p.obstruction);
        let pupil = match p.mask_kind {
            MASK_NONE => {
                if p.mask_width != 0 || p.mask_height != 0 || !p.mask.is_empty() {
                    return Err("a lens without a mask has a mask size of 0");
                }
                Pupil::analytic(&iris, profile)
            }
            MASK_APERTURE | MASK_TEXTURE => {
                let (w, h) = (p.mask_width, p.mask_height);
                if w == 0 || h == 0 || w > MAX_MASK_SIZE || h > MAX_MASK_SIZE {
                    return Err("the mask must be 1 to 1024 pixels on each side");
                }
                if p.mask.len() != (w * h) as usize {
                    return Err("the mask holds the wrong number of pixels");
                }
                let aperture = p.mask_kind == MASK_APERTURE;
                let weights =
                    pupil::grid_weights(&p.mask, w as usize, h as usize, aperture, &iris, &profile);
                let rotation = if aperture { p.rotation_deg } else { 0.0 };
                Pupil::Grid(
                    Grid::new(w as usize, h as usize, &weights, rotation)
                        .ok_or("the mask lets no light through")?,
                )
            }
            _ => return Err("unknown mask_kind"),
        };
        Ok(Lens {
            tilt: fmath::sin_cos(p.tilt_deg * fmath::DEG_TO_RAD),
            tilt_axis: fmath::sin_cos(p.tilt_axis_deg * fmath::DEG_TO_RAD),
            params,
            pupil,
        })
    }

    /// The parameters of the lens (what its `LENS` section holds).
    pub fn params(&self) -> &LensParams {
        &self.params
    }

    /// The pupil sampler.
    pub fn pupil(&self) -> &Pupil {
        &self.pupil
    }

    fn tilted(&self) -> bool {
        self.params.tilt_deg != 0.0
    }

    /// The tilt's axis `a` and `b = forward × a`, from the camera basis.
    fn tilt_frame(&self, forward: Vec3, right: Vec3, up: Vec3) -> (Vec3, Vec3) {
        let (s, c) = self.tilt_axis;
        let a = right * c + up * s;
        (a, forward.cross(a))
    }

    /// The unit normal of the plane of sharp focus (`forward` without a tilt): the hinge rule.
    pub fn focus_normal(&self, camera: &Camera) -> Vec3 {
        let (forward, right, up) = camera.basis();
        if !self.tilted() {
            return forward;
        }
        let (_, b) = self.tilt_frame(forward, right, up);
        (forward * camera.focal_mm + b * (camera.focus_dist * self.tilt.0)).normalize()
    }

    /// The unit normal of the lens plane (where the pupil lies): `forward` turned by the tilt.
    pub fn lens_normal(&self, camera: &Camera) -> Vec3 {
        let (forward, right, up) = camera.basis();
        if !self.tilted() {
            return forward;
        }
        let (_, b) = self.tilt_frame(forward, right, up);
        forward * self.tilt.1 + b * self.tilt.0
    }

    /// The thin-lens ray through the sensor point `(u, v)` and the point `p` of the unit pupil
    /// (after every pupil effect): the camera of `generate_ray` with the shift, the squeeze
    /// already applied to `p`, and the tilt.
    pub fn thin_ray(&self, camera: &Camera, aspect: f32, u: f32, v: f32, p: (f32, f32)) -> Ray {
        let (forward, right, up) = camera.basis();
        let (x, y) = sensor_point(camera, aspect, u, v);
        let (x, y) = self.shifted(x, y);
        let dir = (forward * camera.focal_mm + right * x + up * y).normalize();
        let radius = camera.lens_radius();
        if radius == 0.0 {
            return Ray::new(camera.position, dir);
        }
        if !self.tilted() {
            let focus_point = camera.position + dir * (camera.focus_dist / dir.dot(forward));
            let origin = camera.position + (right * p.0 + up * p.1) * radius;
            return Ray::new(origin, (focus_point - origin).normalize());
        }
        let (a, b) = self.tilt_frame(forward, right, up);
        let (s, c) = self.tilt;
        // The pupil's axes turned with the lens plane (forward goes to forward cos α + b sin α).
        let turn = |w: Vec3| w * c + w.cross(a) * s + a * (a.dot(w) * (1.0 - c));
        let origin = camera.position + (turn(right) * p.0 + turn(up) * p.1) * radius;
        let normal = (forward * camera.focal_mm + b * (camera.focus_dist * s)).normalize();
        let along = dir.dot(normal);
        let t = camera.focus_dist * forward.dot(normal) / along;
        if along > 1.0e-6 && t > 0.0 && t < 1.0e12 {
            let focus_point = camera.position + dir * t;
            Ray::new(origin, (focus_point - origin).normalize())
        } else {
            // The chief ray never meets the focus plane in front of the lens: focus at infinity.
            Ray::new(origin, dir)
        }
    }

    /// A sensor position from the centre of the frame to one from the optical axis (the shift).
    fn shifted(&self, x: f32, y: f32) -> (f32, f32) {
        let p = &self.params;
        let x = if p.shift_x_mm != 0.0 {
            x + p.shift_x_mm
        } else {
            x
        };
        let y = if p.shift_y_mm != 0.0 {
            y + p.shift_y_mm
        } else {
            y
        };
        (x, y)
    }

    /// One camera sample through the sensor point `(u, v)`: the ray and the colour weight of what
    /// it brings back (white, black for a blocked sample, or one channel times three).
    pub fn sample(
        &self,
        camera: &Camera,
        aspect: f32,
        u: f32,
        v: f32,
        sampler: &PixelSampler,
    ) -> (Ray, Rgb) {
        if camera.lens_radius() == 0.0 {
            return (self.thin_ray(camera, aspect, u, v, (0.0, 0.0)), Rgb::WHITE);
        }
        let prm = &self.params;
        // With chromatic aberration the samples go in groups of three, one per band, which share
        // their point of the pupil (each band walks the Sobol points of the lens in order).
        let (band, lens_numbers) = if prm.ca_amount > 0.0 {
            let (band, group) = sampler.strata(DIM_LENS_BAND, 3);
            (band as usize, group.get2(DIM_LENS))
        } else {
            (0, sampler.get2(DIM_LENS))
        };
        let mut p = self.pupil.sample(lens_numbers);
        let mut weight = Rgb::WHITE;
        let field = prm.swirl > 0.0 || prm.cats_eye > 0.0 || prm.ca_amount > 0.0;
        if field {
            // The image height and the radial direction of the sensor point, from the axis.
            let (sx, sy) = sensor_point(camera, aspect, u, v);
            let (x, y) = self.shifted(sx, sy);
            let reference = if prm.field_mm > 0.0 {
                prm.field_mm
            } else {
                let (w, h) = sensor_size(camera, aspect);
                0.5 * (w * w + h * h).sqrt()
            };
            let r = (x * x + y * y).sqrt();
            let h = r / reference;
            let (rx, ry) = if r > 0.0 { (x / r, y / r) } else { (1.0, 0.0) };
            if prm.swirl > 0.0 {
                let k = prm.swirl * h;
                let radial = (p.0 * rx + p.1 * ry) * (1.0 - SWIRL_COMPRESS * k).max(0.05);
                let tangential = (p.1 * rx - p.0 * ry) * (1.0 + SWIRL_STRETCH * k);
                let (s, c) = fmath::sin_cos(SWIRL_TURN * k);
                let (q0, q1) = (radial * rx - tangential * ry, radial * ry + tangential * rx);
                p = (c * q0 - s * q1, s * q0 + c * q1);
            }
            if prm.cats_eye > 0.0 {
                // The second disc, displaced towards the axis.
                let d = prm.cats_eye * h;
                let (dx, dy) = (p.0 + d * rx, p.1 + d * ry);
                if dx * dx + dy * dy > 1.0 {
                    weight = Rgb::BLACK;
                }
            }
            if prm.ca_amount > 0.0 {
                let a = prm.ca_amount;
                let scale = 1.0 + a * CA_SCALE[band];
                let shift = a * CA_SHIFT[band] * h;
                p = (p.0 * scale + shift * rx, p.1 * scale + shift * ry);
                weight = weight * band_weight(band);
            }
        }
        if prm.squeeze != 1.0 {
            p.0 /= prm.squeeze;
        }
        (self.thin_ray(camera, aspect, u, v, p), weight)
    }
}

/// The colour weight of a band: its own channel, three times.
pub fn band_weight(band: usize) -> Rgb {
    match band {
        0 => Rgb::new(3.0, 0.0, 0.0),
        1 => Rgb::new(0.0, 3.0, 0.0),
        _ => Rgb::new(0.0, 0.0, 3.0),
    }
}

/// The sensor's width and height, millimetres (the sensor size is along the longer side).
pub fn sensor_size(camera: &Camera, aspect: f32) -> (f32, f32) {
    if aspect >= 1.0 {
        (camera.sensor_mm, camera.sensor_mm / aspect)
    } else {
        (camera.sensor_mm * aspect, camera.sensor_mm)
    }
}

/// The sensor position of the image point `(u, v)`, millimetres from the centre (x right, y up).
pub fn sensor_point(camera: &Camera, aspect: f32, u: f32, v: f32) -> (f32, f32) {
    let (w, h) = sensor_size(camera, aspect);
    ((u - 0.5) * w, (0.5 - v) * h)
}
