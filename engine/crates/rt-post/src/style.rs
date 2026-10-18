//! The styles' own grades (X6, AI-POST.md §3.2 step 4): before X6 the style was only words for
//! the model (`STYLE_PROMPTS` of `src/ai/prompt.ts`), which a small img2img model all but ignores,
//! and *Style strength* only let through the change the model happened to make to the whole
//! image. Now each style is also a real colour grade the guard applies itself, deterministic and
//! the same for any model.
//!
//! A grade is a scene log gain per channel that depends on where a pixel sits in the tones of the
//! **low band** (the display luminance low-passed like the shading transfer, over the open
//! regions only): a tint of the shadows, a tint of the highlights and a contrast between them. Being
//! a smooth gain on the engine image, it keeps the edges, the texture, the text and the depth of
//! field by construction, like the rest of the guard; the checks measure the colour of each
//! material against the engine image *with this grade applied* (it is a change the controls ask
//! for, like the style's common change before it).
//!
//! The amount is `BAND_GAIN_AT_100 × Style strength / 100 × the attempt's scale` (Intervention,
//! lowered by every retry): the table below is the grade at Style strength 50 and Intervention 100,
//! twice that at 100 and 100, and nothing at either 0. **Provisional values** (◆, ROADMAP X6).
//! `src/core/ai-style.ts` mirrors the table for the synthetic service; a test reads it here.

use crate::job::{fraction, Job, Style, BAND_GAIN_AT_100};

/// One style's grade at amount 1: scene log gain per channel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grade {
    /// Gain of the shadows (the low band's darkest tones).
    pub shadow: [f32; 3],
    /// Gain of the highlights (its brightest tones).
    pub highlight: [f32; 3],
    /// Added to every channel from −contrast in the shadows to +contrast in the highlights.
    pub contrast: f32,
}

/// The grades of [`Style::ALL`], in its order.
pub const GRADES: [Grade; 6] = [
    // NATURAL: open the shadows a little, roll the highlights off.
    Grade {
        shadow: [0.06, 0.05, 0.04],
        highlight: [-0.07, -0.07, -0.07],
        contrast: 0.0,
    },
    // CATALOGUE: open shadows, neutral whites, a lower contrast.
    Grade {
        shadow: [0.12, 0.12, 0.13],
        highlight: [0.03, 0.03, 0.04],
        contrast: -0.04,
    },
    // EDITORIAL: cool shadows, warm highlights, a refined contrast.
    Grade {
        shadow: [-0.05, -0.03, 0.01],
        highlight: [0.03, 0.02, -0.01],
        contrast: 0.08,
    },
    // WARM: warmer light, more in the highlights.
    Grade {
        shadow: [0.08, 0.02, -0.08],
        highlight: [0.12, 0.04, -0.10],
        contrast: 0.0,
    },
    // COOL: cooler light, more in the highlights.
    Grade {
        shadow: [-0.07, 0.0, 0.09],
        highlight: [-0.09, 0.0, 0.12],
        contrast: 0.0,
    },
    // CINEMATIC: teal shadows, warm highlights, a deeper contrast.
    Grade {
        shadow: [-0.08, 0.02, 0.08],
        highlight: [0.10, 0.03, -0.08],
        contrast: 0.10,
    },
];

/// The grade of a style.
pub fn grade(style: Style) -> Grade {
    GRADES[style.code() as usize]
}

/// Where the shadows end and the highlights begin, in the low band's display value (the sRGB-like
/// `luminance^(1/2.2)`): below the first it is all shadow, above the second all highlight.
pub const SHADOW_END: f32 = 0.2;
/// See [`SHADOW_END`].
pub const HIGHLIGHT_START: f32 = 0.8;

/// The share of the highlight tint at a low-band display luminance `lum` (display-linear), 0..1.
pub fn highlight_share(lum: f32) -> f32 {
    let v = rt_core::fmath::powf(lum.max(0.0), 1.0 / 2.2);
    let t = ((v - SHADOW_END) / (HIGHLIGHT_START - SHADOW_END)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The grade's scene log gain at a low-band display luminance `lum`, at amount `amount`.
pub fn gain_at(g: &Grade, lum: f32, amount: f32) -> [f32; 3] {
    let t = highlight_share(lum);
    let c = g.contrast * (2.0 * t - 1.0);
    [0, 1, 2].map(|k| amount * (g.shadow[k] * (1.0 - t) + g.highlight[k] * t + c))
}

/// The amount of the job's style grade for an attempt of `scale` (strength over `MAX_STRENGTH`).
pub fn amount(job: &Job, scale: f32) -> f32 {
    BAND_GAIN_AT_100 * fraction(job.settings.style_strength) * scale
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::Settings;

    #[test]
    fn every_style_has_its_own_grade_and_none_at_zero() {
        for (i, a) in GRADES.iter().enumerate() {
            for b in &GRADES[i + 1..] {
                assert_ne!(a, b);
            }
            assert_eq!(gain_at(a, 0.5, 0.0), [0.0; 3]);
        }
        assert_eq!(grade(Style::Warm), GRADES[3]);
        // Warm: more red than blue everywhere; cool the other way.
        for lum in [0.02f32, 0.2, 0.8] {
            let w = gain_at(&grade(Style::Warm), lum, 1.0);
            let c = gain_at(&grade(Style::Cool), lum, 1.0);
            assert!(w[0] > w[2] && c[2] > c[0], "{lum}: {w:?} {c:?}");
        }
        assert_eq!(highlight_share(0.0), 0.0);
        assert_eq!(highlight_share(1.0), 1.0);
        let mut job = Job::new(4, 4, Settings::DEFAULT);
        job.settings.style_strength = 50;
        assert_eq!(amount(&job, 1.0), 1.0);
        job.settings.style_strength = 0;
        assert_eq!(amount(&job, 1.0), 0.0);
    }
}
