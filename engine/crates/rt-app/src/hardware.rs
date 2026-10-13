//! What the computer has, for the AI model recommendation: CPU, RAM and GPUs with their
//! **dedicated** VRAM, asked of the operating system through its own programs and files (no
//! `unsafe`, no system libraries).
//!
//! * Windows: the display adapters under
//!   `HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}`
//!   (`reg query`): `DriverDesc`, `ProviderName` and `HardwareInformation.qwMemorySize` (64-bit),
//!   else `HardwareInformation.MemorySize` (32-bit, so at most 4 GiB). The RAM and the cores from
//!   PowerShell (`Get-CimInstance`), else `wmic`, with a time limit; the CPU name from the
//!   registry.
//! * Linux: `/proc/meminfo`, `/proc/cpuinfo`, the memory blocks of `/sys/devices/system/memory`
//!   (the installed RAM, which `MemTotal` undercounts by what the firmware and kernel keep),
//!   `nvidia-smi` when present, and `mem_info_vram_total` of the DRM cards (AMD).
//!
//! The RAM given to the rule is the installed amount when it can be read (a "16 GB" computer
//! shows about 15.6 GiB usable), else the usable total.

use crate::json;
use crate::recommend::{self, Catalogue, Input, Recommendation};
use std::fmt::Write as _;
use std::time::Duration;

/// Bytes in a GiB.
pub const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
/// Dedicated VRAM (effective GiB, as the rule reads it) from which the GPU is the default device.
pub const GPU_MIN_GIB: f64 = 4.0;

/// A graphics adapter.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Gpu {
    /// Its name.
    pub name: String,
    /// `NVIDIA`, `AMD`, `Intel`... (what the driver says).
    pub vendor: String,
    /// Dedicated VRAM, when known.
    pub vram_bytes: Option<u64>,
}

/// The computer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Hardware {
    /// CPU name.
    pub cpu: String,
    /// Physical cores (0: unknown).
    pub cores: u32,
    /// Hardware threads.
    pub threads: u32,
    /// Installed RAM, when known.
    pub ram_installed: Option<u64>,
    /// Usable RAM, when known.
    pub ram_usable: Option<u64>,
    /// Graphics adapters.
    pub gpus: Vec<Gpu>,
}

impl Hardware {
    /// The RAM the rule reads: installed, else usable.
    pub fn ram(&self) -> Option<u64> {
        self.ram_installed.or(self.ram_usable)
    }

    /// The adapter with the most known dedicated VRAM.
    pub fn best_gpu(&self) -> Option<&Gpu> {
        self.gpus
            .iter()
            .filter(|g| g.vram_bytes.is_some())
            .max_by_key(|g| g.vram_bytes)
    }
}

/// Where the AI would run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Device {
    /// The graphics card.
    Gpu,
    /// The processor.
    Cpu,
}

impl Device {
    /// `gpu` or `cpu`.
    pub fn parse(text: &str) -> Option<Device> {
        match text {
            "gpu" => Some(Device::Gpu),
            "cpu" => Some(Device::Cpu),
            _ => None,
        }
    }

    /// `gpu` or `cpu`.
    pub fn name(self) -> &'static str {
        match self {
            Device::Gpu => "gpu",
            Device::Cpu => "cpu",
        }
    }
}

/// The hardware, the device and what the rule says for it.
#[derive(Clone, Debug, PartialEq)]
pub struct Assessment {
    /// Where the AI would run: the GPU if one has at least [`GPU_MIN_GIB`] of dedicated VRAM
    /// (effective GiB), else the CPU, unless forced.
    pub device: Device,
    /// A GPU with known VRAM was found (so the choice GPU / CPU makes sense).
    pub gpu_found: bool,
    /// The input of the rule; `None` when the detection failed for this device.
    pub input: Option<Input>,
    /// The rule's answer.
    pub recommendation: Option<Recommendation>,
}

/// Applies the rule to `hw`.
pub fn assess(hw: &Hardware, forced: Option<Device>, catalogue: &Catalogue) -> Assessment {
    let best = hw.best_gpu();
    let gpu_gib = best.and_then(|g| g.vram_bytes).map(|b| b as f64 / GIB);
    let device = forced.unwrap_or(
        if gpu_gib.is_some_and(|v| recommend::effective_gib(v) >= GPU_MIN_GIB) {
            Device::Gpu
        } else {
            Device::Cpu
        },
    );
    let input = match device {
        Device::Gpu => gpu_gib.map(|vram_gib| Input::Gpu { vram_gib }),
        Device::Cpu => hw.ram().map(|b| Input::Cpu {
            ram_gib: b as f64 / GIB,
        }),
    };
    Assessment {
        device,
        gpu_found: gpu_gib.is_some(),
        recommendation: recommend::recommend(catalogue, input.as_ref(), &[]),
        input,
    }
}

// ------------------------------------------------------------------ parsers (pure, tested)

/// `MemTotal` of `/proc/meminfo`, bytes.
pub fn parse_meminfo(text: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kib: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    kib.checked_mul(1024)
}

/// `/proc/cpuinfo`: the model name, the physical cores (distinct physical id and core id
/// pairs) and the logical processors.
pub fn parse_cpuinfo(text: &str) -> (Option<String>, u32, u32) {
    let mut name = None;
    let mut threads = 0u32;
    let mut cores = std::collections::BTreeSet::new();
    let (mut physical, mut core) = (String::new(), None::<String>);
    for line in text.lines().chain(std::iter::once("")) {
        let (key, value) = line
            .split_once(':')
            .map_or((line.trim(), ""), |(k, v)| (k.trim(), v.trim()));
        match key {
            "processor" => threads += 1,
            "model name" | "Model" | "uarch" if name.is_none() && !value.is_empty() => {
                name = Some(value.to_string())
            }
            "physical id" => physical = value.to_string(),
            "core id" => core = Some(value.to_string()),
            "" => {
                if let Some(c) = core.take() {
                    cores.insert((physical.clone(), c));
                }
                physical.clear();
            }
            _ => {}
        }
    }
    (name, cores.len() as u32, threads)
}

/// `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` (MiB).
pub fn parse_nvidia_smi(text: &str) -> Vec<Gpu> {
    text.lines()
        .filter_map(|l| {
            let (name, mib) = l.rsplit_once(',')?;
            let mib: u64 = mib.trim().parse().ok()?;
            Some(Gpu {
                name: name.trim().to_string(),
                vendor: "NVIDIA".into(),
                vram_bytes: Some(mib * 1024 * 1024),
            })
        })
        .collect()
}

/// The installed RAM from `/sys/devices/system/memory`: `block_size_bytes` (hexadecimal) times
/// the blocks online.
pub fn parse_memory_blocks(block_size_hex: &str, online: u64) -> Option<u64> {
    let size = u64::from_str_radix(block_size_hex.trim().trim_start_matches("0x"), 16).ok()?;
    (online > 0).then(|| size.checked_mul(online)).flatten()
}

/// The vendor of a PCI vendor id.
pub fn pci_vendor(id: &str) -> &'static str {
    match id.trim().to_ascii_lowercase().as_str() {
        "0x10de" => "NVIDIA",
        "0x1002" => "AMD",
        "0x8086" => "Intel",
        _ => "",
    }
}

/// One value line of `reg query` output: (name, type, data).
pub fn parse_reg_value(line: &str) -> Option<(&str, &str, &str)> {
    let line = line.trim_start();
    let mut parts = line.splitn(3, "    ");
    let name = parts.next()?;
    let kind = parts.next()?.trim();
    if !kind.starts_with("REG_") {
        return None;
    }
    Some((name, kind, parts.next().unwrap_or("").trim()))
}

/// A registry number: `0x...` for `REG_DWORD` / `REG_QWORD`, little-endian hex bytes for
/// `REG_BINARY`.
pub fn parse_reg_number(kind: &str, data: &str) -> Option<u64> {
    match kind {
        "REG_DWORD" | "REG_QWORD" => u64::from_str_radix(data.trim_start_matches("0x"), 16).ok(),
        "REG_BINARY" => {
            let bytes: Vec<u8> = (0..data.len() / 2)
                .map(|i| u8::from_str_radix(data.get(i * 2..i * 2 + 2)?, 16).ok())
                .collect::<Option<_>>()?;
            if bytes.is_empty() || bytes.len() > 8 {
                return None;
            }
            Some(
                bytes
                    .iter()
                    .rev()
                    .fold(0u64, |acc, &b| (acc << 8) | u64::from(b)),
            )
        }
        _ => None,
    }
}

/// The display adapters in `reg query "<display class>" /s` output.
pub fn parse_reg_gpus(text: &str) -> Vec<Gpu> {
    struct Adapter {
        desc: Option<String>,
        provider: String,
        qw: Option<u64>,
        dw: Option<u64>,
    }
    let mut out = Vec::new();
    let mut current: Option<Adapter> = None;
    let flush = |a: Option<Adapter>, out: &mut Vec<Gpu>| {
        if let Some(Adapter {
            desc: Some(name),
            provider,
            qw,
            dw,
        }) = a
        {
            // The basic and remote display drivers are not graphics cards.
            if !name.starts_with("Microsoft ") {
                out.push(Gpu {
                    vendor: vendor_of(&provider, &name),
                    name,
                    vram_bytes: qw.or(dw).filter(|&b| b > 0),
                });
            }
        }
    };
    for line in text.lines() {
        if line.starts_with("HKEY_") {
            flush(current.take(), &mut out);
            // Only the adapters themselves (\0000, \0001...), not their subkeys.
            let last = line.trim_end().rsplit('\\').next().unwrap_or("");
            let parent_is_class =
                line.trim_end().rsplit('\\').nth(1).is_some_and(|p| {
                    p.eq_ignore_ascii_case("{4d36e968-e325-11ce-bfc1-08002be10318}")
                });
            if last.len() == 4 && last.bytes().all(|b| b.is_ascii_digit()) && parent_is_class {
                current = Some(Adapter {
                    desc: None,
                    provider: String::new(),
                    qw: None,
                    dw: None,
                });
            }
            continue;
        }
        let (Some(a), Some((name, kind, data))) = (current.as_mut(), parse_reg_value(line)) else {
            continue;
        };
        match name {
            "DriverDesc" => a.desc = Some(data.to_string()),
            "ProviderName" => a.provider = data.to_string(),
            "HardwareInformation.qwMemorySize" => a.qw = parse_reg_number(kind, data),
            "HardwareInformation.MemorySize" => a.dw = parse_reg_number(kind, data),
            _ => {}
        }
    }
    flush(current.take(), &mut out);
    out
}

fn vendor_of(provider: &str, name: &str) -> String {
    let both = format!("{provider} {name}").to_ascii_lowercase();
    if both.contains("nvidia") {
        "NVIDIA".into()
    } else if both.contains("amd") || both.contains("advanced micro") || both.contains("radeon") {
        "AMD".into()
    } else if both.contains("intel") {
        "Intel".into()
    } else {
        provider.to_string()
    }
}

/// The number in `wmic <class> get <property>` output (a header line, then the value).
pub fn parse_wmic_number(text: &str) -> Option<u64> {
    text.lines().find_map(|l| l.trim().parse::<u64>().ok())
}

/// `key=value` lines (the PowerShell output).
pub fn parse_key_values(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let (k, v) = l.split_once('=')?;
            Some((k.trim().to_ascii_lowercase(), v.trim().to_string()))
        })
        .collect()
}

// ------------------------------------------------------------------ detection

const DISPLAY_CLASS: &str =
    r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

/// Detects the hardware of this computer (a few seconds at most).
pub fn detect() -> Hardware {
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get() as u32);
    let mut hw = Hardware {
        threads,
        ..Hardware::default()
    };
    if cfg!(windows) {
        detect_windows(&mut hw);
    } else {
        detect_unix(&mut hw);
    }
    if hw.cpu.is_empty() {
        hw.cpu = "CPU".into();
    }
    hw
}

fn run(program: &str, args: &[&str], seconds: u64) -> Option<String> {
    crate::process::output(
        crate::process::command(program, args),
        Duration::from_secs(seconds),
    )
}

fn detect_windows(hw: &mut Hardware) {
    if let Some(text) = run("reg", &["query", DISPLAY_CLASS, "/s"], 10) {
        hw.gpus = parse_reg_gpus(&text);
    }
    if let Some(text) = run(
        "reg",
        &[
            "query",
            r"HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            "/v",
            "ProcessorNameString",
        ],
        5,
    ) {
        if let Some((_, _, name)) = text.lines().find_map(parse_reg_value) {
            hw.cpu = name.to_string();
        }
    }
    let script = "$ErrorActionPreference='SilentlyContinue';\
        $c=Get-CimInstance Win32_ComputerSystem;\
        $m=(Get-CimInstance Win32_PhysicalMemory|Measure-Object -Property Capacity -Sum).Sum;\
        $p=@(Get-CimInstance Win32_Processor);\
        'usable='+$c.TotalPhysicalMemory;'installed='+$m;\
        'cores='+($p|Measure-Object -Property NumberOfCores -Sum).Sum;\
        'threads='+($p|Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum;\
        'cpu='+$p[0].Name";
    let values = run(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        20,
    )
    .map(|t| parse_key_values(&t))
    .unwrap_or_default();
    let get = |k: &str| {
        values
            .iter()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.as_str())
            .filter(|v| !v.is_empty())
    };
    hw.ram_usable = get("usable").and_then(|v| v.parse().ok());
    hw.ram_installed = get("installed").and_then(|v| v.parse().ok());
    if let Some(c) = get("cores").and_then(|v| v.parse().ok()) {
        hw.cores = c;
    }
    if let Some(t) = get("threads").and_then(|v| v.parse().ok()) {
        hw.threads = t;
    }
    if hw.cpu.is_empty() {
        hw.cpu = get("cpu").unwrap_or("").to_string();
    }
    if hw.ram_usable.is_none() {
        // Systems without Get-CimInstance (older Windows, Wine): wmic's table.
        hw.ram_usable = run(
            "wmic",
            &["computersystem", "get", "TotalPhysicalMemory"],
            10,
        )
        .and_then(|t| parse_wmic_number(&t));
    }
}

fn detect_unix(hw: &mut Hardware) {
    let read = |p: &str| std::fs::read_to_string(p).ok();
    if let Some(text) = read("/proc/cpuinfo") {
        let (name, cores, threads) = parse_cpuinfo(&text);
        hw.cpu = name.unwrap_or_default();
        hw.cores = cores;
        if threads > 0 {
            hw.threads = threads;
        }
    }
    hw.ram_usable = read("/proc/meminfo").and_then(|t| parse_meminfo(&t));
    if let Some(size) = read("/sys/devices/system/memory/block_size_bytes") {
        let online = std::fs::read_dir("/sys/devices/system/memory")
            .map(|dir| {
                dir.filter_map(|e| e.ok())
                    .filter(|e| e.file_name().to_string_lossy().starts_with("memory"))
                    .filter(|e| {
                        std::fs::read_to_string(e.path().join("online"))
                            .map_or(true, |s| s.trim() == "1")
                    })
                    .count() as u64
            })
            .unwrap_or(0);
        hw.ram_installed = parse_memory_blocks(&size, online)
            // Blocks can be absent or fewer than the memory (hot-plug off): never below usable.
            .filter(|&b| {
                hw.ram_usable
                    .is_none_or(|u| b >= u && b < u.saturating_mul(2))
            });
    }
    if let Some(text) = run(
        "nvidia-smi",
        &[
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ],
        10,
    ) {
        hw.gpus.extend(parse_nvidia_smi(&text));
    }
    if let Ok(dir) = std::fs::read_dir("/sys/class/drm") {
        let mut cards: Vec<_> = dir
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .and_then(|n| n.strip_prefix("card"))
                    .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
            })
            .collect();
        cards.sort();
        for card in cards {
            let dev = card.join("device");
            let vendor = read(&dev.join("vendor").to_string_lossy()).unwrap_or_default();
            let vendor_name = pci_vendor(&vendor);
            if vendor_name == "NVIDIA" && hw.gpus.iter().any(|g| g.vendor == "NVIDIA") {
                continue; // nvidia-smi already listed it
            }
            let Some(vram) = read(&dev.join("mem_info_vram_total").to_string_lossy())
                .and_then(|t| t.trim().parse::<u64>().ok())
            else {
                continue;
            };
            let device = read(&dev.join("device").to_string_lossy()).unwrap_or_default();
            let name = read(&dev.join("product_name").to_string_lossy())
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| {
                    format!(
                        "{} GPU {}",
                        if vendor_name.is_empty() {
                            "PCI"
                        } else {
                            vendor_name
                        },
                        device.trim()
                    )
                });
            hw.gpus.push(Gpu {
                name,
                vendor: vendor_name.to_string(),
                vram_bytes: Some(vram),
            });
        }
    }
}

// ------------------------------------------------------------------ output

fn gib(bytes: Option<u64>) -> Option<f64> {
    bytes.map(|b| b as f64 / GIB)
}

/// `GET /api/hardware`.
pub fn to_json(hw: &Hardware, a: &Assessment) -> String {
    let gpus = hw.gpus.iter().map(|g| {
        json::Object::new()
            .str("name", &g.name)
            .str("vendor", &g.vendor)
            .opt_num("vramBytes", g.vram_bytes.map(|b| b as f64))
            .opt_num("vramGiB", gib(g.vram_bytes))
            .build()
    });
    let input = match a.input {
        None => "null".to_string(),
        Some(Input::Gpu { vram_gib }) => json::Object::new()
            .str("device", "gpu")
            .num("vramGiB", vram_gib)
            .build(),
        Some(Input::Cpu { ram_gib }) => json::Object::new()
            .str("device", "cpu")
            .num("ramGiB", ram_gib)
            .build(),
        Some(Input::Web { .. }) => "null".to_string(),
    };
    let rec = a.recommendation.as_ref().map_or("null".to_string(), |r| {
        json::Object::new()
            .opt_str("rowId", r.row_id.as_deref())
            .opt_str("recommended", r.recommended.as_deref())
            .raw(
                "offered",
                &json::array(r.offered.iter().map(|k| json::string(k))),
            )
            .raw(
                "skipped",
                &json::array(r.skipped.iter().map(|k| json::string(k))),
            )
            .build()
    });
    json::Object::new()
        .str("cpu", &hw.cpu)
        .num("cores", f64::from(hw.cores))
        .num("threads", f64::from(hw.threads))
        .opt_num("ramBytes", hw.ram().map(|b| b as f64))
        .opt_num("ramGiB", gib(hw.ram()))
        .opt_num("ramUsableBytes", hw.ram_usable.map(|b| b as f64))
        .raw("gpus", &json::array(gpus))
        .str("device", a.device.name())
        .bool("gpuFound", a.gpu_found)
        .bool("detected", a.input.is_some())
        .raw("input", &input)
        .raw("recommendation", &rec)
        .build()
}

fn ini_value(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// The INI the installer reads (`repackshot --hardware <file>`).
pub fn to_ini(hw: &Hardware, a: &Assessment, catalogue: &Catalogue) -> String {
    let mut s = String::new();
    let gpu = hw.best_gpu();
    let one = |v: Option<f64>| v.map_or(String::new(), |v| format!("{v:.1}"));
    let _ = write!(
        s,
        "[hardware]\r\ncpu={}\r\ncores={}\r\nthreads={}\r\nram_gib={}\r\ngpu={}\r\nvram_gib={}\r\ngpu_found={}\r\ndetected={}\r\n",
        ini_value(&hw.cpu),
        hw.cores,
        hw.threads,
        one(gib(hw.ram())),
        gpu.map_or(String::new(), |g| ini_value(&g.name)),
        one(gpu.and_then(|g| gib(g.vram_bytes))),
        u8::from(a.gpu_found),
        u8::from(a.input.is_some()),
    );
    let rec = a.recommendation.as_ref();
    let recommended = rec.and_then(|r| r.recommended.clone()).unwrap_or_default();
    let offered = rec.map_or(Vec::new(), |r| r.offered.clone());
    let _ = write!(
        s,
        "[recommendation]\r\ndevice={}\r\nrow={}\r\nkey={}\r\noffered={}\r\n",
        a.device.name(),
        rec.and_then(|r| r.row_id.clone()).unwrap_or_default(),
        recommended,
        offered.join(","),
    );
    let _ = write!(s, "[models]\r\ncount={}\r\n", catalogue.models.len());
    for (i, m) in catalogue.models.iter().enumerate() {
        let size = m.total_bytes as f64 / GIB;
        let _ = write!(
            s,
            "[model{i}]\r\nkey={}\r\nlabel_en={}\r\nlabel_es={}\r\nsummary_en={}\r\nsummary_es={}\r\nsize_gib={size:.1}\r\nlicence={}\r\ncommercial={}\r\nrestrictions={}\r\navailable={}\r\ndesktop={}\r\nrecommended={}\r\noffered={}\r\n",
            m.key,
            ini_value(&m.label_en),
            ini_value(&m.label_es),
            ini_value(&m.summary_en),
            ini_value(&m.summary_es),
            ini_value(&m.licence),
            u8::from(m.commercial),
            u8::from(m.restrictions),
            u8::from(m.available),
            u8::from(m.desktop()),
            u8::from(m.key == recommended),
            u8::from(offered.contains(&m.key)),
        );
    }
    s
}

/// UTF-16LE with a byte order mark: what Windows' INI functions (and NSIS's `ReadINIStr`)
/// read as Unicode, so names with accents or `·` arrive intact.
pub fn utf16le(text: &str) -> Vec<u8> {
    let mut out = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        out.extend_from_slice(&unit.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_linux_sources() {
        assert_eq!(
            parse_meminfo("MemTotal:       16479424 kB\nMemFree: 1 kB\n"),
            Some(16_479_424 * 1024)
        );
        assert_eq!(parse_meminfo("nothing"), None);
        let cpuinfo = "processor\t: 0\nmodel name\t: Intel(R) Xeon(R) @ 2.80GHz\nphysical id\t: 0\ncore id\t\t: 0\n\nprocessor\t: 1\nmodel name\t: Intel(R) Xeon(R) @ 2.80GHz\nphysical id\t: 0\ncore id\t\t: 0\n\nprocessor\t: 2\nphysical id\t: 0\ncore id\t\t: 1\n\n";
        assert_eq!(
            parse_cpuinfo(cpuinfo),
            (Some("Intel(R) Xeon(R) @ 2.80GHz".into()), 2, 3)
        );
        assert_eq!(
            parse_nvidia_smi(
                "NVIDIA GeForce RTX 4070, 12282\nNVIDIA A100-SXM4-80GB, 81920\nbad line\n"
            ),
            vec![
                Gpu {
                    name: "NVIDIA GeForce RTX 4070".into(),
                    vendor: "NVIDIA".into(),
                    vram_bytes: Some(12282 << 20)
                },
                Gpu {
                    name: "NVIDIA A100-SXM4-80GB".into(),
                    vendor: "NVIDIA".into(),
                    vram_bytes: Some(81920 << 20)
                }
            ]
        );
        assert_eq!(parse_memory_blocks("8000000\n", 128), Some(16 << 30));
        assert_eq!(parse_memory_blocks("zz", 128), None);
        assert_eq!(parse_memory_blocks("8000000", 0), None);
        assert_eq!(pci_vendor("0x1002\n"), "AMD");
    }

    const REG: &str = "\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\r\n    Class    REG_SZ    Display\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000\r\n    DriverDesc    REG_SZ    NVIDIA GeForce RTX 3060 Laptop GPU\r\n    ProviderName    REG_SZ    NVIDIA\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x180000000\r\n    HardwareInformation.MemorySize    REG_BINARY    00000080\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000\\Settings\r\n    DriverDesc    REG_SZ    not an adapter\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0001\r\n    DriverDesc    REG_SZ    Intel(R) UHD Graphics\r\n    ProviderName    REG_SZ    Intel Corporation\r\n    HardwareInformation.MemorySize    REG_DWORD    0x8000000\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0002\r\n    DriverDesc    REG_SZ    Microsoft Basic Display Adapter\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0003\r\n    DriverDesc    REG_SZ    AMD Radeon RX 6800\r\n    ProviderName    REG_SZ    Advanced Micro Devices, Inc.\r\n    HardwareInformation.MemorySize    REG_BINARY    00000000\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x400000000\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\Properties\r\nERROR: Access is denied.\r\n";

    #[test]
    fn parses_the_windows_display_class() {
        let gpus = parse_reg_gpus(REG);
        assert_eq!(gpus.len(), 3, "{gpus:?}");
        assert_eq!(gpus[0].name, "NVIDIA GeForce RTX 3060 Laptop GPU");
        assert_eq!(gpus[0].vendor, "NVIDIA");
        assert_eq!(gpus[0].vram_bytes, Some(6 << 30), "the 64-bit value wins");
        assert_eq!(gpus[1].vendor, "Intel");
        assert_eq!(gpus[1].vram_bytes, Some(128 << 20));
        assert_eq!(gpus[2].vendor, "AMD");
        assert_eq!(gpus[2].vram_bytes, Some(16 << 30));
        assert_eq!(
            parse_reg_number("REG_BINARY", "00000080"),
            Some(0x8000_0000)
        );
        assert_eq!(parse_reg_number("REG_BINARY", "zz"), None);
        assert_eq!(
            parse_reg_value("    (Predeterminado)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"),
            Some((
                "(Predeterminado)",
                "REG_SZ",
                "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
            ))
        );
        assert_eq!(
            parse_wmic_number("TotalPhysicalMemory  \r\r\n17069891584  \r\r\n\r\r\n"),
            Some(17_069_891_584)
        );
        assert_eq!(parse_wmic_number("No Instance(s) Available."), None);
        assert_eq!(
            parse_key_values("usable=17069891584\r\ninstalled=17179869184\r\ncpu=AMD Ryzen 7 5800X 8-Core Processor\r\n")[2],
            ("cpu".into(), "AMD Ryzen 7 5800X 8-Core Processor".into())
        );
    }

    fn machine(vram: Option<u64>, ram: Option<u64>) -> Hardware {
        Hardware {
            cpu: "Test CPU".into(),
            cores: 8,
            threads: 16,
            ram_installed: ram,
            ram_usable: ram.map(|r| r - (400 << 20)),
            gpus: vec![
                Gpu {
                    name: "Integrated".into(),
                    vendor: "Intel".into(),
                    vram_bytes: Some(128 << 20),
                },
                Gpu {
                    name: "Big GPU".into(),
                    vendor: "NVIDIA".into(),
                    vram_bytes: vram,
                },
            ],
        }
    }

    #[test]
    fn device_choice_and_recommendation() {
        let cat = crate::recommend::catalogue();
        let a = assess(&machine(Some(12 << 30), Some(32 << 30)), None, cat);
        assert_eq!((a.device, a.gpu_found), (Device::Gpu, true));
        let rec = a.recommendation.clone().unwrap();
        assert_eq!(rec.row_id.as_deref(), Some("gpu-12"));
        assert_eq!(rec.recommended.as_deref(), Some("ZIMAGE_Q8"));
        // Forced to the CPU: the installed RAM decides (32 GiB, not the 31.6 usable).
        let cpu = assess(
            &machine(Some(12 << 30), Some(32 << 30)),
            Some(Device::Cpu),
            cat,
        );
        assert_eq!(
            cpu.recommendation.unwrap().row_id.as_deref(),
            Some("cpu-32")
        );
        // A 2 GiB GPU is not used by default; forced, it gets the small row.
        let small = machine(Some(2 << 30), Some(16 << 30));
        assert_eq!(assess(&small, None, cat).device, Device::Cpu);
        assert_eq!(
            assess(&small, Some(Device::Gpu), cat)
                .recommendation
                .unwrap()
                .row_id
                .as_deref(),
            Some("gpu-0")
        );
        // No VRAM known: the GPU cannot be assessed, the CPU can.
        let unknown = machine(None, Some(8 << 30));
        let mut only_unknown = unknown.clone();
        only_unknown.gpus.remove(0);
        let a = assess(&only_unknown, None, cat);
        assert!(!a.gpu_found && a.device == Device::Cpu);
        assert_eq!(
            assess(&only_unknown, Some(Device::Gpu), cat).recommendation,
            None
        );
        // Nothing detected: no recommendation.
        let none = Hardware::default();
        let a = assess(&none, None, cat);
        assert_eq!((a.input, a.recommendation), (None, None));
    }

    #[test]
    fn ini_for_the_installer() {
        let cat = crate::recommend::catalogue();
        let hw = machine(Some(12 << 30), Some(32 << 30));
        let a = assess(&hw, None, cat);
        let ini = to_ini(&hw, &a, cat);
        assert!(ini.starts_with("[hardware]\r\ncpu=Test CPU\r\ncores=8\r\nthreads=16\r\nram_gib=32.0\r\ngpu=Big GPU\r\nvram_gib=12.0\r\ngpu_found=1\r\ndetected=1\r\n"), "{ini}");
        assert!(ini.contains("[recommendation]\r\ndevice=gpu\r\nrow=gpu-12\r\nkey=ZIMAGE_Q8\r\noffered=KLEIN4B_Q4\r\n"));
        assert!(ini.contains(&format!("[models]\r\ncount={}\r\n", cat.models.len())));
        assert!(ini.contains("[model0]\r\nkey=ZIMAGE_Q8\r\n"));
        assert!(ini.contains("label_en=Z-Image-Turbo · Q8\r\n"));
        assert!(ini.contains("size_gib=8.8\r\n"), "9 410 025 348 bytes");
        let web = cat
            .models
            .iter()
            .position(|m| m.key == "ZIMAGE_WEB")
            .unwrap();
        assert!(ini.contains(&format!("[model{web}]\r\nkey=ZIMAGE_WEB\r\n")));
        let section = ini.split(&format!("[model{web}]")).nth(1).unwrap();
        assert!(section.contains("available=0\r\ndesktop=0\r\n"));
        let failed = to_ini(
            &Hardware::default(),
            &assess(&Hardware::default(), None, cat),
            cat,
        );
        assert!(failed.contains("detected=0\r\n") && failed.contains("key=\r\n"));
        let bytes = utf16le("a·");
        assert_eq!(bytes, [0xFF, 0xFE, b'a', 0, 0xB7, 0]);
        let json = crate::json::parse(&to_json(&hw, &a)).unwrap();
        assert_eq!(
            json.get("recommendation")
                .unwrap()
                .get("recommended")
                .unwrap()
                .as_str(),
            Some("ZIMAGE_Q8")
        );
        assert_eq!(json.get("detected").unwrap().as_bool(), Some(true));
    }
}
