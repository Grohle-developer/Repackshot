//! The traced lens's camera samples in batches (O2, the cost rule of the roadmap and §6.1 of
//! `docs/research/optics.md`): [`LANES`] samples traced through the lens together, surface by
//! surface, lane by lane, in structure-of-arrays form. A single ray is bound by the latency of its
//! two divisions and two square roots per surface; independent lanes fill the pipeline and
//! vectorise. Every lane does exactly the operations of [`TracedLens::sample`], in the same order
//! (no fusion: Rust never contracts `a * b + c`), so a batch gives the scalar path's bits; a lens
//! with an asphere (its Newton steps differ per lane) traces lane by lane.

use super::{
    Traced, TracedLens, SURFACE_ASPHERE, SURFACE_CYLINDER_X, SURFACE_CYLINDER_Y, SURFACE_MIRROR,
    SURFACE_PLANE,
};
use crate::math::Vec3;

/// Samples traced together.
pub const LANES: usize = 8;

/// One lane's input: the sensor position (camera frame, from the axis), the numbers for the point
/// on the rear plane and the band.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BatchSample {
    /// Sensor position, x, mm.
    pub x: f32,
    /// Sensor position, y, mm.
    pub y: f32,
    /// The two uniform numbers of the pupil point.
    pub u: (f32, f32),
    /// The band (0 R, 1 G, 2 B).
    pub band: usize,
}

impl TracedLens {
    /// [`TracedLens::sample`] of up to [`LANES`] samples at once (`samples.len()` of them): the
    /// same rays and weights, bit for bit, lane by lane.
    pub fn sample_batch(&self, samples: &[BatchSample], swirl: f32) -> [(Traced, f32); LANES] {
        let n = samples.len().min(LANES);
        let mut out = [(Traced::Blocked, 0.0f32); LANES];
        let mut setups = [None; LANES];
        let mut film = [Vec3::ZERO; LANES];
        let mut dir = [Vec3::new(0.0, 0.0, -1.0); LANES];
        let mut band = [1usize; LANES];
        let mut live = [false; LANES];
        for k in 0..n {
            let s = samples[k];
            band[k] = s.band.min(2);
            setups[k] = self.sample_setup(s.x, s.y, s.u, swirl);
            if let Some(setup) = &setups[k] {
                film[k] = setup.film;
                dir[k] = setup.d;
                live[k] = true;
            }
        }
        let traced = if self.surfaces.iter().any(|s| s.kind == SURFACE_ASPHERE) {
            let mut t = [(Traced::Blocked, true); LANES];
            for k in 0..n {
                if live[k] {
                    t[k] = self.trace_with(film[k], dir[k], band[k], true, true);
                }
            }
            t
        } else {
            self.trace_lanes(&film, &dir, &band, &live)
        };
        for k in 0..n {
            if let Some(setup) = &setups[k] {
                let (t, stopped) = traced[k];
                out[k] = self.sample_finish(setup, band[k], t, stopped);
            }
        }
        out
    }

    /// `trace_with(film, dir, band, clip = true, through = true)` of every live lane, the lanes
    /// side by side (spheres, planes, cylinders and mirrors).
    #[inline(always)]
    fn trace_lanes(
        &self,
        film: &[Vec3; LANES],
        dir: &[Vec3; LANES],
        band: &[usize; LANES],
        live: &[bool; LANES],
    ) -> [(Traced, bool); LANES] {
        const L: usize = LANES;
        let (mut px, mut py, mut pz) = ([0.0f32; L], [0.0f32; L], [0.0f32; L]);
        let (mut dx, mut dy, mut dz) = ([0.0f32; L], [0.0f32; L], [0.0f32; L]);
        let mut dead = [false; L];
        let mut clip = [true; L];
        let mut stopped = [false; L];
        for k in 0..L {
            (px[k], py[k], pz[k]) = (film[k].x, film[k].y, film[k].z);
            (dx[k], dy[k], dz[k]) = (dir[k].x, dir[k].y, dir[k].z);
            dead[k] = !live[k];
        }
        let surfaces = self.surfaces.iter().zip(&self.z).zip(&self.eta);
        for (i, ((s, &zv), eta)) in surfaces.enumerate().rev() {
            let c = s.curvature;
            // To the tangent plane of the vertex.
            let (mut x0, mut y0) = ([0.0f32; L], [0.0f32; L]);
            for k in 0..L {
                dead[k] |= dz[k] == 0.0;
                let t0 = (zv - pz[k]) / dz[k];
                x0[k] = px[k] + dx[k] * t0;
                y0[k] = py[k] + dy[k] * t0;
            }
            let (mut qx, mut qy, mut qz) = ([0.0f32; L], [0.0f32; L], [0.0f32; L]);
            let (mut nx, mut ny, mut nz) = ([0.0f32; L], [0.0f32; L], [-1.0f32; L]);
            if c == 0.0 || s.kind == SURFACE_PLANE {
                qx = x0;
                qy = y0;
            } else {
                // The stable root of §6.5 on the meridian(s) that have power.
                let (mut r2, mut dot) = ([0.0f32; L], [0.0f32; L]);
                match s.kind {
                    SURFACE_CYLINDER_Y => {
                        for k in 0..L {
                            r2[k] = x0[k] * x0[k];
                            dot[k] = x0[k] * dx[k];
                        }
                    }
                    SURFACE_CYLINDER_X => {
                        for k in 0..L {
                            r2[k] = y0[k] * y0[k];
                            dot[k] = y0[k] * dy[k];
                        }
                    }
                    _ => {
                        for k in 0..L {
                            r2[k] = x0[k] * x0[k] + y0[k] * y0[k];
                            dot[k] = x0[k] * dx[k] + y0[k] * dy[k];
                        }
                    }
                }
                for k in 0..L {
                    let b = dz[k] - c * dot[k];
                    let disc = b * b - c * c * r2[k];
                    let root = disc.sqrt();
                    let den = if b >= 0.0 { b + root } else { b - root };
                    dead[k] |= disc < 0.0 || den == 0.0;
                    let t = c * r2[k] / den;
                    qx[k] = x0[k] + dx[k] * t;
                    qy[k] = y0[k] + dy[k] * t;
                    qz[k] = dz[k] * t;
                }
                match s.kind {
                    SURFACE_CYLINDER_Y => {
                        for k in 0..L {
                            (nx[k], ny[k], nz[k]) = (c * qx[k], 0.0, c * qz[k] - 1.0);
                        }
                    }
                    SURFACE_CYLINDER_X => {
                        for k in 0..L {
                            (nx[k], ny[k], nz[k]) = (0.0, c * qy[k], c * qz[k] - 1.0);
                        }
                    }
                    _ => {
                        for k in 0..L {
                            (nx[k], ny[k], nz[k]) = (c * qx[k], c * qy[k], c * qz[k] - 1.0);
                        }
                    }
                }
            }
            // The rims and the iris: a stopped lane carries on unclipped.
            let semi = s.semi_aperture;
            for k in 0..L {
                if clip[k] && !dead[k] {
                    let r2 = qx[k] * qx[k] + qy[k] * qy[k];
                    let rim = semi > 0.0 && r2 > semi * semi;
                    if rim
                        || (i == self.stop
                            && self.iris_stops(qx[k] / self.stop_radius, qy[k] / self.stop_radius))
                    {
                        stopped[k] = true;
                        clip[k] = false;
                    }
                }
            }
            for k in 0..L {
                px[k] = qx[k];
                py[k] = qy[k];
                pz[k] = zv + qz[k];
            }
            if s.kind == SURFACE_MIRROR {
                for k in 0..L {
                    let two = 2.0 * (dx[k] * nx[k] + dy[k] * ny[k] + dz[k] * nz[k]);
                    dx[k] -= nx[k] * two;
                    dy[k] -= ny[k] * two;
                    dz[k] -= nz[k] * two;
                }
            } else {
                for k in 0..L {
                    let eta = eta[band[k]];
                    if eta != 0.0 {
                        // Snell's law in vector form, as `refract`.
                        let mut cos_i = -(dx[k] * nx[k] + dy[k] * ny[k] + dz[k] * nz[k]);
                        let (mut mx, mut my, mut mz) = (nx[k], ny[k], nz[k]);
                        if cos_i < 0.0 {
                            (mx, my, mz) = (-mx, -my, -mz);
                            cos_i = -cos_i;
                        }
                        let kk = 1.0 - eta * eta * (1.0 - cos_i * cos_i);
                        dead[k] |= kk < 0.0;
                        let f = eta * cos_i - kk.sqrt();
                        dx[k] = dx[k] * eta + mx * f;
                        dy[k] = dy[k] * eta + my * f;
                        dz[k] = dz[k] * eta + mz * f;
                    }
                }
            }
            if i == self.stop && self.plate != 0.0 {
                // The aspheric plate of the spherical-aberration override, as `trace_with`.
                for k in 0..L {
                    let r2 = qx[k] * qx[k] + qy[k] * qy[k];
                    let v = Vec3::new(
                        dx[k] - self.plate * r2 * qx[k],
                        dy[k] - self.plate * r2 * qy[k],
                        dz[k],
                    )
                    .normalize();
                    (dx[k], dy[k], dz[k]) = (v.x, v.y, v.z);
                }
            }
        }
        let mut out = [(Traced::Blocked, true); L];
        for k in 0..L {
            if !dead[k] {
                out[k] = (
                    Traced::Out {
                        origin: Vec3::new(px[k], py[k], pz[k]),
                        dir: Vec3::new(dx[k], dy[k], dz[k]),
                    },
                    stopped[k],
                );
            }
        }
        out
    }
}
