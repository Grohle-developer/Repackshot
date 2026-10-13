//! The fit of the model's coefficients to the simulated skies: our own Levenberg–Marquardt.
//!
//! For every knot (one turbidity, ground albedo and colour channel) the data are the simulated
//! radiances of one channel over a grid of directions at each simulated Sun elevation. The fit
//! has three stages:
//!
//! 1. **Radiance scale.** `L_M(x)`, a Bézier curve of six control points, fitted by weighted
//!    linear least squares (relative error) to the mean radiance of each simulated sky.
//! 2. **Each elevation alone.** The nine coefficients of `F` fitted to that sky divided by
//!    `L_M`: a grid search over the four that enter non-linearly (`A`, `B`, `E`, `H`) with the
//!    other five solved linearly at every grid point (variable projection, G. H. Golub and
//!    V. Pereyra, SIAM J. Numer. Anal. 10, 1973), then Levenberg–Marquardt on all nine, started
//!    from the best grid point and from the previous elevation's solution.
//! 3. **All elevations together.** Bézier control points fitted to the stage-2 coefficients by
//!    linear least squares, then Levenberg–Marquardt over all 54 control points against every
//!    elevation's data at once, so what is minimised is the error of the model as the engine
//!    evaluates it (interpolation in elevation included).
//!
//! Residuals are relative and weighted by solid angle: `√w (model - data) / s`, where `s` is the
//! data in a first pass and the model of that pass in a second (so the noise of the simulation
//! does not bias the fit low, as dividing by noisy data would). Directions within
//! [`AUREOLE_DEG`] of the Sun weigh a quarter.
//!
//! Levenberg–Marquardt as in K. Levenberg, Q. Appl. Math. 2, 1944 and D. W. Marquardt, SIAM J.
//! Appl. Math. 11, 1963: the normal equations `(JᵀJ + λ diag(JᵀJ)) δ = -Jᵀr` solved by Cholesky,
//! `λ` divided by 3 after a step that lowers the cost and multiplied by 4 after one that does
//! not; parameters are kept inside bounds by clipping each step. Everything is sequential within a
//! knot, so the result is the same for any number of threads.

use crate::model::{
    bernstein, bezier, distribution, distribution_gradient, Knot, View, CONTROL, PARAMS,
};

/// Angular radius of the solar aureole for the weights and the error report, degrees.
pub const AUREOLE_DEG: f64 = 10.0;
/// Weight of directions inside the aureole.
const AUREOLE_WEIGHT: f64 = 0.25;

/// Lower bounds of the nine coefficients. `E` stays below -0.5 so that `D e^(E γ)` cannot turn
/// into a straight line in `γ` cancelling `C` (a degenerate pair of huge, opposite values), and
/// `|H| < 1` keeps the halo finite.
pub const LOWER: [f64; PARAMS] = [-4.0, -20.0, -25.0, -25.0, -30.0, -25.0, -25.0, -0.95, -25.0];
/// Upper bounds.
pub const UPPER: [f64; PARAMS] = [4.0, -0.01, 25.0, 25.0, -0.5, 25.0, 25.0, 0.95, 25.0];
/// The coefficients that enter non-linearly: `A`, `B`, `E`, `H`.
const NONLINEAR: [usize; 4] = [0, 1, 4, 7];
/// The ones that enter linearly: `C`, `D`, `F`, `G`, `I`.
const LINEAR: [usize; 5] = [2, 3, 5, 6, 8];
/// Typical sizes of the non-linear coefficients, for the continuity prior of stage 2.
const PRIOR_SIZE: [f64; 4] = [0.3, 0.3, 2.0, 0.1];
/// Grid points stage 2 starts Levenberg–Marquardt from (besides the previous elevation's).
const SLICE_STARTS: usize = 8;
/// Weight of the continuity prior (the data's weights sum to about π).
const PRIOR_WEIGHT: f64 = 1.0e-3;

/// One simulated direction of one sky.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    /// The view.
    pub view: View,
    /// Solid-angle weight (the aureole's reduction not applied).
    pub weight: f64,
    /// Simulated radiance of the channel.
    pub value: f64,
}

/// The simulated sky of one elevation, one channel.
#[derive(Clone, Debug, PartialEq)]
pub struct Slice {
    /// Sun elevation, degrees.
    pub elevation_deg: f64,
    /// Its Bézier parameter.
    pub x: f64,
    /// The directions.
    pub samples: Vec<Sample>,
}

impl Sample {
    fn fit_weight(&self) -> f64 {
        if self.view.gamma < AUREOLE_DEG.to_radians() {
            self.weight * AUREOLE_WEIGHT
        } else {
            self.weight
        }
    }
}

/// Solves the symmetric positive definite system `a x = b` (`a` row-major, `n x n`) by
/// Cholesky; `None` if `a` is not positive definite.
pub fn cholesky_solve(a: &[f64], b: &[f64], n: usize) -> Option<Vec<f64>> {
    let mut l = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..=i {
            let mut s = a[i * n + j];
            for k in 0..j {
                s -= l[i * n + k] * l[j * n + k];
            }
            if i == j {
                if s.is_nan() || s <= 0.0 {
                    return None;
                }
                l[i * n + i] = s.sqrt();
            } else {
                l[i * n + j] = s / l[j * n + j];
            }
        }
    }
    let mut y = vec![0.0; n];
    for i in 0..n {
        let mut s = b[i];
        for k in 0..i {
            s -= l[i * n + k] * y[k];
        }
        y[i] = s / l[i * n + i];
    }
    let mut x = vec![0.0; n];
    for i in (0..n).rev() {
        let mut s = y[i];
        for k in i + 1..n {
            s -= l[k * n + i] * x[k];
        }
        x[i] = s / l[i * n + i];
    }
    Some(x)
}

/// A least-squares problem for [`levenberg_marquardt`]: `accumulate` adds the residuals' squared
/// sum, and, when asked, `JᵀJ` and `Jᵀr`, for the parameters `p`.
pub trait Problem {
    /// Number of parameters.
    fn parameters(&self) -> usize;
    /// Cost `Σ r²`; with `normal` it also adds `JᵀJ` (row-major) and `Jᵀr`.
    fn accumulate(&self, p: &[f64], normal: Option<(&mut [f64], &mut [f64])>) -> f64;
}

/// Minimises `problem` from `p` within `[lo, hi]`; returns the parameters and the cost.
pub fn levenberg_marquardt(
    problem: &impl Problem,
    mut p: Vec<f64>,
    lo: &[f64],
    hi: &[f64],
    iterations: usize,
) -> (Vec<f64>, f64) {
    let n = problem.parameters();
    for i in 0..n {
        p[i] = p[i].clamp(lo[i], hi[i]);
    }
    let mut jtj = vec![0.0; n * n];
    let mut jtr = vec![0.0; n];
    let mut cost = problem.accumulate(&p, Some((&mut jtj, &mut jtr)));
    let mut lambda = 1.0e-3;
    let mut stalls = 0;
    for _ in 0..iterations {
        let mut a = jtj.clone();
        for i in 0..n {
            a[i * n + i] += lambda * jtj[i * n + i].max(1.0e-12);
        }
        let neg: Vec<f64> = jtr.iter().map(|v| -v).collect();
        let Some(step) = cholesky_solve(&a, &neg, n) else {
            lambda *= 4.0;
            if lambda > 1.0e12 {
                break;
            }
            continue;
        };
        let trial: Vec<f64> = (0..n)
            .map(|i| (p[i] + step[i]).clamp(lo[i], hi[i]))
            .collect();
        let trial_cost = problem.accumulate(&trial, None);
        if trial_cost.is_finite() && trial_cost < cost {
            let gain = (cost - trial_cost) / cost.max(1.0e-300);
            p = trial;
            jtj.iter_mut().for_each(|v| *v = 0.0);
            jtr.iter_mut().for_each(|v| *v = 0.0);
            cost = problem.accumulate(&p, Some((&mut jtj, &mut jtr)));
            lambda = (lambda / 3.0).max(1.0e-12);
            stalls = if gain < 1.0e-10 { stalls + 1 } else { 0 };
            if stalls >= 3 {
                break;
            }
        } else {
            lambda *= 4.0;
            if lambda > 1.0e12 {
                break;
            }
        }
    }
    (p, cost)
}

/// Stage 2's problem: the nine coefficients of one slice against `target` (data / scale).
struct SliceProblem<'a> {
    samples: &'a [Sample],
    /// What each sample's model value should be.
    target: &'a [f64],
    /// What each residual is divided by.
    scale: &'a [f64],
    /// The previous elevation's coefficients: a weak pull of the non-linear ones towards them.
    prior: Option<[f64; PARAMS]>,
}

impl Problem for SliceProblem<'_> {
    fn parameters(&self) -> usize {
        PARAMS
    }

    fn accumulate(&self, p: &[f64], mut normal: Option<(&mut [f64], &mut [f64])>) -> f64 {
        let p: [f64; PARAMS] = p.try_into().unwrap_or([0.0; PARAMS]);
        let mut cost = 0.0;
        for (i, s) in self.samples.iter().enumerate() {
            let sw = s.fit_weight().sqrt() / self.scale[i];
            let (f, g) = distribution_gradient(&p, &s.view);
            let r = sw * (f - self.target[i]);
            cost += r * r;
            if let Some((jtj, jtr)) = normal.as_mut() {
                for a in 0..PARAMS {
                    let ja = sw * g[a];
                    jtr[a] += ja * r;
                    for b in 0..=a {
                        jtj[a * PARAMS + b] += ja * sw * g[b];
                    }
                }
            }
        }
        if let Some(prior) = self.prior {
            for (n, &j) in NONLINEAR.iter().enumerate() {
                let w = PRIOR_WEIGHT.sqrt() / PRIOR_SIZE[n];
                let r = w * (p[j] - prior[j]);
                cost += r * r;
                if let Some((jtj, jtr)) = normal.as_mut() {
                    jtr[j] += w * r;
                    jtj[j * PARAMS + j] += w * w;
                }
            }
        }
        if let Some((jtj, _)) = normal {
            for a in 0..PARAMS {
                for b in 0..a {
                    jtj[b * PARAMS + a] = jtj[a * PARAMS + b];
                }
            }
        }
        cost
    }
}

/// Stage 3's problem: the 54 control points against every slice.
struct KnotProblem<'a> {
    slices: &'a [Slice],
    /// `L_M` at each slice.
    radiance: &'a [f64],
    /// Divisor of each residual, per slice and sample.
    scale: &'a [Vec<f64>],
}

const JOINT: usize = PARAMS * CONTROL;

fn coefficients(p: &[f64], b: &[f64; CONTROL]) -> [f64; PARAMS] {
    let mut c = [0.0; PARAMS];
    for k in 0..CONTROL {
        for j in 0..PARAMS {
            c[j] += b[k] * p[k * PARAMS + j];
        }
    }
    c
}

impl Problem for KnotProblem<'_> {
    fn parameters(&self) -> usize {
        JOINT
    }

    fn accumulate(&self, p: &[f64], mut normal: Option<(&mut [f64], &mut [f64])>) -> f64 {
        let mut cost = 0.0;
        let mut row = [0.0; JOINT];
        for (si, slice) in self.slices.iter().enumerate() {
            let b = bernstein(slice.x);
            let c = coefficients(p, &b);
            let lm = self.radiance[si];
            for (i, s) in slice.samples.iter().enumerate() {
                let sw = s.fit_weight().sqrt() / self.scale[si][i];
                let (f, g) = distribution_gradient(&c, &s.view);
                let r = sw * (f * lm - s.value);
                cost += r * r;
                if let Some((jtj, jtr)) = normal.as_mut() {
                    for k in 0..CONTROL {
                        for j in 0..PARAMS {
                            row[k * PARAMS + j] = sw * lm * g[j] * b[k];
                        }
                    }
                    for a in 0..JOINT {
                        let ja = row[a];
                        if ja == 0.0 {
                            continue;
                        }
                        jtr[a] += ja * r;
                        let base = a * JOINT;
                        for bb in 0..=a {
                            jtj[base + bb] += ja * row[bb];
                        }
                    }
                }
            }
        }
        if let Some((jtj, _)) = normal {
            for a in 0..JOINT {
                for b in 0..a {
                    jtj[b * JOINT + a] = jtj[a * JOINT + b];
                }
            }
        }
        cost
    }
}

/// Weighted linear least squares: the `m` unknowns minimising `Σ w (row · x - y)²` (a small
/// ridge keeps it solvable).
fn linear_least_squares(rows: &[Vec<f64>], y: &[f64], w: &[f64], m: usize) -> Vec<f64> {
    let mut a = vec![0.0; m * m];
    let mut b = vec![0.0; m];
    for ((row, &yi), &wi) in rows.iter().zip(y).zip(w) {
        for i in 0..m {
            b[i] += wi * row[i] * yi;
            for j in 0..m {
                a[i * m + j] += wi * row[i] * row[j];
            }
        }
    }
    let trace: f64 = (0..m).map(|i| a[i * m + i]).sum::<f64>() / m as f64;
    for i in 0..m {
        a[i * m + i] += 1.0e-12 * trace.max(1.0e-300);
    }
    cholesky_solve(&a, &b, m).unwrap_or_else(|| vec![0.0; m])
}

/// The solid-angle mean of a slice's data.
pub fn mean_radiance(slice: &Slice) -> f64 {
    let (mut s, mut w) = (0.0, 0.0);
    for x in &slice.samples {
        s += x.weight * x.value;
        w += x.weight;
    }
    s / w
}

/// Stage 2 for one slice: the best coefficients for `target` (and their cost) from a grid of the
/// non-linear ones and from `start`.
fn fit_slice(
    samples: &[Sample],
    target: &[f64],
    scale: &[f64],
    start: Option<[f64; PARAMS]>,
) -> ([f64; PARAMS], f64) {
    let problem = SliceProblem {
        samples,
        target,
        scale,
        prior: start,
    };
    // Variable projection over a grid of (A, B, E, H); Levenberg–Marquardt from the best few.
    let mut best: Vec<([f64; PARAMS], f64)> = Vec::new();
    let w: Vec<f64> = samples
        .iter()
        .zip(scale)
        .map(|(s, sc)| s.fit_weight() / (sc * sc))
        .collect();
    for &a in &[-1.5, -1.0, -0.6, -0.2, 0.3] {
        for &b in &[-0.05, -0.2, -0.5, -1.0, -2.5] {
            for &e in &[-0.3, -1.0, -3.0, -8.0, -20.0] {
                for &h in &[0.0, 0.4, 0.65, 0.8, 0.9] {
                    let rows: Vec<Vec<f64>> = samples
                        .iter()
                        .map(|s| {
                            let v = &s.view;
                            let first =
                                1.0 + a * crate::model::exp_clamped(b / (v.cos_theta + 0.01));
                            vec![
                                first,
                                first * crate::model::exp_clamped(e * v.gamma),
                                first * v.cos_gamma * v.cos_gamma,
                                first * crate::model::chi(h, v),
                                first * v.cos_theta.sqrt(),
                            ]
                        })
                        .collect();
                    let lin = linear_least_squares(&rows, target, &w, 5);
                    let p = [a, b, lin[0], lin[1], e, lin[2], lin[3], h, lin[4]];
                    if !(0..PARAMS).all(|j| p[j] >= LOWER[j] && p[j] <= UPPER[j]) {
                        continue;
                    }
                    let cost = problem.accumulate(&p, None);
                    best.push((p, cost));
                }
            }
        }
    }
    best.sort_by(|a, b| a.1.total_cmp(&b.1));
    let mut candidates: Vec<[f64; PARAMS]> = best.iter().take(SLICE_STARTS).map(|b| b.0).collect();
    candidates.extend(start);
    let mut out: Option<([f64; PARAMS], f64)> = None;
    for c in candidates {
        let (p, cost) = levenberg_marquardt(&problem, c.to_vec(), &LOWER, &UPPER, 300);
        if out.as_ref().is_none_or(|o| cost < o.1) {
            out = Some((p.try_into().unwrap_or([0.0; PARAMS]), cost));
        }
    }
    out.unwrap_or(([0.0; PARAMS], f64::INFINITY))
}

/// The fit of one knot to its slices (one per simulated elevation, in increasing order).
pub fn fit_knot(slices: &[Slice]) -> Knot {
    fit_knot_traced(slices, &mut |_| {})
}

/// [`fit_knot`], telling `trace` the error after each stage.
pub fn fit_knot_traced(slices: &[Slice], trace: &mut dyn FnMut(String)) -> Knot {
    // Stage 1: the radiance scale.
    let means: Vec<f64> = slices.iter().map(mean_radiance).collect();
    let rows: Vec<Vec<f64>> = slices.iter().map(|s| bernstein(s.x).to_vec()).collect();
    let w: Vec<f64> = means.iter().map(|m| 1.0 / (m * m)).collect();
    let radiance: [f64; CONTROL] = linear_least_squares(&rows, &means, &w, CONTROL)
        .try_into()
        .unwrap_or([0.0; CONTROL]);
    let lm: Vec<f64> = slices.iter().map(|s| bezier(&radiance, s.x)).collect();

    // Stage 2: each slice alone, from the previous one's solution (continuation, with a weak pull
    // towards it) and from the grid; then once more dividing by its own model, not the data.
    let mut per_slice: Vec<[f64; PARAMS]> = Vec::new();
    let mut scale: Vec<Vec<f64>> = Vec::new();
    let mut previous = None;
    for (si, slice) in slices.iter().enumerate() {
        let target: Vec<f64> = slice.samples.iter().map(|s| s.value / lm[si]).collect();
        let (p, _) = fit_slice(&slice.samples, &target, &target, previous);
        let model: Vec<f64> = slice
            .samples
            .iter()
            .zip(&target)
            .map(|(s, t)| distribution(&p, &s.view).max(0.2 * t).max(1.0e-30))
            .collect();
        let (p, _) = fit_slice(&slice.samples, &target, &model, Some(p));
        let flat = Knot {
            coefficients: [p; CONTROL],
            radiance,
        };
        trace(format!(
            "stage 2, elevation {:7.3}: rms {:5.2} % {:?}",
            slice.elevation_deg,
            100.0 * slice_errors(&flat, slice).0,
            p.map(|v| (v * 1000.0).round() / 1000.0)
        ));
        // Residuals of the joint fit are divided by this slice's model (scaled back by L_M).
        scale.push(
            slice
                .samples
                .iter()
                .zip(&target)
                .map(|(s, t)| (distribution(&p, &s.view).max(0.2 * t) * lm[si]).max(1.0e-30))
                .collect(),
        );
        per_slice.push(p);
        previous = Some(p);
    }

    // Stage 3a: Bézier curves through the non-linear coefficients, then the linear ones solved
    // exactly for those curves (the model is linear in their 30 control points).
    let mut control = [[0.0; PARAMS]; CONTROL];
    let ones = vec![1.0; slices.len()];
    for &j in &NONLINEAR {
        let y: Vec<f64> = per_slice.iter().map(|p| p[j]).collect();
        let cp = linear_least_squares(&rows, &y, &ones, CONTROL);
        for k in 0..CONTROL {
            control[k][j] = cp[k].clamp(LOWER[j], UPPER[j]);
        }
    }
    let lin = linear_control_points(slices, &lm, &scale, &control);
    for k in 0..CONTROL {
        for (n, &j) in LINEAR.iter().enumerate() {
            control[k][j] = lin[k * LINEAR.len() + n].clamp(LOWER[j], UPPER[j]);
        }
    }
    let report = |control: &[[f64; PARAMS]; CONTROL]| {
        let knot = Knot {
            coefficients: *control,
            radiance,
        };
        let e: Vec<f64> = slices.iter().map(|s| slice_errors(&knot, s).0).collect();
        e.iter().sum::<f64>() / e.len() as f64
    };
    trace(format!(
        "stage 3a: mean rms {:5.2} %",
        100.0 * report(&control)
    ));

    // Stage 3b: all 54 control points against every slice.
    let problem = KnotProblem {
        slices,
        radiance: &lm,
        scale: &scale,
    };
    let p0: Vec<f64> = control.iter().flatten().cloned().collect();
    let lo: Vec<f64> = (0..JOINT).map(|i| LOWER[i % PARAMS]).collect();
    let hi: Vec<f64> = (0..JOINT).map(|i| UPPER[i % PARAMS]).collect();
    let (p, _) = levenberg_marquardt(&problem, p0, &lo, &hi, 400);
    for k in 0..CONTROL {
        for j in 0..PARAMS {
            control[k][j] = p[k * PARAMS + j];
        }
    }
    trace(format!(
        "stage 3b: mean rms {:5.2} %",
        100.0 * report(&control)
    ));
    Knot {
        coefficients: control,
        radiance,
    }
}

/// Stage 3a: the 30 control points of `C`, `D`, `F`, `G`, `I` (`[control][C D F G I]`) that
/// minimise the joint residuals for the non-linear curves in `control`.
fn linear_control_points(
    slices: &[Slice],
    lm: &[f64],
    scale: &[Vec<f64>],
    control: &[[f64; PARAMS]; CONTROL],
) -> Vec<f64> {
    let n = CONTROL * LINEAR.len();
    let mut a = vec![0.0; n * n];
    let mut b = vec![0.0; n];
    let mut row = vec![0.0; n];
    for (si, slice) in slices.iter().enumerate() {
        let bern = bernstein(slice.x);
        let mut c = [0.0; PARAMS];
        for k in 0..CONTROL {
            for &j in &NONLINEAR {
                c[j] += bern[k] * control[k][j];
            }
        }
        for (i, s) in slice.samples.iter().enumerate() {
            let v = &s.view;
            let sw = s.fit_weight().sqrt() / scale[si][i];
            let first = 1.0 + c[0] * crate::model::exp_clamped(c[1] / (v.cos_theta + 0.01));
            let basis = [
                1.0,
                crate::model::exp_clamped(c[4] * v.gamma),
                v.cos_gamma * v.cos_gamma,
                crate::model::chi(c[7], v),
                v.cos_theta.sqrt(),
            ];
            for k in 0..CONTROL {
                for m in 0..LINEAR.len() {
                    row[k * LINEAR.len() + m] = sw * lm[si] * first * bern[k] * basis[m];
                }
            }
            let y = sw * s.value;
            for p in 0..n {
                b[p] += row[p] * y;
                for q in 0..=p {
                    a[p * n + q] += row[p] * row[q];
                }
            }
        }
    }
    for p in 0..n {
        for q in 0..p {
            a[q * n + p] = a[p * n + q];
        }
    }
    let trace: f64 = (0..n).map(|i| a[i * n + i]).sum::<f64>() / n as f64;
    for i in 0..n {
        a[i * n + i] += 1.0e-9 * trace;
    }
    cholesky_solve(&a, &b, n).unwrap_or_else(|| vec![0.0; n])
}

/// Relative errors of `knot` on `slice`: solid-angle weighted RMS outside the aureole and
/// inside it, and the largest outside.
pub fn slice_errors(knot: &Knot, slice: &Slice) -> (f64, f64, f64) {
    let (mut out, mut wout, mut inn, mut win, mut max) = (0.0, 0.0, 0.0, 0.0, 0.0f64);
    for s in &slice.samples {
        let m = knot.radiance_at(slice.x, &s.view);
        let e = (m - s.value) / s.value;
        if s.view.gamma < AUREOLE_DEG.to_radians() {
            inn += s.weight * e * e;
            win += s.weight;
        } else {
            out += s.weight * e * e;
            wout += s.weight;
            max = max.max(e.abs());
        }
    }
    (
        (out / wout.max(1.0e-300)).sqrt(),
        if win > 0.0 { (inn / win).sqrt() } else { 0.0 },
        max,
    )
}

/// The model's value for a slice's samples (for reports).
pub fn modelled(knot: &Knot, slice: &Slice) -> Vec<f64> {
    slice
        .samples
        .iter()
        .map(|s| {
            distribution(&knot.coefficients_at(slice.x), &s.view) * bezier(&knot.radiance, slice.x)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::elevation_parameter;
    use crate::simulate::{sun_direction, view_direction};

    /// Synthetic slices from a known knot (no noise): the fit must reproduce it closely.
    fn synthetic(knot: &Knot) -> Vec<Slice> {
        [0.0, 2.0, 8.0, 20.0, 40.0, 65.0, 90.0]
            .iter()
            .map(|&el| {
                let s = sun_direction(el);
                let x = elevation_parameter(el);
                let mut samples = Vec::new();
                for i in 0..12 {
                    for j in 0..10 {
                        let theta = (i as f64 + 0.5) / 12.0 * std::f64::consts::FRAC_PI_2;
                        let phi = j as f64 / 9.0 * std::f64::consts::PI;
                        let v = view_direction(theta, phi);
                        let view = View::new(v, s);
                        samples.push(Sample {
                            view,
                            weight: theta.sin(),
                            value: knot.radiance_at(x, &view),
                        });
                    }
                }
                Slice {
                    elevation_deg: el,
                    x,
                    samples,
                }
            })
            .collect()
    }

    #[test]
    fn the_fit_recovers_a_known_sky_and_is_deterministic() {
        let mut coefficients = [[0.0; PARAMS]; CONTROL];
        for (k, row) in coefficients.iter_mut().enumerate() {
            let t = k as f64 / 5.0;
            *row = [
                -1.0 + 0.2 * t,
                -0.3 - 0.2 * t,
                1.0,
                1.5 - t,
                -4.0 + t,
                0.2,
                0.1 + 0.1 * t,
                0.6 + 0.1 * t,
                0.3,
            ];
        }
        let truth = Knot {
            coefficients,
            radiance: [0.02, 0.1, 0.3, 0.6, 0.9, 1.0],
        };
        let slices = synthetic(&truth);
        let fitted = fit_knot(&slices);
        for s in &slices {
            let (out, inn, _) = slice_errors(&fitted, s);
            assert!(out < 0.01 && inn < 0.05, "{}: {out} {inn}", s.elevation_deg);
        }
        assert_eq!(fitted, fit_knot(&slices));
    }

    #[test]
    fn cholesky_solves() {
        let a = [4.0, 1.0, 1.0, 3.0];
        let x = cholesky_solve(&a, &[1.0, 2.0], 2).unwrap();
        assert!(
            (4.0 * x[0] + x[1] - 1.0).abs() < 1.0e-12 && (x[0] + 3.0 * x[1] - 2.0).abs() < 1.0e-12
        );
        assert!(cholesky_solve(&[1.0, 2.0, 2.0, 1.0], &[1.0, 1.0], 2).is_none());
    }
}
