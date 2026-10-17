//! O4: a traced lens tilted against the sensor (Scheimpflug through the real surfaces).
//!
//! The lens turns about the camera position (its entrance pupil at infinity focus, so the
//! perspective does not move) by an angle `α'` about an axis in the sensor plane, the same axis
//! and the same sense of turn as the simple lens's tilt (`super::super::Lens::thin_ray`). The
//! sensor stays square to the camera's view and sits where the lens images the focus point, the
//! point `focus_dist` along the view from the camera position: that point stays in the centre of
//! the frame and sharp, and the frame does not swing.
//!
//! The plane of sharp focus is then the object-space conjugate of the sensor plane through the
//! lens's own paraxial optics (a collineation maps a plane to a plane: Scheimpflug and the hinge
//! rule of a thick lens, H. M. Merklinger, *Focusing the View Camera*, 1993, and R. Kingslake,
//! *Optics in Photography*, 1992, ch. 4), and the real rays converge on it up to the lens's own
//! aberrations. The angle the lens takes is solved so that this plane leans exactly as the simple
//! lens's plane of the same settings does (`f·forward + u·sin α·b`, the hinge rule of a thin lens
//! of the camera's focal length at the camera position): the person's tilt means the same plane
//! of focus with either lens, and the interface's overlay and its two-point solve hold for both.
//! The angle itself (`α'`, a little more or less than `α`, as the lens's principal planes sit away
//! from the entrance pupil) is what the engine reports.
//!
//! The rays from a tilted sensor reach the rear plane through other rectangles than an upright
//! one's, and no longer by image height alone: the bounds are traced on a [`TILT_GRID`]² grid of
//! sensor positions, and a sample draws from the union of the four nodes around it. A sample
//! weighs `A |cos θ_rear|³ |cos θ_sensor| / Z²` over the upright on-axis integral, the cosine at
//! the sensor taken against its own (tilted) normal. Everything with `+ − × ÷ sqrt` and
//! `fmath::sin_cos`: the same bits on every platform. A lens without a tilt never comes here.

use super::{
    focus_state, positions, unit, with_gaps, MovingGap, Prescription, SampleSetup, Surface, Traced,
    TracedLens, PUPIL_GRID, SURFACE_CYLINDER_X, SURFACE_CYLINDER_Y,
};
use crate::fmath;
use crate::math::Vec3;

/// Nodes per side of the grid of sensor positions where a tilted lens's pupil bounds are traced.
pub const TILT_GRID: usize = 9;
/// The largest angle the lens may take to reach the plane asked for, degrees.
pub const MAX_TRACED_TILT_DEG: f32 = 60.0;

/// A turn by `α` about the unit axis `a` in the sensor plane (the camera's x right, y up, z back):
/// [`Rot::to_body`] takes the lens frame to the camera's, [`Rot::to_lens`] back.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Rot {
    a: Vec3,
    s: f32,
    c: f32,
}

impl Rot {
    fn new(a: Vec3, alpha: f32) -> Rot {
        let (s, c) = fmath::sin_cos(alpha);
        Rot { a, s, c }
    }

    /// The lens frame's `w` in the camera's: forward (−z) goes to `forward cos α + b sin α` with
    /// `b = forward × a`, as the simple lens turns its lens plane.
    pub(crate) fn to_body(self, w: Vec3) -> Vec3 {
        w * self.c + w.cross(self.a) * self.s + self.a * (self.a.dot(w) * (1.0 - self.c))
    }

    /// The inverse of [`Rot::to_body`].
    pub(crate) fn to_lens(self, w: Vec3) -> Vec3 {
        w * self.c - w.cross(self.a) * self.s + self.a * (self.a.dot(w) * (1.0 - self.c))
    }
}

/// The paraxial transfer of a focused lens from its first vertex (at 0) to its last (at
/// `z_last`), in air on both sides: `(y, u)` at the last vertex is `[[a, b], [c, d]]` times `(y, u)`
/// at the first, `u` the slope `dy/dz`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Abcd {
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    z_last: f32,
}

impl Abcd {
    /// The transfer of `surfaces` (band G, the y meridian), `None` when the light leaves going −z.
    pub(crate) fn of(surfaces: &[Surface]) -> Option<Abcd> {
        let n = surfaces.len();
        if super::paraxial::signed_index(surfaces, n - 1, 1) < 0.0 {
            return None;
        }
        let mut h = Vec::new();
        let ray = |y: f32, u: f32| super::paraxial::ParaxialRay { y, u };
        let one = super::paraxial::trace_forward(surfaces, 1, 0, ray(1.0, 0.0), &mut h);
        let two = super::paraxial::trace_forward(surfaces, 1, 0, ray(0.0, 1.0), &mut h);
        Some(Abcd {
            a: one.y,
            b: two.y,
            c: one.u,
            d: two.u,
            z_last: positions(surfaces)[n - 1],
        })
    }

    /// The paraxial image of the object point `o` (lens frame, in front of the first vertex).
    pub(crate) fn image(&self, o: Vec3) -> Option<Vec3> {
        let s = -o.z;
        let den = self.c * s + self.d;
        if den == 0.0 {
            return None;
        }
        let dz = -(self.a * s + self.b) / den;
        let m = self.a + dz * self.c;
        Some(Vec3::new(m * o.x, m * o.y, self.z_last + dz))
    }

    /// The object point whose paraxial image is `i` (lens frame).
    pub(crate) fn object(&self, i: Vec3) -> Option<Vec3> {
        let dz = i.z - self.z_last;
        let m = self.a + dz * self.c;
        if m == 0.0 {
            return None;
        }
        let s = -(self.b + dz * self.d) / m;
        Some(Vec3::new(i.x / m, i.y / m, -s))
    }
}

/// What [`fit`] settles for a tilted lens: the angle, the focus and where the sensor sits.
pub(crate) struct Fit {
    /// The angle the lens takes, radians.
    pub alpha: f32,
    /// The upright sensor plane's position at that focus (the axis's image), lens frame.
    pub sensor_z: f32,
    /// The fraction of the moving gaps' travel.
    pub t: f32,
    /// The turn of the lens.
    pub rot: Rot,
    /// The image of the focus point: the centre of the sensor, lens frame.
    pub centre: Vec3,
}

/// The camera's forward in the lens-like frame (x right, y up, z back).
const FORWARD: Vec3 = Vec3::new(0.0, 0.0, -1.0);

/// Solves the angle of a tilted lens (see the module): the sensor's centre is the image of the
/// focus point and the plane of sharp focus leans as the simple lens's of the same tilt, focal
/// length and focus distance does.
#[allow(clippy::too_many_arguments)]
pub(crate) fn fit(
    surfaces: &[Surface],
    moving: &[MovingGap],
    p: &Prescription,
    lens: &crate::optics::LensParams,
    camera: super::CameraOptics,
    pupil_z: f32,
    z_last: f32,
    infinity: (f32, f32),
) -> Result<Fit, &'static str> {
    if surfaces
        .iter()
        .any(|s| matches!(s.kind, SURFACE_CYLINDER_X | SURFACE_CYLINDER_Y))
    {
        return Err("a traced lens with cylinders does not tilt");
    }
    let (sa, ca) = fmath::sin_cos(lens.tilt_axis_deg * fmath::DEG_TO_RAD);
    let axis = Vec3::new(ca, sa, 0.0);
    let b = FORWARD.cross(axis);
    let u = camera.focus_dist;
    let (sin_t, _) = fmath::sin_cos(lens.tilt_deg * fmath::DEG_TO_RAD);
    // The simple lens's plane: its normal `f·forward + u·sin α·b`, as a slope against forward.
    let target = u * sin_t / camera.focal_mm;
    let pivot = Vec3::new(0.0, 0.0, pupil_z);
    let k = 0.1 * camera.sensor_mm;
    let solve_at = |alpha: f32| -> Option<(f32, Fit)> {
        let rot = Rot::new(axis, alpha);
        let object = u * rot.c - pupil_z;
        let (sensor_z, t) = focus_state(surfaces, moving, p, object, z_last, infinity);
        let m = if t != 0.0 {
            Abcd::of(&with_gaps(surfaces, moving, t))?
        } else {
            Abcd::of(surfaces)?
        };
        let p0 = pivot + rot.to_lens(FORWARD) * u;
        let centre = m.image(p0)?;
        let (ex, ey) = (
            rot.to_lens(Vec3::new(1.0, 0.0, 0.0)),
            rot.to_lens(Vec3::new(0.0, 1.0, 0.0)),
        );
        let o0 = m.object(centre)?;
        let o1 = m.object(centre + ex * k)?;
        let o2 = m.object(centre + ey * k)?;
        let n = rot.to_body((o1 - o0).cross(o2 - o0));
        let along = n.dot(FORWARD);
        if along == 0.0 || !centre.is_finite() {
            return None;
        }
        Some((
            n.dot(b) / along,
            Fit {
                alpha,
                sensor_z,
                t,
                rot,
                centre,
            },
        ))
    };
    let sign = if lens.tilt_deg < 0.0 { -1.0 } else { 1.0 };
    let max = sign * MAX_TRACED_TILT_DEG * fmath::DEG_TO_RAD;
    let (mut lo, mut hi) = (0.0f32, max);
    let miss = |alpha: f32| solve_at(alpha).map(|(slope, _)| slope - target);
    let (Some(at_lo), Some(at_hi)) = (miss(lo), miss(hi)) else {
        return Err("the lens forms no image of the tilted focus");
    };
    if at_lo.signum() == at_hi.signum() {
        return Err("the tilt is beyond what the lens reaches");
    }
    for _ in 0..40 {
        let mid = 0.5 * (lo + hi);
        match miss(mid) {
            Some(m) if m.signum() == at_lo.signum() => lo = mid,
            _ => hi = mid,
        }
    }
    solve_at(0.5 * (lo + hi))
        .map(|(_, f)| f)
        .ok_or("the lens forms no image of the tilted focus")
}

/// A traced lens's tilt as the samples use it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Tilt {
    /// The turn from the lens frame to the camera's.
    rot: Rot,
    /// Where the two frames meet: the camera position, lens frame.
    pivot: Vec3,
    /// The centre of the sensor (the focus point's image), lens frame.
    centre: Vec3,
    /// The sensor's right and up and its normal (back), lens frame.
    ex: Vec3,
    ey: Vec3,
    normal: Vec3,
    /// Half the side of the square of sensor positions the grid covers, and its step, mm.
    reach: f32,
    step: f32,
    /// Per node (row-major, y up the rows), the rectangle `[x0, x1, y0, y1]` on the rear plane
    /// (lens frame, not turned) the rays of its film point pass through (empty: `x1 < x0`).
    bounds: Vec<[f32; 4]>,
    /// Per node, where its chief ray (through the centre of the stop) crosses the rear plane.
    chief: Vec<(f32, f32)>,
    /// The angle the lens takes, degrees.
    pub(crate) deg: f32,
    /// The same, radians.
    alpha: f32,
}

impl Tilt {
    /// The tilt of `fit`, before its grid is traced.
    pub(crate) fn new(fit: &Fit, pupil_z: f32) -> Tilt {
        let rot = fit.rot;
        Tilt {
            rot,
            pivot: Vec3::new(0.0, 0.0, pupil_z),
            centre: fit.centre,
            ex: rot.to_lens(Vec3::new(1.0, 0.0, 0.0)),
            ey: rot.to_lens(Vec3::new(0.0, 1.0, 0.0)),
            normal: rot.to_lens(Vec3::new(0.0, 0.0, 1.0)),
            reach: 0.0,
            step: 1.0,
            bounds: Vec::new(),
            chief: Vec::new(),
            deg: fit.alpha / fmath::DEG_TO_RAD,
            alpha: fit.alpha,
        }
    }

    /// The tilt turned by `rot` with the sensor's centre at `centre` (lens frame).
    fn with(&self, rot: Rot, centre: Vec3, alpha: f32) -> Tilt {
        Tilt {
            rot,
            centre,
            ex: rot.to_lens(Vec3::new(1.0, 0.0, 0.0)),
            ey: rot.to_lens(Vec3::new(0.0, 1.0, 0.0)),
            normal: rot.to_lens(Vec3::new(0.0, 0.0, 1.0)),
            deg: alpha / fmath::DEG_TO_RAD,
            alpha,
            ..self.clone()
        }
    }

    /// How far the sensor's centre sits from the lens's axis, mm.
    pub(crate) fn offset(&self) -> f32 {
        (self.centre.x * self.centre.x + self.centre.y * self.centre.y).sqrt()
    }

    /// The film point of the sensor position `(x, y)` (camera frame, from the frame's centre,
    /// after the overrides): the image is upside down on the sensor.
    pub(crate) fn film(&self, x: f32, y: f32) -> Vec3 {
        self.centre - self.ex * x - self.ey * y
    }

    /// A lens-frame ray in the camera's frame (the lens-like frame [`super::super::Lens`] puts in
    /// the world).
    pub(crate) fn to_body(&self, t: Traced) -> Traced {
        match t {
            Traced::Out { origin, dir } => Traced::Out {
                origin: self.pivot + self.rot.to_body(origin - self.pivot),
                dir: self.rot.to_body(dir),
            },
            Traced::Blocked => Traced::Blocked,
        }
    }

    /// The four nodes around the sensor position `(x, y)` and the position between them.
    fn around(&self, x: f32, y: f32) -> ([usize; 4], f32, f32) {
        let last = (TILT_GRID - 1) as f32;
        let fx = ((x + self.reach) / self.step).clamp(0.0, last);
        let fy = ((y + self.reach) / self.step).clamp(0.0, last);
        let (i0, j0) = (
            (fx as usize).min(TILT_GRID - 1),
            (fy as usize).min(TILT_GRID - 1),
        );
        let (i1, j1) = ((i0 + 1).min(TILT_GRID - 1), (j0 + 1).min(TILT_GRID - 1));
        let at = |i: usize, j: usize| j * TILT_GRID + i;
        (
            [at(i0, j0), at(i1, j0), at(i0, j1), at(i1, j1)],
            fx - i0 as f32,
            fy - j0 as f32,
        )
    }

    /// The union of the rectangles of the four nodes around `(x, y)`; `None` when none passes.
    fn rect(&self, nodes: &[usize; 4]) -> Option<[f32; 4]> {
        let mut r = [f32::MAX, f32::MIN, f32::MAX, f32::MIN];
        for &k in nodes {
            let b = self.bounds[k];
            if b[1] < b[0] {
                continue;
            }
            r = [
                r[0].min(b[0]),
                r[1].max(b[1]),
                r[2].min(b[2]),
                r[3].max(b[3]),
            ];
        }
        (r[1] >= r[0] && r[3] >= r[2]).then_some(r)
    }
}

impl TracedLens {
    /// The rectangle `[x0, x1, y0, y1]` on the rear plane that the rays of `film` pass through
    /// (one cell wider; empty: `x1 < x0`), as for the grid of an upright lens's bounds.
    fn rect_at(&self, film: Vec3) -> [f32; 4] {
        let g = PUPIL_GRID;
        let r = self.rear_radius;
        let cell = 2.0 * r / g as f32;
        let rear_z = self.z[self.z.len() - 1];
        let (mut x0, mut x1, mut y0, mut y1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
        for jj in 0..g {
            for ii in 0..g {
                let q = Vec3::new(
                    -r + (ii as f32 + 0.5) * cell,
                    -r + (jj as f32 + 0.5) * cell,
                    rear_z,
                );
                let d = unit(q - film);
                let any = (0..3)
                    .any(|band| matches!(self.trace(film, d, band, true), Traced::Out { .. }));
                if any {
                    x0 = x0.min(q.x - cell);
                    x1 = x1.max(q.x + cell);
                    y0 = y0.min(q.y - cell);
                    y1 = y1.max(q.y + cell);
                }
            }
        }
        if x1 >= x0 {
            [x0.max(-r), x1.min(r), y0.max(-r), y1.min(r)]
        } else {
            [0.0, -1.0, 0.0, -1.0]
        }
    }

    /// Where the real rays of the sensor position `(x, y)` (from the frame's centre) meet, as a
    /// distance along its chief ray from the camera position, and that ray's direction (camera
    /// frame): the mean of the two meridians, from rays through a fifth of the beam on either
    /// side of the chief ray (band G). `None` when the lens stops them.
    fn sharp_at(&self, tilt: &Tilt, x: f32, y: f32) -> Option<(f32, Vec3)> {
        let film = tilt.film(x, y);
        let rect = self.rect_at(film);
        if rect[1] < rect[0] {
            return None;
        }
        let c = self.chief_rear_at(film, rect);
        let (hw, hh) = (0.5 * (rect[1] - rect[0]), 0.5 * (rect[3] - rect[2]));
        let rear_z = self.z[self.z.len() - 1];
        let ray = |p: (f32, f32)| -> Option<(Vec3, Vec3)> {
            let q = Vec3::new(c.0 + p.0 * hw, c.1 + p.1 * hh, rear_z);
            match tilt.to_body(self.trace(film, unit(q - film), 1, false)) {
                Traced::Out { origin, dir } => Some((origin, dir)),
                Traced::Blocked => None,
            }
        };
        let (_, w) = ray((0.0, 0.0))?;
        // Each ray as a line over the depth `t` along `w` from the camera position: a + t·b.
        let line = |(o, d): (Vec3, Vec3)| {
            let dw = d.dot(w);
            let b = d * (1.0 / dw);
            (o - b * (o - tilt.pivot).dot(w), b)
        };
        let mut sum = 0.0f32;
        for (pa, pb) in [((0.2, 0.0), (-0.2, 0.0)), ((0.0, 0.2), (0.0, -0.2))] {
            let (a1, b1) = line(ray(pa)?);
            let (a2, b2) = line(ray(pb)?);
            let (da, db) = (a1 - a2, b1 - b2);
            let bb = db.dot(db);
            if bb == 0.0 {
                return None;
            }
            sum += -da.dot(db) / bb;
        }
        Some((0.5 * sum, w))
    }

    /// The tilt refined with real rays (see the module): the sensor moved along its normal until
    /// the real rays of the frame's centre meet at the focus point (the lens's own field curvature
    /// and spherical aberration where the tilt puts that point, which the paraxial fit does not
    /// see), by four secant steps (fewer when they fail: the paraxial fit stays). The angle stays
    /// the paraxial fit's: away from the centre the lens's field curvature and astigmatism bend
    /// the plane, as they do the upright lens's.
    pub(crate) fn refine_tilt(&self, tilt: Tilt, camera: super::CameraOptics) -> Tilt {
        let u = camera.focus_dist;
        let normal = tilt.normal;
        let state = |delta: f32| tilt.with(tilt.rot, tilt.centre + normal * delta, tilt.alpha);
        let miss = |delta: f32| -> Option<f32> {
            let (c, _) = self.sharp_at(&state(delta), 0.0, 0.0)?;
            Some(c - u)
        };
        let (mut d0, mut d1) = (0.0f32, 0.05f32);
        let (Some(mut m0), Some(mut m1)) = (miss(d0), miss(d1)) else {
            return tilt;
        };
        let mut best = (m0.abs(), d0);
        if m1.abs() < best.0 {
            best = (m1.abs(), d1);
        }
        for _ in 0..4 {
            if m1 == m0 {
                break;
            }
            let next = d1 - m1 * (d1 - d0) / (m1 - m0);
            if !next.is_finite() || next.abs() > 5.0 {
                break;
            }
            let Some(m) = miss(next) else {
                break;
            };
            (d0, m0, d1, m1) = (d1, m1, next, m);
            if m.abs() < best.0 {
                best = (m.abs(), next);
            }
        }
        state(best.1)
    }

    /// Traces the bounds and the chief rays of a tilted lens on its grid of sensor positions
    /// within `±reach` (after [`TracedLens::precompute`]).
    pub(crate) fn precompute_tilt(&mut self, reach: f32) {
        let Some(mut tilt) = self.tilt.take() else {
            return;
        };
        tilt.reach = reach;
        tilt.step = 2.0 * reach / (TILT_GRID - 1) as f32;
        tilt.bounds = Vec::with_capacity(TILT_GRID * TILT_GRID);
        tilt.chief = Vec::with_capacity(TILT_GRID * TILT_GRID);
        for j in 0..TILT_GRID {
            for i in 0..TILT_GRID {
                let film = tilt.film(-reach + i as f32 * tilt.step, -reach + j as f32 * tilt.step);
                let rect = self.rect_at(film);
                tilt.chief.push(self.chief_rear_at(film, rect));
                tilt.bounds.push(rect);
            }
        }
        self.tilt = Some(tilt);
    }

    /// Where on the rear plane the ray from `film` that crosses the centre of the stop does, by
    /// Newton steps from the centre of `rect` (its centre when they fail).
    fn chief_rear_at(&self, film: Vec3, rect: [f32; 4]) -> (f32, f32) {
        if rect[1] < rect[0] {
            return (0.0, 0.0);
        }
        let rear_z = self.z[self.z.len() - 1];
        let at_stop =
            |q: (f32, f32)| self.stop_point(film, unit(Vec3::new(q.0, q.1, rear_z) - film));
        let mut q = (0.5 * (rect[0] + rect[1]), 0.5 * (rect[2] + rect[3]));
        let h = 1.0e-3 * self.rear_radius;
        for _ in 0..8 {
            let (Some(f), Some(fx), Some(fy)) =
                (at_stop(q), at_stop((q.0 + h, q.1)), at_stop((q.0, q.1 + h)))
            else {
                break;
            };
            let (j00, j01) = ((fx.0 - f.0) / h, (fy.0 - f.0) / h);
            let (j10, j11) = ((fx.1 - f.1) / h, (fy.1 - f.1) / h);
            let det = j00 * j11 - j01 * j10;
            if det == 0.0 || !det.is_finite() {
                break;
            }
            let next = (
                q.0 - (j11 * f.0 - j01 * f.1) / det,
                q.1 - (-j10 * f.0 + j00 * f.1) / det,
            );
            if !(next.0.is_finite() && next.1.is_finite()) {
                break;
            }
            q = next;
        }
        q
    }

    /// [`TracedLens::sample_setup`] of a tilted lens.
    #[inline(always)]
    pub(crate) fn sample_setup_tilted(
        &self,
        tilt: &Tilt,
        x: f32,
        y: f32,
        u: (f32, f32),
        swirl: f32,
    ) -> Option<SampleSetup> {
        let (xs, ys, h) = self.film_xy(x, y);
        let film = tilt.film(xs, ys);
        let (nodes, _, _) = tilt.around(xs, ys);
        let rect = tilt.rect(&nodes)?;
        let (w, hgt) = (rect[1] - rect[0], rect[3] - rect[2]);
        let mut px = rect[0] + u.0 * w;
        let mut py = rect[2] + u.1 * hgt;
        let mut jacobian = 1.0;
        if swirl > 0.0 {
            // Artistic, as for an upright lens: about the rectangle's centre, along the radial
            // direction of the film point from the axis.
            let r = (film.x * film.x + film.y * film.y).sqrt();
            let (c, s) = if r > 0.0 {
                (film.x / r, film.y / r)
            } else {
                (1.0, 0.0)
            };
            let k = swirl * h;
            let (cx, cy) = (0.5 * (rect[0] + rect[1]), 0.5 * (rect[2] + rect[3]));
            let (dx, dy) = (px - cx, py - cy);
            let radial = (dx * c + dy * s) * (1.0 - super::super::SWIRL_COMPRESS * k).max(0.05);
            let tangential = (dy * c - dx * s) * (1.0 + super::super::SWIRL_STRETCH * k);
            let (sn, cs) = fmath::sin_cos(super::super::SWIRL_TURN * k);
            let (rr, tt) = (cs * radial - sn * tangential, sn * radial + cs * tangential);
            px = cx + rr * c - tt * s;
            py = cy + rr * s + tt * c;
            jacobian = (1.0 - super::super::SWIRL_COMPRESS * k).max(0.05)
                * (1.0 + super::super::SWIRL_STRETCH * k);
        }
        let rear_z = self.z[self.z.len() - 1];
        let delta = Vec3::new(px, py, rear_z) - film;
        let len2 = delta.dot(delta);
        let d = delta * (1.0 / len2.sqrt());
        Some(SampleSetup {
            film,
            d,
            area: w * hgt * jacobian,
            h,
        })
    }

    /// [`TracedLens::sample_finish`] of a tilted lens: the ray in the camera's frame, and the
    /// weight with the cosine at the tilted sensor.
    #[inline(always)]
    pub(crate) fn sample_finish_tilted(
        &self,
        tilt: &Tilt,
        setup: &SampleSetup,
        band: usize,
        traced: Traced,
        stopped: bool,
    ) -> (Traced, f32) {
        let traced = tilt.to_body(traced);
        if stopped {
            return (traced, 0.0);
        }
        let rear_z = self.z[self.z.len() - 1];
        let (film, d, h) = (setup.film, setup.d, setup.h);
        let zz = film.z - rear_z;
        let dz = d.z.abs();
        let cos_sensor = d.dot(tilt.normal).abs();
        let mut weight =
            setup.area * dz * dz * dz * cos_sensor / (zz * zz) / self.normaliser * self.tint[band];
        if self.vignetting > 0.0 {
            weight *= (1.0 - self.vignetting * h * h).max(0.0);
        }
        (traced, weight)
    }

    /// The film point (lens frame) of the sensor position `(x, y)`, tilted or not (tests).
    #[cfg(test)]
    pub(crate) fn film_at(&self, x: f32, y: f32) -> Vec3 {
        let (xs, ys, _) = self.film_xy(x, y);
        match &self.tilt {
            Some(t) => t.film(xs, ys),
            None => self.film(xs, ys),
        }
    }

    /// [`TracedLens::chief`] of a tilted lens.
    pub(crate) fn chief_tilted(&self, tilt: &Tilt, x: f32, y: f32, p: (f32, f32)) -> Traced {
        let (xs, ys, _) = self.film_xy(x, y);
        let film = tilt.film(xs, ys);
        let (nodes, tx, ty) = tilt.around(xs, ys);
        let c = |k: usize| tilt.chief[nodes[k]];
        let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
        let (c0, c1, c2, c3) = (c(0), c(1), c(2), c(3));
        let cx = lerp(lerp(c0.0, c1.0, tx), lerp(c2.0, c3.0, tx), ty);
        let cy = lerp(lerp(c0.1, c1.1, tx), lerp(c2.1, c3.1, tx), ty);
        let (hw, hh) = match tilt.rect(&nodes) {
            Some(r) => (0.5 * (r[1] - r[0]), 0.5 * (r[3] - r[2])),
            None => (0.0, 0.0),
        };
        let rear_z = self.z[self.z.len() - 1];
        let q = Vec3::new(cx + p.0 * hw, cy + p.1 * hh, rear_z);
        tilt.to_body(self.trace(film, unit(q - film), 1, false))
    }
}
