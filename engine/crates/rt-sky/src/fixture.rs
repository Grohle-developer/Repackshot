//! `tests/fixtures/sky-physical.json`: the engine's tabulated physical sky (`rt_core::environment::
//! sky_image`, in `f32`) at a few hundred pixels of six skies, for the preview's port to be checked
//! against (`tests/sky-physical.test.ts`, to 1e-6). `rt-sky fixture` writes it; a test here checks
//! that the committed file is what the engine computes now.

use crate::table::literal;
use rt_core::environment::sky_image;
use rt_core::scene::{EnvKind, Environment, SkyModel};
use rt_core::sky::{SKY_HEIGHT, SKY_WIDTH};
use std::fmt::Write as _;

/// The dome values the interface scales the sky to (`src/data/environment.ts`).
const DOME: (f32, f32, f32) = (0.12, 0.45, 0.85);

/// `(azimuth, elevation, turbidity, strength)` of the skies: knots and between them, the horizon,
/// the zenith and the ends of the turbidity range.
const SKIES: [(f32, f32, f32, f32); 6] = [
    (-40.0, 35.0, 3.0, 1.0),
    (120.0, 0.0, 1.0, 0.6),
    (10.0, 2.5, 2.5, 1.0),
    (-170.0, 12.0, 6.3, 0.6),
    (75.0, 70.0, 9.9, 2.0),
    (0.0, 90.0, 10.0, 1.0),
];

/// The fixture's text.
pub fn json() -> String {
    let (w, h) = (SKY_WIDTH as usize, SKY_HEIGHT as usize);
    let mut s = String::from(
        "{\n  \"generator\": \"rt-sky fixture (engine/crates/rt-sky/src/fixture.rs): rt_core::environment::sky_image of the physical sky\",\n",
    );
    let _ = writeln!(s, "  \"table_sha256\": \"{}\",", rt_core::sky_table::SHA256);
    let _ = writeln!(s, "  \"width\": {w},\n  \"height\": {h},\n  \"skies\": [");
    let mut skies = Vec::new();
    for (azimuth, elevation, turbidity, strength) in SKIES {
        let env = Environment {
            kind: EnvKind::Sky,
            sky_model: SkyModel::Physical,
            floor: DOME.0,
            horizon: DOME.1,
            zenith: DOME.2,
            strength,
            sky_turbidity: turbidity,
            sun_azimuth_deg: azimuth,
            sun_elevation_deg: elevation,
            ..Environment::default()
        };
        let (image, scale) = sky_image(&env);
        let mut pixels = Vec::new();
        let mut at = |x: usize, y: usize| {
            let c = image.texel(x as u32, y as u32);
            pixels.push(format!(
                "[{x}, {y}, {}, {}, {}]",
                literal(c.r),
                literal(c.g),
                literal(c.b)
            ));
        };
        for y in (0..h / 2).step_by(3) {
            for x in (0..w).step_by(16) {
                at(x, y);
            }
        }
        at(w / 2 + 3, h / 2 - 1);
        at(7, h - 1);
        skies.push(format!(
            "    {{ \"azimuth\": {}, \"elevation\": {}, \"turbidity\": {}, \"floor\": {}, \"horizon\": {}, \"zenith\": {}, \"strength\": {}, \"scale\": {},\n      \"pixels\": [{}] }}",
            literal(azimuth),
            literal(elevation),
            literal(turbidity),
            literal(DOME.0),
            literal(DOME.1),
            literal(DOME.2),
            literal(strength),
            literal(scale),
            pixels.join(", ")
        ));
    }
    s.push_str(&skies.join(",\n"));
    s.push_str("\n  ]\n}\n");
    s
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_committed_fixture_is_what_the_engine_computes() {
        let fixture = include_str!("../../../../tests/fixtures/sky-physical.json");
        assert!(
            fixture == super::json(),
            "tests/fixtures/sky-physical.json is stale: run `rt-sky fixture`"
        );
    }
}
