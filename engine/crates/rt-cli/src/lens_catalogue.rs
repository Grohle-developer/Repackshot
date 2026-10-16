//! The lens catalogue of the interface (`src/data/lenses.json`, phase A6) as the engine's traced
//! lenses (O2), for the sheets and the thumbnails `rt` renders: the same composition as
//! `src/core/traced-lens.ts` `composeLens` and `src/io/rsb.ts` `prescriptionToRsb` (an anamorphic
//! adapter in front of the double Gauss, scaled to clear its front), so that the page and `rt`
//! send the engine the same bytes: `rt --write-lens-catalogue` writes them for every lens and the
//! page's test compares its own (`tests/fixtures/lens-catalogue.json`).

use rt_core::optics::traced::*;

/// The catalogue file, built in.
pub const CATALOGUE: &str = include_str!("../../../../src/data/lenses.json");
/// The lens an adapter goes in front of (`traced-lens.ts` `DEFAULT_MASTER`).
pub const DEFAULT_MASTER: &str = "double_gauss_normal";
/// Air between an adapter and its lens, in the adapter's scaled units (`ADAPTER_GAP_MM`).
pub const ADAPTER_GAP_MM: f64 = 5.0;
/// An adapter's strongest radius over its lens's front semi-aperture (`ADAPTER_CLEARANCE`).
pub const ADAPTER_CLEARANCE: f64 = 2.2;
/// An adapter's widest gap travels to this share of its afocal value to focus close
/// (`ADAPTER_FOCUS_TRAVEL`).
pub const ADAPTER_FOCUS_TRAVEL: f64 = 0.6;

/// A JSON value (the catalogue's subset: no escapes beyond `\x` for a character).
#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    /// `null` (and anything missing).
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// A number.
    Num(f64),
    /// A string.
    Str(String),
    /// An array.
    Arr(Vec<Json>),
    /// An object, its members in order.
    Obj(Vec<(String, Json)>),
}

impl Json {
    /// Member `key` of an object (`Null` when missing or not an object).
    pub fn get(&self, key: &str) -> &Json {
        match self {
            Json::Obj(v) => v
                .iter()
                .find(|(k, _)| k == key)
                .map_or(&Json::Null, |(_, x)| x),
            _ => &Json::Null,
        }
    }
    /// The number, if it is one.
    pub fn num(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }
    /// The string, if it is one.
    pub fn str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }
    /// The items of an array (none for anything else).
    pub fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(v) => v,
            _ => &[],
        }
    }
}

/// Parses the catalogue's JSON (panics on what it does not expect: the file is built in).
pub fn parse_json(text: &str) -> Json {
    fn ws(b: &[u8], i: &mut usize) {
        while *i < b.len() && (b[*i] as char).is_ascii_whitespace() {
            *i += 1;
        }
    }
    fn value(b: &[u8], i: &mut usize) -> Json {
        ws(b, i);
        match b[*i] {
            b'{' => {
                *i += 1;
                let mut v = Vec::new();
                loop {
                    ws(b, i);
                    if b[*i] == b'}' {
                        *i += 1;
                        break;
                    }
                    let Json::Str(k) = value(b, i) else {
                        panic!("a JSON key is a string")
                    };
                    ws(b, i);
                    *i += 1; // ':'
                    let x = value(b, i);
                    v.push((k, x));
                    ws(b, i);
                    if b[*i] == b',' {
                        *i += 1;
                    }
                }
                Json::Obj(v)
            }
            b'[' => {
                *i += 1;
                let mut v = Vec::new();
                loop {
                    ws(b, i);
                    if b[*i] == b']' {
                        *i += 1;
                        break;
                    }
                    v.push(value(b, i));
                    ws(b, i);
                    if b[*i] == b',' {
                        *i += 1;
                    }
                }
                Json::Arr(v)
            }
            b'"' => {
                *i += 1;
                let mut s = Vec::new();
                while b[*i] != b'"' {
                    if b[*i] == b'\\' {
                        *i += 1;
                    }
                    s.push(b[*i]);
                    *i += 1;
                }
                *i += 1;
                Json::Str(String::from_utf8_lossy(&s).into_owned())
            }
            b'n' => {
                *i += 4;
                Json::Null
            }
            b't' => {
                *i += 4;
                Json::Bool(true)
            }
            b'f' => {
                *i += 5;
                Json::Bool(false)
            }
            _ => {
                let start = *i;
                while *i < b.len() && b"+-0123456789.eE".contains(&b[*i]) {
                    *i += 1;
                }
                Json::Num(
                    std::str::from_utf8(&b[start..*i])
                        .ok()
                        .and_then(|t| t.parse().ok())
                        .expect("a JSON number"),
                )
            }
        }
    }
    let mut i = 0;
    value(text.as_bytes(), &mut i)
}

/// One lens of the catalogue, composed for the engine.
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogueLens {
    /// The catalogue key.
    pub key: String,
    /// Its names (Spanish, English).
    pub name: (String, String),
    /// Its character (`clinical`, `soft`, ...).
    pub character: String,
    /// The prescription the engine traces.
    pub prescription: Prescription,
    /// The image's squeeze on the sensor (an anamorphic adapter's), to desqueeze.
    pub squeeze: f32,
    /// The central obstruction of the aperture (a mirror lens's).
    pub obstruction: f32,
}

/// A surface of the catalogue, in `f64` as the page computes it.
struct Surf {
    kind: u32,
    r: Option<f64>,
    d: Option<f64>,
    nd: f64,
    vd: f64,
    semi: Option<f64>,
    coating: u32,
    stop: bool,
}

fn surfaces_of(l: &Json) -> Vec<Surf> {
    l.get("surfaces")
        .arr()
        .iter()
        .map(|s| {
            let kind = match s.get("kind").str() {
                Some("plane") => SURFACE_PLANE,
                Some("asphere") => SURFACE_ASPHERE,
                Some("cylinder") => {
                    if s.get("axis").str() == Some("x") {
                        SURFACE_CYLINDER_X
                    } else {
                        SURFACE_CYLINDER_Y
                    }
                }
                Some("mirror") => SURFACE_MIRROR,
                _ => SURFACE_SPHERE,
            };
            let glass = s.get("glass");
            Surf {
                kind,
                r: s.get("r").num(),
                d: s.get("d").num(),
                nd: glass.get("nd").num().unwrap_or(1.0),
                vd: glass.get("vd").num().unwrap_or(0.0),
                semi: s.get("semiAperture").num(),
                coating: match s.get("coating").str() {
                    Some("none") => COATING_UNCOATED,
                    Some("single") => COATING_SINGLE,
                    Some("multi") => COATING_MULTI,
                    _ => COATING_NONE,
                },
                stop: s.get("role").str() == Some("stop"),
            }
        })
        .collect()
}

fn magnification(state: Option<&str>) -> f32 {
    state
        .and_then(|s| s.strip_prefix("magnification"))
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map_or(0.0, |m| m as f32)
}

/// A lens that forms an image, composed: its surfaces, stop, focus and fastest stop.
fn compose_master(l: &Json) -> (Vec<Surf>, Prescription) {
    let surfaces = surfaces_of(l);
    let stop = surfaces.iter().position(|s| s.stop).unwrap_or(0) as u32;
    let focus = l.get("focus");
    let mode = focus.get("mode").str();
    let f_number = l
        .get("fNumber")
        .num()
        .or_else(|| l.get("iris").get("fNumberMin").num())
        .unwrap_or(0.0);
    let prescription = Prescription {
        stop,
        focus_mode: match mode {
            Some("internal") => FOCUS_INTERNAL,
            Some("floating") => FOCUS_FLOATING,
            _ => FOCUS_UNIT,
        },
        f_number_min: f_number as f32,
        magnification: if mode == Some("floating") {
            (
                magnification(focus.get("base").str()),
                magnification(focus.get("near").str()),
            )
        } else {
            (0.0, 0.0)
        },
        distortion: 0.0,
        vignetting: 0.0,
        spherical: 0.0,
        breathing: 0.0,
        moving: focus
            .get("moving")
            .arr()
            .iter()
            .map(|m| MovingGap {
                surface: m.get("surface").num().unwrap_or(0.0) as u32,
                base: m.get("dBase").num().unwrap_or(0.0) as f32,
                near: m.get("dNear").num().unwrap_or(0.0) as f32,
            })
            .collect(),
        surfaces: Vec::new(),
    };
    (surfaces, prescription)
}

fn specs(surfaces: &[Surf]) -> Vec<SurfaceSpec> {
    surfaces
        .iter()
        .map(|s| SurfaceSpec {
            kind: s.kind,
            radius: s.r.unwrap_or(0.0) as f32,
            thickness: s.d.unwrap_or(0.0) as f32,
            nd: s.nd as f32,
            vd: s.vd as f32,
            semi_aperture: s.semi.unwrap_or(0.0) as f32,
            coating: s.coating,
            conic: 0.0,
            aspheric: [0.0; 4],
        })
        .collect()
}

/// Every lens of the catalogue, in its order, composed as the page composes it.
pub fn catalogue() -> Vec<CatalogueLens> {
    let root = parse_json(CATALOGUE);
    let lenses = root.get("lenses").arr();
    let by_key = |key: &str| lenses.iter().find(|l| l.get("key").str() == Some(key));
    lenses
        .iter()
        .map(|l| {
            let key = l.get("key").str().unwrap_or("").to_string();
            let name = (
                l.get("name").get("es").str().unwrap_or("").to_string(),
                l.get("name").get("en").str().unwrap_or("").to_string(),
            );
            let character = l.get("character").str().unwrap_or("").to_string();
            let adapter = l.get("focus").get("mode").str() == Some("none");
            let (prescription, squeeze, obstruction) = if adapter {
                let master = by_key(DEFAULT_MASTER).expect("the double Gauss is in the catalogue");
                let (master_surfaces, mut p) = compose_master(master);
                let own: Vec<Surf> = surfaces_of(l).into_iter().filter(|s| !s.stop).collect();
                let strongest = own
                    .iter()
                    .filter_map(|s| s.r.map(f64::abs))
                    .fold(f64::INFINITY, f64::min);
                let front = master_surfaces[0].semi.unwrap_or(0.0);
                let k = if front > 0.0 && strongest.is_finite() {
                    (ADAPTER_CLEARANCE * front) / strongest
                } else {
                    1.0
                };
                let n = own.len();
                let scaled: Vec<Surf> = own
                    .into_iter()
                    .enumerate()
                    .map(|(i, s)| Surf {
                        r: s.r.map(|r| r * k),
                        d: if i == n - 1 {
                            Some(ADAPTER_GAP_MM * k)
                        } else {
                            s.d.map(|d| d * k)
                        },
                        semi: s.semi.map(|a| a * k),
                        ..s
                    })
                    .collect();
                p.stop += n as u32;
                for m in &mut p.moving {
                    m.surface += n as u32;
                }
                // The adapter's widest air gap focuses it, when its lens moves as one unit.
                let mut gap: Option<usize> = None;
                for (i, s) in scaled.iter().enumerate() {
                    if i + 1 < n && s.nd == 1.0 && s.d.is_some() {
                        let wider = match gap {
                            Some(g) => s.d > scaled[g].d,
                            None => true,
                        };
                        if wider {
                            gap = Some(i);
                        }
                    }
                }
                if let (FOCUS_UNIT, Some(g)) = (p.focus_mode, gap) {
                    let d = scaled[g].d.unwrap_or(0.0);
                    p.focus_mode = FOCUS_ANAMORPHIC;
                    p.moving = vec![MovingGap {
                        surface: g as u32,
                        base: d as f32,
                        near: (d * ADAPTER_FOCUS_TRAVEL) as f32,
                    }];
                }
                let mut all = specs(&scaled);
                all.extend(specs(&master_surfaces));
                p.surfaces = all;
                let pupil = l
                    .get("reported")
                    .get("pupilMagnification")
                    .num()
                    .unwrap_or(1.0);
                let squeeze = if pupil > 1.0 {
                    pupil
                } else {
                    1.0 / pupil.max(1.0e-6)
                };
                let obstruction = master.get("obstructionRatio").num().unwrap_or(0.0);
                (p, squeeze as f32, obstruction as f32)
            } else {
                let (surfaces, mut p) = compose_master(l);
                p.surfaces = specs(&surfaces);
                (
                    p,
                    1.0,
                    l.get("obstructionRatio").num().unwrap_or(0.0) as f32,
                )
            };
            CatalogueLens {
                key,
                name,
                character,
                prescription,
                squeeze,
                obstruction,
            }
        })
        .collect()
}

/// The catalogue's prescriptions as `tests/fixtures/lens-catalogue.json` holds them: per lens its
/// key, squeeze, obstruction and the bytes of its prescription at the end of `LENS`, in hex.
pub fn catalogue_json() -> String {
    let rows: Vec<String> = catalogue()
        .iter()
        .map(|l| {
            let hex: String = rt_core::scene::rsb::prescription_bytes(&l.prescription)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            format!(
                "{{\"key\":\"{}\",\"squeeze\":{},\"obstruction\":{},\"prescription\":\"{hex}\"}}",
                l.key, l.squeeze, l.obstruction
            )
        })
        .collect();
    format!("{{\"lenses\":[\n{}\n]}}\n", rows.join(",\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_has_its_16_lenses_composed_and_the_fixture_is_up_to_date() {
        let lenses = catalogue();
        assert_eq!(lenses.len(), 16);
        let adapter = lenses
            .iter()
            .find(|l| l.key == "anamorphic_adapter_2x")
            .unwrap();
        assert_eq!(adapter.squeeze, 2.0);
        let master = lenses.iter().find(|l| l.key == DEFAULT_MASTER).unwrap();
        // The adapter's surfaces (its placeholder stop left out), then the master's.
        let front = adapter.prescription.surfaces.len() - master.prescription.surfaces.len();
        assert_eq!(front, 4);
        assert_eq!(
            adapter.prescription.surfaces[front..],
            master.prescription.surfaces[..]
        );
        assert_eq!(
            adapter.prescription.stop,
            master.prescription.stop + front as u32
        );
        // The double Gauss is the O2 example's.
        assert_eq!(master.prescription, rt_core::example::double_gauss());
        assert_eq!(
            catalogue_json(),
            include_str!("../../../../tests/fixtures/lens-catalogue.json"),
            "rt --write-lens-catalogue tests/fixtures/lens-catalogue.json"
        );
    }
}
