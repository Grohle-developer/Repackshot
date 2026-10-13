//! The synthetic scene and the synthetic "models" of the tests: a model that does forbidden things
//! (moves edges, changes a material's colour, blurs what is in focus, sharpens what is out of
//! focus, touches the background, returns another size).
//!
//! Integer arithmetic only, with every float an integer over 4096 (exact in `f32`), so
//! `tests/ai-fixture.ts` builds the very same bits for the WebAssembly parity test. Keep the two
//! files in step.

use crate::{Job, LinearImage, MaterialInfo, Passes, Rgb8Image, Settings, TileRequest, Tonemap};

/// Width of the scene: two tiles across.
pub const W: u32 = 1160;
/// Height: one row of tiles, padded from 340 to 352.
pub const H: u32 = 340;

/// A 32-bit integer hash (the same steps in `tests/ai-fixture.ts`).
pub fn hash(x: u32, y: u32, c: u32) -> u32 {
    let mut h =
        x.wrapping_mul(0x9E37_79B1) ^ y.wrapping_mul(0x85EB_CA77) ^ c.wrapping_mul(0xC2B2_AE3D);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^= h >> 15;
    h
}

/// The engine image and its passes.
pub struct Scene {
    pub image: LinearImage,
    pub part: Vec<u32>,
    pub material: Vec<u32>,
    pub normal: Vec<f32>,
    pub depth: Vec<f32>,
    pub coc: Vec<f32>,
}

impl Scene {
    pub fn passes(&self) -> Passes<'_> {
        Passes {
            width: W,
            height: H,
            part_id: &self.part,
            material_id: &self.material,
            normal: Some(&self.normal),
            depth: Some(&self.depth),
            coc: Some(&self.coc),
        }
    }
}

pub const BODY: u32 = 1;
pub const CAP: u32 = 2;
pub const LABEL: u32 = 3;
pub const LED: u32 = 4;

pub fn in_body(x: u32, y: u32) -> bool {
    (100..560).contains(&x) && (60..280).contains(&y)
}

pub fn in_cap(x: u32, y: u32) -> bool {
    let (dx, dy) = (x as i32 - 860, y as i32 - 170);
    dx * dx + dy * dy <= 120 * 120
}

/// A body (part 1: material Body with a normal crease at x = 330, a Label with dark text stripes,
/// a locked LED) in focus, and a cap (part 2) out of focus, over a grey gradient background.
pub fn scene() -> Scene {
    let n = (W * H) as usize;
    let mut s = Scene {
        image: LinearImage::new(W, H),
        part: vec![0; n],
        material: vec![0; n],
        normal: vec![0.0; n * 3],
        depth: vec![f32::INFINITY; n],
        coc: vec![0.0; n],
    };
    for y in 0..H {
        for x in 0..W {
            let p = (y * W + x) as usize;
            let mut value = [0i32; 3];
            if in_body(x, y) {
                let mut m = BODY;
                if (380..520).contains(&x) && (120..220).contains(&y) {
                    m = LABEL;
                }
                if (110..130).contains(&x) && (70..90).contains(&y) {
                    m = LED;
                }
                s.part[p] = 1;
                s.material[p] = m;
                let normal: [f32; 3] = if x < 330 {
                    [0.0, 0.0, 1.0]
                } else {
                    [1.0, 0.0, 0.0]
                };
                s.normal[p * 3..p * 3 + 3].copy_from_slice(&normal);
                s.depth[p] = (1000 + x) as f32;
                let base: [i32; 3] = match m {
                    BODY => [2600, 1300, 800],
                    LABEL if (x / 3) % 2 == 0 && (150..190).contains(&y) => [400, 400, 400],
                    LABEL => [3600, 3600, 3400],
                    _ => [4000, 1000, 1000],
                };
                let shade = 3072 + ((x as i32 - 100) * 1024) / 460 - ((y as i32 - 60) * 512) / 220;
                for (c, v) in value.iter_mut().enumerate() {
                    let noise = (hash(x, y, c as u32) & 31) as i32 - 16;
                    *v = ((base[c] * shade) >> 12) + noise;
                }
            } else if in_cap(x, y) {
                s.part[p] = 2;
                s.material[p] = CAP;
                s.normal[p * 3..p * 3 + 3].copy_from_slice(&[0.0, -1.0, 0.0]);
                s.depth[p] = 700.0;
                s.coc[p] = 6.0;
                let (dx, dy) = (x as i32 - 860, y as i32 - 170);
                let shade = 4096 - (dx * dx + dy * dy) * 1024 / 14_400;
                let base = [700, 1400, 2800];
                for (c, v) in value.iter_mut().enumerate() {
                    let noise = (hash(x, y, c as u32) & 7) as i32 - 4;
                    *v = ((base[c] * shade) >> 12) + noise;
                }
            } else {
                for (c, v) in value.iter_mut().enumerate() {
                    let noise = (hash(x, y, c as u32) & 31) as i32 - 16;
                    *v = 1200 + 4 * y as i32 + noise;
                }
            }
            for (c, v) in value.iter().enumerate() {
                s.image.rgba[p * 4 + c] = *v as f32 / 4096.0;
            }
            s.image.rgba[p * 4 + 3] = 1.0;
        }
    }
    s
}

/// The job of the scene: its four materials, ACES, the given controls.
pub fn job(settings: Settings) -> Job {
    let mut job = Job::new(W, H, settings);
    job.tonemap = Tonemap::Aces;
    job.materials = vec![
        MaterialInfo {
            id: BODY,
            name: "Body".into(),
            allows_wear: true,
            locked: false,
        },
        MaterialInfo {
            id: CAP,
            name: "Cap".into(),
            allows_wear: false,
            locked: false,
        },
        MaterialInfo {
            id: LABEL,
            name: "Label".into(),
            allows_wear: false,
            locked: false,
        },
        MaterialInfo {
            id: LED,
            name: "LED".into(),
            allows_wear: false,
            locked: true,
        },
    ];
    job.model_key = "ZIMAGE_Q4".into();
    job.runtime = "synthetic".into();
    job
}

/// Every control at 100.
pub const FULL: Settings = Settings {
    intervention: 100,
    light: 100,
    bounce: 100,
    wear: 100,
    style_strength: 100,
    seed: 7,
};

/// A tile image being edited: pixels addressed by tile coordinates, clamped to the tile.
pub struct Edit {
    pub x0: u32,
    pub y0: u32,
    pub w: u32,
    pub h: u32,
    pub rgb: Vec<i32>,
}

impl Edit {
    pub fn of(req: &TileRequest) -> Edit {
        Edit {
            x0: req.tile.x,
            y0: req.tile.y,
            w: req.input.width,
            h: req.input.height,
            rgb: req.input.rgb.iter().map(|&b| i32::from(b)).collect(),
        }
    }

    pub fn get(&self, i: i32, j: i32, c: usize) -> i32 {
        let i = i.clamp(0, self.w as i32 - 1) as u32;
        let j = j.clamp(0, self.h as i32 - 1) as u32;
        self.rgb[((j * self.w + i) * 3) as usize + c]
    }

    /// Applies `f(x, y, c, &self) -> value` to every pixel (global coordinates) at once.
    pub fn map(&mut self, f: impl Fn(&Edit, u32, u32, i32, i32, usize) -> i32) {
        let mut out = vec![0i32; self.rgb.len()];
        for j in 0..self.h {
            for i in 0..self.w {
                for c in 0..3 {
                    let v = f(self, self.x0 + i, self.y0 + j, i as i32, j as i32, c);
                    out[((j * self.w + i) * 3) as usize + c] = v;
                }
            }
        }
        self.rgb = out;
    }

    pub fn done(self) -> Rgb8Image {
        Rgb8Image {
            width: self.w,
            height: self.h,
            rgb: self.rgb.iter().map(|&v| v.clamp(0, 255) as u8).collect(),
        }
    }
}

/// Moves everything `d` pixels to the right.
pub fn shift(e: &mut Edit, d: i32) {
    e.map(|e, _, _, i, j, c| e.get(i - d, j, c));
}

/// A 3 x 3 box blur where `inside(x, y)`.
pub fn blur(e: &mut Edit, inside: fn(u32, u32) -> bool) {
    e.map(|e, x, y, i, j, c| {
        if !inside(x, y) {
            return e.get(i, j, c);
        }
        let mut s = 0;
        for dj in -1..=1 {
            for di in -1..=1 {
                s += e.get(i + di, j + dj, c);
            }
        }
        (s + 4) / 9
    });
}

/// An unsharp mask (twice the difference from the 3 x 3 mean) where `inside(x, y)`.
pub fn sharpen(e: &mut Edit, inside: fn(u32, u32) -> bool) {
    e.map(|e, x, y, i, j, c| {
        let v = e.get(i, j, c);
        if !inside(x, y) {
            return v;
        }
        let mut s = 0;
        for dj in -1..=1 {
            for di in -1..=1 {
                s += e.get(i + di, j + dj, c);
            }
        }
        v + 2 * (9 * v - s) / 9
    });
}

/// A left-to-right brightening of up to `amount` codes.
pub fn ramp(e: &mut Edit, amount: i32) {
    e.map(|e, x, _, i, j, c| e.get(i, j, c) + x as i32 * amount / W as i32);
}

/// `amount` codes added where `y >= from` (the bottom band is background).
pub fn band(e: &mut Edit, from: u32, amount: i32) {
    e.map(|e, _, y, i, j, c| e.get(i, j, c) + if y >= from { amount } else { 0 });
}

/// Red up by a quarter and blue down by a quarter where `inside(x, y)`.
pub fn tint(e: &mut Edit, inside: fn(u32, u32) -> bool) {
    e.map(|e, x, y, i, j, c| {
        let v = e.get(i, j, c);
        if !inside(x, y) {
            v
        } else if c == 0 {
            v * 5 / 4
        } else if c == 2 {
            v * 3 / 4
        } else {
            v
        }
    });
}

/// A mid-frequency pattern (period 16 pixels, ±`amount` codes) where `inside(x, y)`: "wear".
pub fn pattern(e: &mut Edit, amount: i32, inside: fn(u32, u32) -> bool) {
    e.map(|e, x, y, i, j, c| {
        let v = e.get(i, j, c);
        if !inside(x, y) {
            return v;
        }
        let phase = ((x / 8) + (y / 8)) % 2;
        v + if phase == 0 { amount } else { -amount }
    });
}

/// Everywhere.
pub fn everywhere(_: u32, _: u32) -> bool {
    true
}

/// The area of the cap (the disk's bounding columns).
pub fn cap_area(x: u32, _: u32) -> bool {
    (740..980).contains(&x)
}

/// The area of the body.
pub fn body_area(x: u32, y: u32) -> bool {
    in_body(x, y)
}

/// The model that does every forbidden thing at once.
pub fn forbidden(req: &TileRequest) -> Rgb8Image {
    let mut e = Edit::of(req);
    blur(&mut e, body_area);
    sharpen(&mut e, cap_area);
    shift(&mut e, 3);
    ramp(&mut e, 24);
    band(&mut e, 300, 40);
    tint(&mut e, cap_area);
    e.done()
}

/// The model that returns its input.
pub fn identity(req: &TileRequest) -> Rgb8Image {
    req.input.clone()
}

/// FNV-1a over the little-endian bytes of floats.
pub fn fnv_f32(values: &[f32]) -> u32 {
    let mut h = 0x811c_9dc5u32;
    for v in values {
        for b in v.to_le_bytes() {
            h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
        }
    }
    h
}

/// FNV-1a over bytes, continuing from `h`.
pub fn fnv_bytes(mut h: u32, bytes: &[u8]) -> u32 {
    for &b in bytes {
        h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    h
}
