//! What the computer has, for the AI model recommendation: CPU, RAM and GPUs with their
//! **dedicated** VRAM, asked of the operating system.
//!
//! * Windows, the graphics cards from up to four sources, each logged with what it found or why
//!   it failed, and merged by adapter name ([`merge_gpus`]):
//!   1. **DXGI** (`platform::dxgi`, in-process): every adapter there now, with its exact dedicated
//!      VRAM; the software and Microsoft adapters are skipped.
//!   2. **The registry**: the display class
//!      `HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}`,
//!      one `reg query` for its subkeys and one per adapter key (`\0000`, `\0001`...):
//!      `DriverDesc`, `ProviderName` and `HardwareInformation.qwMemorySize` (64-bit), else
//!      `HardwareInformation.MemorySize` (32-bit, so at most 4 GiB). Never `/s` over the class:
//!      its `Properties` subkey is access denied and `reg` then exits 1, and what `/s` lists
//!      after an error cannot be relied on. A non-zero exit is read anyway
//!      ([`crate::process::output_any`]).
//!   3. **CIM**: `Win32_VideoController` (`Name`, `AdapterCompatibility`, `AdapterRAM`, a 32-bit
//!      figure that stops at 4 GiB), in the same PowerShell run as the RAM and the cores.
//!   4. **wmic**, the same class, only when PowerShell could not answer.
//!
//!   The adapters are those of the first source that lists exactly the adapters there now (DXGI,
//!   else CIM, else wmic): the registry keeps the driver keys of a card that was removed. The
//!   other sources add what they know of the same adapters. The VRAM kept is the largest exact
//!   one (DXGI, `qwMemorySize`), else the largest 32-bit one. The RAM and the cores from
//!   PowerShell (`Get-CimInstance`), else `wmic`, with a time limit; the CPU name from the
//!   registry. Programs by their absolute path in `System32`.
//! * Linux: `/proc/meminfo`, `/proc/cpuinfo`, the memory blocks of `/sys/devices/system/memory`
//!   (the installed RAM, which `MemTotal` undercounts by what the firmware and kernel keep),
//!   `nvidia-smi` when present, and `mem_info_vram_total` of the DRM cards (AMD).
//!
//! The RAM given to the rule is the installed amount when it can be read (a "16 GB" computer
//! shows about 15.6 GiB usable), else the usable total.

use crate::json;
use crate::process::{self, Ran};
use crate::recommend::{self, Catalogue, Input, Recommendation};
use std::fmt::Write as _;
use std::path::Path;
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
    /// What each source of the graphics adapters said (for the log and `/api/hardware`).
    pub gpu_sources: Vec<GpuSource>,
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

    /// No source of the graphics adapters could be asked: "no graphics card" is then unknown,
    /// not a fact (the interface says the detection failed).
    pub fn gpu_detection_failed(&self) -> bool {
        !self.gpu_sources.iter().any(|s| s.found.is_ok())
    }
}

/// A graphics adapter as one source saw it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seen {
    /// The adapter, with the VRAM that source gives.
    pub gpu: Gpu,
    /// The VRAM is an exact 64-bit figure (DXGI, the registry's `qwMemorySize`), not a 32-bit
    /// one that stops at 4 GiB (the registry's `MemorySize`, `AdapterRAM`).
    pub exact: bool,
}

/// What one source said about the graphics adapters.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GpuSource {
    /// `dxgi`, `registry`, `cim`, `wmic` (Windows); `nvidia-smi`, `drm` (Linux); `test`.
    pub name: &'static str,
    /// It lists exactly the adapters there now (DXGI, CIM, wmic): the first such source that
    /// answered decides which adapters there are; the others only add to them.
    pub authoritative: bool,
    /// The graphics cards it saw, or why it could not be asked.
    pub found: Result<Vec<Seen>, String>,
    /// What else the log should say: adapters skipped and why, a non-zero exit read anyway.
    pub notes: Vec<String>,
}

impl GpuSource {
    fn new(name: &'static str, authoritative: bool) -> GpuSource {
        GpuSource {
            name,
            authoritative,
            found: Ok(Vec::new()),
            notes: Vec::new(),
        }
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

/// The vendor of a PCI vendor id written in hexadecimal (`0x10de`, Linux's `vendor` files).
pub fn pci_vendor(id: &str) -> &'static str {
    u32::from_str_radix(id.trim().trim_start_matches("0x"), 16).map_or("", vendor_name)
}

/// The vendor of a PCI vendor id; empty when it is not one of these.
pub fn vendor_name(id: u32) -> &'static str {
    match id {
        0x10DE => "NVIDIA",
        0x1002 | 0x1022 => "AMD",
        0x8086 => "Intel",
        0x5143 => "Qualcomm",
        0x13B5 => "ARM",
        0x1414 => "Microsoft",
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

/// An adapter key of the display class in `reg query` output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegAdapter {
    /// The key's name under the class (`0000`, `0001`...).
    pub key: String,
    /// What its values say.
    pub seen: Seen,
}

/// The name of the class's adapter key a `reg query` header line is (`HKEY_...\{class}\0000`):
/// four digits right under the display class, not their subkeys nor `Properties`.
fn adapter_key(line: &str) -> Option<&str> {
    let line = line.trim();
    if !line.starts_with("HKEY_") {
        return None;
    }
    let mut parts = line.rsplit('\\');
    let last = parts.next()?;
    let parent = parts.next()?;
    (last.len() == 4
        && last.bytes().all(|b| b.is_ascii_digit())
        && parent.eq_ignore_ascii_case(DISPLAY_CLASS_GUID))
    .then_some(last)
}

/// The adapter keys (`0000`, `0001`...) listed in `reg query "<display class>"` output.
pub fn parse_reg_subkeys(text: &str) -> Vec<String> {
    let mut keys: Vec<String> = text
        .lines()
        .filter_map(adapter_key)
        .map(str::to_string)
        .collect();
    keys.dedup();
    keys
}

/// The display adapters in `reg query` output of the class's adapter keys (any number of them,
/// in any order; lines that are not values, such as `ERROR: Access is denied.` or `ERROR: Acceso
/// denegado.`, are not read). Microsoft's own adapters are included: the caller skips them.
pub fn parse_reg_adapters(text: &str) -> Vec<RegAdapter> {
    struct Adapter {
        key: String,
        desc: Option<String>,
        provider: String,
        qw: Option<u64>,
        dw: Option<u64>,
    }
    let mut out = Vec::new();
    let mut current: Option<Adapter> = None;
    let flush = |a: Option<Adapter>, out: &mut Vec<RegAdapter>| {
        if let Some(Adapter {
            key,
            desc: Some(name),
            provider,
            qw,
            dw,
        }) = a
        {
            let qw = qw.filter(|&b| b > 0);
            out.push(RegAdapter {
                key,
                seen: Seen {
                    gpu: Gpu {
                        vendor: vendor_of(&provider, &name),
                        name,
                        vram_bytes: qw.or(dw).filter(|&b| b > 0),
                    },
                    exact: qw.is_some(),
                },
            });
        }
    };
    for line in text.lines() {
        if line.starts_with("HKEY_") {
            flush(current.take(), &mut out);
            // Only the adapters themselves (\0000, \0001...), not their subkeys.
            current = adapter_key(line).map(|key| Adapter {
                key: key.to_string(),
                desc: None,
                provider: String::new(),
                qw: None,
                dw: None,
            });
            continue;
        }
        let (Some(a), Some((name, kind, data))) = (current.as_mut(), parse_reg_value(line)) else {
            continue;
        };
        match name {
            "DriverDesc" => a.desc = Some(data.to_string()).filter(|d| !d.is_empty()),
            "ProviderName" => a.provider = data.to_string(),
            "HardwareInformation.qwMemorySize" => a.qw = parse_reg_number(kind, data),
            "HardwareInformation.MemorySize" => a.dw = parse_reg_number(kind, data),
            _ => {}
        }
    }
    flush(current.take(), &mut out);
    out
}

/// Why an adapter by this name is not a graphics card: Microsoft's basic display and render
/// drivers, its remote and virtual display adapters.
pub fn not_a_card(name: &str) -> Option<&'static str> {
    name.starts_with("Microsoft ").then_some("Microsoft's")
}

fn vendor_of(provider: &str, name: &str) -> String {
    let both = format!("{provider} {name}").to_ascii_lowercase();
    if both.contains("nvidia") {
        "NVIDIA".into()
    } else if both.contains("amd") || both.contains("advanced micro") || both.contains("radeon") {
        "AMD".into()
    } else if both.contains("intel") {
        "Intel".into()
    } else if both.contains("qualcomm") {
        "Qualcomm".into()
    } else {
        provider.trim().to_string()
    }
}

/// The graphics cards DXGI listed (`platform::dxgi`), the skipped adapters as notes. `Err` when
/// DXGI listed nothing at all: Windows always has at least its software adapter.
pub fn dxgi_cards(
    list: Vec<crate::platform::dxgi::Adapter>,
) -> (Result<Vec<Seen>, String>, Vec<String>) {
    if list.is_empty() {
        return (
            Err("DXGI listed no adapter at all, not even its software one".into()),
            Vec::new(),
        );
    }
    let mut notes = Vec::new();
    let mut cards = Vec::new();
    for a in list {
        if let Some(why) = a.not_a_card() {
            notes.push(format!("skipped {} ({why})", a.name));
            continue;
        }
        let vendor = match vendor_name(a.vendor_id) {
            "" => format!("PCI {:04X}", a.vendor_id),
            v => v.to_string(),
        };
        cards.push(Seen {
            gpu: Gpu {
                name: a.name,
                vendor,
                vram_bytes: Some(a.dedicated_video_memory).filter(|&b| b > 0),
            },
            exact: true,
        });
    }
    (Ok(cards), notes)
}

/// The video controllers of the PowerShell run (`gpus=<count>`, then `gpu=<name>|<adapter
/// compatibility>|<AdapterRAM>` lines, or `gpuerror=<why>`), already read as [`parse_key_values`].
/// `Err` when CIM did not answer.
pub fn parse_cim_gpus(values: &[(String, String)]) -> Result<Vec<Seen>, String> {
    if let Some((_, why)) = values.iter().find(|(k, _)| k == "gpuerror") {
        return Err(format!("Win32_VideoController: {why}"));
    }
    if !values.iter().any(|(k, _)| k == "gpus") {
        return Err("no answer about Win32_VideoController".into());
    }
    Ok(values
        .iter()
        .filter(|(k, _)| k == "gpu")
        .filter_map(|(_, v)| {
            let mut parts = v.rsplitn(3, '|');
            let ram = parts.next()?;
            let compatibility = parts.next()?;
            let name = parts.next()?.trim();
            (!name.is_empty()).then(|| controller(name, compatibility, ram))
        })
        .collect())
}

/// A `Win32_VideoController` (its `AdapterRAM` is a 32-bit figure).
fn controller(name: &str, compatibility: &str, ram: &str) -> Seen {
    Seen {
        gpu: Gpu {
            name: name.to_string(),
            vendor: vendor_of(compatibility, name),
            vram_bytes: ram.trim().parse().ok().filter(|&b: &u64| b > 0),
        },
        exact: false,
    }
}

/// The rows of a `wmic ... get A,B,C` table: the columns start where the header's names start
/// (values may have spaces; the names do not).
pub fn parse_wmic_table(text: &str) -> Vec<Vec<(String, String)>> {
    let mut lines = text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty());
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let head: Vec<char> = header.chars().collect();
    let starts: Vec<usize> = (0..head.len())
        .filter(|&i| head[i] != ' ' && (i == 0 || head[i - 1] == ' '))
        .collect();
    let cell = |row: &[char], j: usize| -> String {
        let from = starts[j].min(row.len());
        let to = starts.get(j + 1).map_or(row.len(), |&e| e.min(row.len()));
        row[from..to].iter().collect::<String>().trim().to_string()
    };
    let names: Vec<String> = (0..starts.len()).map(|j| cell(&head, j)).collect();
    lines
        .map(|l| {
            let row: Vec<char> = l.chars().collect();
            (0..starts.len())
                .map(|j| (names[j].clone(), cell(&row, j)))
                .collect()
        })
        .collect()
}

/// The video controllers of `wmic path Win32_VideoController get
/// AdapterCompatibility,AdapterRAM,Name`. `Err` when the table is not there.
pub fn parse_wmic_gpus(text: &str) -> Result<Vec<Seen>, String> {
    let first = text.lines().map(str::trim).find(|l| !l.is_empty());
    if !first.is_some_and(|h| h.contains("Name") && h.contains("AdapterRAM")) {
        return Err(format!("no table ({})", first.unwrap_or("nothing printed")));
    }
    let rows = parse_wmic_table(text);
    let get = |row: &[(String, String)], k: &str| {
        row.iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(k))
            .map_or(String::new(), |(_, v)| v.clone())
    };
    Ok(rows
        .iter()
        .filter(|r| !get(r, "Name").is_empty())
        .map(|r| {
            controller(
                &get(r, "Name"),
                &get(r, "AdapterCompatibility"),
                &get(r, "AdapterRAM"),
            )
        })
        .collect())
}

/// What makes two names one adapter: lower case, letters and digits, without `(R)` and `(TM)`.
pub fn gpu_key(name: &str) -> String {
    name.to_lowercase()
        .replace("(r)", "")
        .replace("(tm)", "")
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// The graphics cards of what the sources said ([`GpuSource`]): the adapters of the first
/// authoritative source that answered (DXGI, CIM, wmic: they list exactly the adapters there now,
/// never the driver keys a removed card left in the registry), else of every source that answered;
/// each source's view of the same adapter (by [`gpu_key`], two identical cards staying two) adds
/// what it knows. The VRAM is the largest exact figure, else the largest 32-bit one.
pub fn merge_gpus(sources: &[GpuSource]) -> Vec<Gpu> {
    struct Merged {
        key: String,
        gpu: Gpu,
        exact: Option<u64>,
        capped: Option<u64>,
    }
    let answered: Vec<&[Seen]> = sources
        .iter()
        .filter_map(|s| s.found.as_deref().ok())
        .collect();
    let authority = sources
        .iter()
        .filter(|s| s.found.is_ok())
        .position(|s| s.authoritative);
    // The authority first (its adapters, in its order), then the others in their order.
    let order: Vec<usize> = authority
        .into_iter()
        .chain((0..answered.len()).filter(|&i| Some(i) != authority))
        .collect();
    let mut out: Vec<Merged> = Vec::new();
    for (n, &i) in order.iter().enumerate() {
        let may_add = authority.is_none() || n == 0;
        let mut taken = vec![false; out.len()];
        for seen in answered[i] {
            let key = gpu_key(&seen.gpu.name);
            let at = match (0..out.len()).find(|&j| !taken[j] && out[j].key == key) {
                Some(j) => j,
                None if may_add => {
                    out.push(Merged {
                        key,
                        gpu: Gpu {
                            vram_bytes: None,
                            ..seen.gpu.clone()
                        },
                        exact: None,
                        capped: None,
                    });
                    taken.push(false);
                    out.len() - 1
                }
                None => continue,
            };
            taken[at] = true;
            let m = &mut out[at];
            if m.gpu.vendor.is_empty() {
                m.gpu.vendor = seen.gpu.vendor.clone();
            }
            if let Some(v) = seen.gpu.vram_bytes.filter(|&v| v > 0) {
                let slot = if seen.exact {
                    &mut m.exact
                } else {
                    &mut m.capped
                };
                *slot = Some(slot.map_or(v, |o| o.max(v)));
            }
        }
    }
    out.into_iter()
        .map(|m| Gpu {
            vram_bytes: m.exact.or(m.capped),
            ..m.gpu
        })
        .collect()
}

/// An adapter for the log: `NVIDIA GeForce RTX 3060 (NVIDIA, 6.00 GiB)`.
pub fn gpu_text(g: &Gpu, exact: bool) -> String {
    let vram = g.vram_bytes.map_or("VRAM unknown".to_string(), |b| {
        format!(
            "{:.2} GiB{}",
            b as f64 / GIB,
            if exact { "" } else { ", 32-bit figure" }
        )
    });
    if g.vendor.is_empty() {
        format!("{} ({vram})", g.name)
    } else {
        format!("{} ({}, {vram})", g.name, g.vendor)
    }
}

/// One source for the log: what it found or why it failed, and its notes.
pub fn source_text(s: &GpuSource) -> String {
    let mut t = match &s.found {
        Ok(list) if list.is_empty() => format!("{}: no graphics card", s.name),
        Ok(list) => format!(
            "{}: {}",
            s.name,
            list.iter()
                .map(|x| gpu_text(&x.gpu, x.exact))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Err(e) => format!("{}: failed: {e}", s.name),
    };
    if !s.notes.is_empty() {
        let _ = write!(t, "; {}", s.notes.join("; "));
    }
    t
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

/// The display adapters' setup class, `{4d36e968-e325-11ce-bfc1-08002be10318}`.
const DISPLAY_CLASS_GUID: &str = "{4d36e968-e325-11ce-bfc1-08002be10318}";
const DISPLAY_CLASS: &str =
    r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
const CPU_KEY: &str = r"HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0";

/// Runs a program for the detection: the program, its arguments and a time limit in seconds; what
/// it printed and how it exited, whatever the code (tests put a fake one here).
pub type Runner<'a> = &'a dyn Fn(&Path, &[&str], u64) -> Result<Ran, String>;

/// [`Runner`] for real: no console window, killed at the limit.
pub fn run(program: &Path, args: &[&str], seconds: u64) -> Result<Ran, String> {
    process::output_any(
        process::command(program, args),
        Duration::from_secs(seconds),
    )
}

/// Detects the hardware of this computer (a few seconds at most), and logs where the graphics
/// cards came from.
pub fn detect() -> Hardware {
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get() as u32);
    let mut hw = Hardware {
        threads,
        ..Hardware::default()
    };
    if cfg!(windows) {
        detect_windows(&mut hw, &run);
    } else {
        detect_unix(&mut hw, &run);
    }
    if hw.cpu.is_empty() {
        hw.cpu = "CPU".into();
    }
    if let Some(text) = std::env::var_os(TEST_GPUS) {
        let mut test = GpuSource::new("test", true);
        test.notes
            .push(format!("{TEST_GPUS} replaces what was detected"));
        test.found = Ok(parse_test_gpus(&text.to_string_lossy())
            .into_iter()
            .map(|gpu| Seen { gpu, exact: true })
            .collect());
        hw.gpu_sources.push(test.clone());
        hw.gpus = merge_gpus(std::slice::from_ref(&test));
    }
    for s in &hw.gpu_sources {
        crate::log!("hardware: {}", source_text(s));
    }
    crate::log!("hardware: {}", summary_text(&hw));
    hw
}

/// The detection's result for the log: the graphics cards, or that there are none, or that none
/// of the sources could be asked.
pub fn summary_text(hw: &Hardware) -> String {
    let gpus = if hw.gpu_detection_failed() {
        "graphics cards unknown: every source failed".to_string()
    } else if hw.gpus.is_empty() {
        "no graphics card".to_string()
    } else {
        // The VRAM as merged (whether a figure is 32-bit is on each source's line).
        format!(
            "graphics cards: {}",
            hw.gpus
                .iter()
                .map(|g| gpu_text(g, true))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let ram = hw.ram().map_or("RAM unknown".to_string(), |b| {
        format!("{:.1} GiB of RAM", b as f64 / GIB)
    });
    format!(
        "{}, {} cores / {} threads, {ram}; {gpus}",
        hw.cpu, hw.cores, hw.threads
    )
}

/// For tests only: replaces the detected graphics adapters (a check of the interface on a computer
/// without a graphics card, phase P3e). `name|vendor|vram_bytes`, several separated by `;`; an
/// empty or unreadable VRAM is unknown.
pub const TEST_GPUS: &str = "REPACKSHOT_TEST_GPUS";

/// The adapters of [`TEST_GPUS`].
pub fn parse_test_gpus(text: &str) -> Vec<Gpu> {
    text.split(';')
        .filter_map(|item| {
            let mut fields = item.split('|').map(str::trim);
            let name = fields.next().filter(|n| !n.is_empty())?;
            Some(Gpu {
                name: name.to_string(),
                vendor: fields.next().unwrap_or("").to_string(),
                vram_bytes: fields.next().and_then(|v| v.parse().ok()),
            })
        })
        .collect()
}

/// A note for a program that exited non-zero but whose output was read.
fn read_anyway(what: &str, ran: &Ran) -> Option<String> {
    (!ran.success()).then(|| format!("{what}: {}, read anyway", ran.exit_text()))
}

/// Skips the adapters that are not graphics cards (by name), with a note for each.
fn cards_only(found: Vec<Seen>, notes: &mut Vec<String>) -> Vec<Seen> {
    found
        .into_iter()
        .filter(|s| match not_a_card(&s.gpu.name) {
            Some(why) => {
                notes.push(format!("skipped {} ({why})", s.gpu.name));
                false
            }
            None => true,
        })
        .collect()
}

/// The graphics cards DXGI lists (`platform::dxgi`).
pub fn dxgi_source() -> GpuSource {
    let mut s = GpuSource::new("dxgi", true);
    match crate::platform::dxgi::adapters() {
        Ok(list) => (s.found, s.notes) = dxgi_cards(list),
        Err(e) => s.found = Err(e),
    }
    s
}

/// The graphics cards of the registry's display class, with `reg` at `reg`: one query for the
/// class's subkeys, one per adapter key. Never `/s` over the class: its `Properties` subkey is
/// access denied, `reg` then exits 1, and what `/s` lists after an error cannot be relied on.
/// Every query's output is read whatever its exit code.
pub fn registry_source(reg: &Path, run: Runner) -> GpuSource {
    let mut s = GpuSource::new("registry", false);
    let listing = match run(reg, &["query", DISPLAY_CLASS], 10) {
        Ok(r) => r,
        Err(e) => {
            s.found = Err(format!("{}: {e}", reg.display()));
            return s;
        }
    };
    s.notes.extend(read_anyway("the class", &listing));
    let keys = parse_reg_subkeys(&listing.stdout);
    if keys.is_empty() && !listing.success() {
        s.found = Err(format!("the class: {}", listing.exit_text()));
        return s;
    }
    let mut found = Vec::new();
    for key in keys {
        let path = format!(r"{DISPLAY_CLASS}\{key}");
        match run(reg, &["query", &path], 10) {
            Ok(r) => {
                s.notes.extend(read_anyway(&key, &r));
                match parse_reg_adapters(&r.stdout)
                    .into_iter()
                    .find(|a| a.key == key)
                {
                    Some(a) => found.push(a.seen),
                    None => s.notes.push(format!("{key}: no DriverDesc")),
                }
            }
            Err(e) => s.notes.push(format!("{key}: {e}")),
        }
    }
    s.found = Ok(cards_only(found, &mut s.notes));
    s
}

/// The graphics cards of the PowerShell run's `Win32_VideoController` lines ([`parse_cim_gpus`]);
/// `ran` says why PowerShell did not answer, when it did not.
pub fn cim_source(values: &[(String, String)], ran: &Result<Ran, String>) -> GpuSource {
    let mut s = GpuSource::new("cim", true);
    match ran {
        Err(e) => s.found = Err(format!("PowerShell: {e}")),
        Ok(r) => {
            s.notes.extend(read_anyway("PowerShell", r));
            s.found = parse_cim_gpus(values).map(|found| cards_only(found, &mut s.notes));
        }
    }
    s
}

/// The graphics cards `wmic` lists (`Win32_VideoController`, when PowerShell could not answer).
pub fn wmic_source(wmic: &Path, run: Runner) -> GpuSource {
    let mut s = GpuSource::new("wmic", true);
    let args = [
        "path",
        "Win32_VideoController",
        "get",
        "AdapterCompatibility,AdapterRAM,Name",
    ];
    match run(wmic, &args, 15) {
        Err(e) => s.found = Err(format!("{}: {e}", wmic.display())),
        Ok(r) => {
            s.notes.extend(read_anyway("wmic", &r));
            s.found = parse_wmic_gpus(&r.stdout)
                .map(|found| cards_only(found, &mut s.notes))
                .map_err(|e| {
                    if r.success() {
                        e
                    } else {
                        format!("{e}, {}", r.exit_text())
                    }
                });
        }
    }
    s
}

/// What the PowerShell run prints, one `key=value` per line: the RAM, the cores, the CPU's name
/// and the video controllers (`gpus=`, `gpu=name|compatibility|AdapterRAM`, or `gpuerror=`).
const POWERSHELL_SCRIPT: &str = "$ErrorActionPreference='SilentlyContinue';\
    $c=Get-CimInstance Win32_ComputerSystem;\
    $m=(Get-CimInstance Win32_PhysicalMemory|Measure-Object -Property Capacity -Sum).Sum;\
    $p=@(Get-CimInstance Win32_Processor);\
    'usable='+$c.TotalPhysicalMemory;'installed='+$m;\
    'cores='+($p|Measure-Object -Property NumberOfCores -Sum).Sum;\
    'threads='+($p|Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum;\
    'cpu='+$p[0].Name;\
    try{$v=@(Get-CimInstance Win32_VideoController -ErrorAction Stop);'gpus='+$v.Count;\
    foreach($g in $v){'gpu='+$g.Name+'|'+$g.AdapterCompatibility+'|'+$g.AdapterRAM}}\
    catch{'gpuerror='+$_.Exception.Message}";

fn detect_windows(hw: &mut Hardware, run: Runner) {
    let reg = process::system32(&["reg.exe"]);
    hw.gpu_sources.push(dxgi_source());
    hw.gpu_sources.push(registry_source(&reg, run));
    match run(&reg, &["query", CPU_KEY, "/v", "ProcessorNameString"], 5) {
        Ok(r) => match r.stdout.lines().find_map(parse_reg_value) {
            Some((_, _, name)) => hw.cpu = name.to_string(),
            None => crate::log!("hardware: no CPU name in the registry ({})", r.exit_text()),
        },
        Err(e) => crate::log!("hardware: no CPU name: {}: {e}", reg.display()),
    }
    let powershell = process::system32(&["WindowsPowerShell", "v1.0", "powershell.exe"]);
    let ran = run(
        &powershell,
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            POWERSHELL_SCRIPT,
        ],
        30,
    );
    let values = ran
        .as_ref()
        .map(|r| parse_key_values(&r.stdout))
        .unwrap_or_default();
    let cim = cim_source(&values, &ran);
    let cim_failed = cim.found.is_err();
    hw.gpu_sources.push(cim);
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
    let wmic = process::system32(&["wbem", "WMIC.exe"]);
    if cim_failed {
        // Systems where PowerShell cannot answer (blocked, older Windows, Wine): wmic.
        hw.gpu_sources.push(wmic_source(&wmic, run));
    }
    if hw.ram_usable.is_none() {
        hw.ram_usable = run(&wmic, &["computersystem", "get", "TotalPhysicalMemory"], 10)
            .ok()
            .and_then(|r| parse_wmic_number(&r.stdout));
    }
    hw.gpus = merge_gpus(&hw.gpu_sources);
}

fn detect_unix(hw: &mut Hardware, run: Runner) {
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
    let mut nvidia = GpuSource::new("nvidia-smi", false);
    nvidia.found = run(
        Path::new("nvidia-smi"),
        &[
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ],
        10,
    )
    .map(|r| {
        nvidia.notes.extend(read_anyway("nvidia-smi", &r));
        parse_nvidia_smi(&r.stdout)
            .into_iter()
            .map(|gpu| Seen { gpu, exact: true })
            .collect()
    });
    let mut drm = GpuSource::new("drm", false);
    drm.found = std::fs::read_dir("/sys/class/drm")
        .map_err(|e| format!("/sys/class/drm: {e}"))
        .map(|dir| {
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
            let nvidia_listed = nvidia.found.as_ref().is_ok_and(|l| !l.is_empty());
            let mut found = Vec::new();
            for card in cards {
                let dev = card.join("device");
                let vendor = read(&dev.join("vendor").to_string_lossy()).unwrap_or_default();
                let vendor_name = pci_vendor(&vendor);
                if vendor_name == "NVIDIA" && nvidia_listed {
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
                found.push(Seen {
                    gpu: Gpu {
                        name,
                        vendor: vendor_name.to_string(),
                        vram_bytes: Some(vram),
                    },
                    exact: true,
                });
            }
            found
        });
    hw.gpu_sources.push(nvidia);
    hw.gpu_sources.push(drm);
    hw.gpus = merge_gpus(&hw.gpu_sources);
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
    let sources = hw.gpu_sources.iter().map(|s| {
        let mut detail: Vec<String> = s.found.as_ref().err().cloned().into_iter().collect();
        detail.extend(s.notes.iter().cloned());
        json::Object::new()
            .str("source", s.name)
            .bool("ok", s.found.is_ok())
            .num("found", s.found.as_ref().map_or(0.0, |l| l.len() as f64))
            .opt_str(
                "detail",
                Some(detail.join("; ")).filter(|d| !d.is_empty()).as_deref(),
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
        .str(
            "gpuDetection",
            if hw.gpu_detection_failed() {
                "failed"
            } else {
                "ok"
            },
        )
        .raw("gpuSources", &json::array(sources))
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

    /// What `reg query <class> /s` prints on a real Windows (in English), up to the `Properties`
    /// subkey that is access denied, where `reg` stops and exits 1.
    const REG: &str = "\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\r\n    Class    REG_SZ    Display\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000\r\n    DriverDesc    REG_SZ    NVIDIA GeForce RTX 3060 Laptop GPU\r\n    ProviderName    REG_SZ    NVIDIA\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x180000000\r\n    HardwareInformation.MemorySize    REG_BINARY    00000080\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000\\Settings\r\n    DriverDesc    REG_SZ    not an adapter\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0001\r\n    DriverDesc    REG_SZ    Intel(R) UHD Graphics\r\n    ProviderName    REG_SZ    Intel Corporation\r\n    HardwareInformation.MemorySize    REG_DWORD    0x8000000\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0002\r\n    DriverDesc    REG_SZ    Microsoft Basic Display Adapter\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0003\r\n    DriverDesc    REG_SZ    AMD Radeon RX 6800\r\n    ProviderName    REG_SZ    Advanced Micro Devices, Inc.\r\n    HardwareInformation.MemorySize    REG_BINARY    00000000\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x400000000\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\Properties\r\nERROR: Access is denied.\r\n";

    /// A key of the display class as `reg` prints it (`sub`: `\0000`, `\Properties`...).
    fn class_key(sub: &str) -> String {
        format!(
            r"HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Class\{{4d36e968-e325-11ce-bfc1-08002be10318}}{sub}"
        )
    }

    #[test]
    fn parses_the_windows_display_class() {
        let adapters = parse_reg_adapters(REG);
        let keys: Vec<&str> = adapters.iter().map(|a| a.key.as_str()).collect();
        assert_eq!(keys, ["0000", "0001", "0002", "0003"], "{adapters:?}");
        let gpu = |i: usize| &adapters[i].seen;
        assert_eq!(gpu(0).gpu.name, "NVIDIA GeForce RTX 3060 Laptop GPU");
        assert_eq!(gpu(0).gpu.vendor, "NVIDIA");
        assert_eq!(
            gpu(0).gpu.vram_bytes,
            Some(6 << 30),
            "the 64-bit value wins"
        );
        assert!(gpu(0).exact);
        assert_eq!(gpu(1).gpu.vendor, "Intel");
        assert_eq!(gpu(1).gpu.vram_bytes, Some(128 << 20));
        assert!(!gpu(1).exact, "a 32-bit value only");
        assert_eq!(gpu(2).gpu.name, "Microsoft Basic Display Adapter");
        assert_eq!(not_a_card(&gpu(2).gpu.name), Some("Microsoft's"));
        assert_eq!(gpu(3).gpu.vendor, "AMD");
        assert_eq!(gpu(3).gpu.vram_bytes, Some(16 << 30));
        assert!(gpu(3).exact);
        // The class's own subkeys, not their subkeys nor Properties.
        assert_eq!(parse_reg_subkeys(REG), ["0000", "0001", "0002", "0003"]);
        assert_eq!(
            parse_reg_number("REG_BINARY", "00000080"),
            Some(0x8000_0000)
        );
        assert_eq!(parse_reg_number("REG_BINARY", "zz"), None);
        assert_eq!(parse_reg_number("REG_QWORD", "(null)"), None);
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

    #[test]
    fn reads_the_registry_around_access_denied_lines_in_any_language() {
        // The listing of the class (no /s): its values, then its subkeys by name. Listing a
        // subkey's name needs no access to it, so Properties is listed and never opened.
        let listing = format!(
            "\r\n{}\r\n    Class    REG_SZ    Display\r\n\r\n{}\r\n{}\r\n{}\r\n{}\r\n",
            class_key(""),
            class_key(r"\0000"),
            class_key(r"\0001"),
            class_key(r"\Configuration"),
            class_key(r"\Properties"),
        );
        assert_eq!(parse_reg_subkeys(&listing), ["0000", "0001"]);
        for denied in ["ERROR: Access is denied.", "ERROR: Acceso denegado."] {
            // An adapter key whose values come after an error line (a key that answered with
            // nothing but the error has no adapter), and the error between two adapters.
            let text = format!(
                "\r\n{}\r\n{denied}\r\n\r\n{}\r\n    DriverDesc    REG_SZ    AMD Radeon RX 7900 XTX\r\n    ProviderName    REG_SZ    Advanced Micro Devices, Inc.\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x600000000\r\n{denied}\r\n\r\n{}\r\n{denied}\r\n",
                class_key(r"\0000"),
                class_key(r"\0001"),
                class_key(r"\Properties"),
            );
            let adapters = parse_reg_adapters(&text);
            assert_eq!(adapters.len(), 1, "{denied}: {adapters:?}");
            assert_eq!(adapters[0].key, "0001");
            assert_eq!(adapters[0].seen.gpu.name, "AMD Radeon RX 7900 XTX");
            assert_eq!(adapters[0].seen.gpu.vram_bytes, Some(24 << 30));
            assert_eq!(parse_reg_value(denied), None);
        }
        // Wine's registry: a 64-bit value with no data, and a zero 32-bit one.
        let wine = format!(
            "\r\n{}\r\n    DriverDesc    REG_SZ    Wine Adapter\r\n    HardwareInformation.MemorySize    REG_DWORD    0x0\r\n    HardwareInformation.qwMemorySize    REG_QWORD    (null)\r\n",
            class_key(r"\0000")
        );
        let a = parse_reg_adapters(&wine);
        assert_eq!(a[0].seen.gpu.name, "Wine Adapter");
        assert_eq!((a[0].seen.gpu.vram_bytes, a[0].seen.exact), (None, false));
    }

    /// A fake `reg` for [`registry_source`]: what it prints for each key, and the exit code of
    /// each query (the arguments of every call are kept).
    struct FakeReg {
        listing: String,
        keys: Vec<(&'static str, String, i32)>,
        calls: std::cell::RefCell<Vec<Vec<String>>>,
    }

    impl FakeReg {
        fn answer(&self, args: &[&str]) -> (String, String, i32) {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|a| a.to_string()).collect());
            let key = args.get(1).copied().unwrap_or("");
            if key == DISPLAY_CLASS {
                return (self.listing.clone(), "ERROR: Acceso denegado.".into(), 1);
            }
            match self
                .keys
                .iter()
                .find(|(k, _, _)| key.ends_with(&format!(r"\{k}")))
            {
                Some((_, text, code)) => (text.clone(), String::new(), *code),
                None => (
                    String::new(),
                    "ERROR: El sistema no pudo encontrar la clave".into(),
                    1,
                ),
            }
        }
    }

    fn fake_reg() -> FakeReg {
        let listing = format!(
            "\r\n{}\r\n    Class    REG_SZ    Display\r\n\r\n{}\r\n{}\r\n{}\r\n{}\r\n{}\r\n",
            class_key(""),
            class_key(r"\0000"),
            class_key(r"\0001"),
            class_key(r"\0002"),
            class_key(r"\0003"),
            class_key(r"\Properties"),
        );
        let key = |k: &str, values: &str| {
            format!(
                "\r\n{}\r\n{values}\r\n\r\n{}\r\n",
                class_key(&format!(r"\{k}")),
                class_key(&format!(r"\{k}\Settings"))
            )
        };
        FakeReg {
            listing,
            keys: vec![
                ("0000", key("0000", "    DriverDesc    REG_SZ    NVIDIA GeForce RTX 3060 Laptop GPU\r\n    ProviderName    REG_SZ    NVIDIA\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x180000000"), 0),
                // One whose query exits 1 after printing it (a subkey it could not open).
                ("0001", key("0001", "    DriverDesc    REG_SZ    Intel(R) UHD Graphics\r\n    ProviderName    REG_SZ    Intel Corporation\r\n    HardwareInformation.MemorySize    REG_DWORD    0x8000000") + "ERROR: Access is denied.\r\n", 1),
                ("0002", key("0002", "    DriverDesc    REG_SZ    Microsoft Basic Display Adapter"), 0),
            ],
            calls: Default::default(),
        }
    }

    fn check_registry(s: &GpuSource, calls: &[Vec<String>]) {
        let found = s.found.as_ref().expect("the registry answered");
        let names: Vec<&str> = found.iter().map(|x| x.gpu.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "NVIDIA GeForce RTX 3060 Laptop GPU",
                "Intel(R) UHD Graphics"
            ],
            "{s:?}"
        );
        assert_eq!(found[0].gpu.vram_bytes, Some(6 << 30));
        let notes = s.notes.join("\n");
        assert!(
            notes.contains("the class: exit 1 (\"ERROR: Acceso denegado.\"), read anyway"),
            "{notes}"
        );
        assert!(notes.contains("0001: exit 1"), "{notes}");
        assert!(
            notes.contains("skipped Microsoft Basic Display Adapter (Microsoft's)"),
            "{notes}"
        );
        assert!(notes.contains("0003: no DriverDesc"), "{notes}");
        // Never /s over the class, never Properties: one listing, then one query per adapter key.
        assert_eq!(calls.len(), 5, "{calls:?}");
        assert!(
            calls.iter().all(|c| c.len() == 2 && c[0] == "query"),
            "{calls:?}"
        );
        assert!(
            calls.iter().all(|c| !c[1].ends_with("Properties")),
            "{calls:?}"
        );
    }

    #[test]
    fn the_registry_is_read_when_reg_exits_non_zero() {
        // v0.1.2 found no graphics card on any Windows: `reg query <class> /s` exits 1 when it
        // meets the access-denied Properties subkey, and its output was thrown away.
        let fake = fake_reg();
        let run = |_: &Path, args: &[&str], _: u64| {
            let (stdout, stderr, code) = fake.answer(args);
            Ok(Ran {
                stdout,
                stderr,
                code: Some(code),
            })
        };
        let s = registry_source(Path::new("reg.exe"), &run);
        check_registry(&s, &fake.calls.borrow());
        // A reg that cannot start: the source failed, and says why.
        let broken = registry_source(Path::new("reg.exe"), &|_: &Path, _: &[&str], _: u64| {
            Err("cannot start it: not found".to_string())
        });
        assert_eq!(
            broken.found,
            Err("reg.exe: cannot start it: not found".into())
        );
    }

    #[test]
    fn the_registry_through_real_programs_that_exit_non_zero() {
        // The same, each answer printed by a real program that then exits 1 (or 0): what
        // process::output_any reads is what the registry source sees.
        let dir = crate::test_dir("hardware-reg");
        let fake = fake_reg();
        let n = std::cell::Cell::new(0);
        let run = |_: &Path, args: &[&str], seconds: u64| {
            let (stdout, stderr, code) = fake.answer(args);
            n.set(n.get() + 1);
            let out = dir.join(format!("out{}.txt", n.get()));
            let err = dir.join(format!("err{}.txt", n.get()));
            std::fs::write(&out, stdout).unwrap();
            std::fs::write(&err, stderr + "\n").unwrap();
            let (o, e) = (out.to_string_lossy(), err.to_string_lossy());
            let cmd = if cfg!(windows) {
                process::command(
                    "cmd",
                    &[
                        "/d",
                        "/c",
                        &format!("type {o}& type {e} 1>&2& exit /b {code}"),
                    ],
                )
            } else {
                process::command(
                    "sh",
                    &["-c", &format!("cat '{o}'; cat '{e}' >&2; exit {code}")],
                )
            };
            process::output_any(cmd, Duration::from_secs(seconds.max(20)))
        };
        let s = registry_source(Path::new("reg.exe"), &run);
        check_registry(&s, &fake.calls.borrow());
    }

    #[test]
    fn reads_the_video_controllers_of_cim_and_wmic() {
        let values = parse_key_values(
            "usable=17069891584\r\ngpus=3\r\ngpu=NVIDIA GeForce RTX 3060 Laptop GPU|NVIDIA|4293918720\r\ngpu=Intel(R) UHD Graphics|Intel Corporation|1073741824\r\ngpu=Microsoft Basic Display Adapter|(Standard display types)|0\r\n",
        );
        let cim = cim_source(
            &values,
            &Ok(Ran {
                stdout: String::new(),
                stderr: String::new(),
                code: Some(0),
            }),
        );
        let found = cim.found.as_ref().unwrap();
        assert_eq!(found.len(), 2, "{cim:?}");
        assert_eq!(
            (
                found[0].gpu.vendor.as_str(),
                found[0].gpu.vram_bytes,
                found[0].exact
            ),
            ("NVIDIA", Some(4_293_918_720), false)
        );
        assert_eq!(found[1].gpu.vendor, "Intel");
        assert!(cim.notes[0].contains("Microsoft Basic Display Adapter"));
        // No GPU at all is an answer; an error or no answer is not.
        let none = parse_key_values("gpus=0\r\n");
        assert_eq!(parse_cim_gpus(&none), Ok(vec![]));
        assert_eq!(
            parse_cim_gpus(&parse_key_values("gpuerror=Invalid class\r\n")),
            Err("Win32_VideoController: Invalid class".into())
        );
        assert!(parse_cim_gpus(&parse_key_values("usable=1\r\n")).is_err());
        let failed = cim_source(&[], &Err("cannot start it: blocked".into()));
        assert_eq!(
            failed.found,
            Err("PowerShell: cannot start it: blocked".into())
        );
        // wmic's table, as Windows prints it into a pipe (\r\r\n) and as Wine does.
        let windows = "AdapterCompatibility          AdapterRAM  Name                                \r\r\nNVIDIA                        4293918720  NVIDIA GeForce RTX 3060 Laptop GPU  \r\r\nIntel Corporation             1073741824  Intel(R) UHD Graphics               \r\r\n\r\r\n";
        let w = parse_wmic_gpus(windows).unwrap();
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].gpu.name, "NVIDIA GeForce RTX 3060 Laptop GPU");
        assert_eq!(
            (w[0].gpu.vendor.as_str(), w[0].gpu.vram_bytes),
            ("NVIDIA", Some(4_293_918_720))
        );
        assert_eq!(
            (w[1].gpu.name.as_str(), w[1].gpu.vendor.as_str()),
            ("Intel(R) UHD Graphics", "Intel")
        );
        let wine = "AdapterCompatibility      AdapterRAM                Name                      \r\n(Standard display types)  536870912                 VideoController1          \r\n";
        let w = parse_wmic_gpus(wine).unwrap();
        assert_eq!(w[0].gpu.name, "VideoController1");
        assert_eq!(w[0].gpu.vram_bytes, Some(512 << 20));
        assert!(parse_wmic_gpus("No Instance(s) Available.\r\n").is_err());
        assert!(parse_wmic_gpus("").is_err());
    }

    fn seen(name: &str, vendor: &str, vram: Option<u64>, exact: bool) -> Seen {
        Seen {
            gpu: Gpu {
                name: name.into(),
                vendor: vendor.into(),
                vram_bytes: vram,
            },
            exact,
        }
    }

    fn source(
        name: &'static str,
        authoritative: bool,
        found: Result<Vec<Seen>, &str>,
    ) -> GpuSource {
        GpuSource {
            name,
            authoritative,
            found: found.map_err(str::to_string),
            notes: Vec::new(),
        }
    }

    #[test]
    fn merges_the_sources_by_adapter() {
        const RTX: &str = "NVIDIA GeForce RTX 3060 Laptop GPU";
        let dxgi = || {
            source(
                "dxgi",
                true,
                Ok(vec![
                    seen(RTX, "NVIDIA", Some(6 << 30), true),
                    seen("Intel(R) UHD Graphics", "Intel", Some(128 << 20), true),
                ]),
            )
        };
        let registry = || {
            source(
                "registry",
                false,
                Ok(vec![
                    seen(RTX, "NVIDIA", Some(6 << 30), true),
                    seen("Intel(R) UHD Graphics", "Intel", Some(128 << 20), false),
                    // The driver key of a card that was taken out.
                    seen("NVIDIA GeForce GTX 970", "NVIDIA", Some(4 << 30), true),
                ]),
            )
        };
        let cim = || {
            source(
                "cim",
                true,
                Ok(vec![
                    seen(RTX, "NVIDIA", Some(4_293_918_720), false),
                    seen("Intel UHD Graphics", "Intel", Some(1 << 30), false),
                ]),
            )
        };
        let failed = |name| source(name, true, Err("failed"));
        // DXGI answered: its adapters, with its exact VRAM; an exact figure beats a larger 32-bit
        // one, and the removed card the registry remembers is not listed.
        let gpus = merge_gpus(&[dxgi(), registry(), cim()]);
        assert_eq!(gpus.len(), 2, "{gpus:?}");
        assert_eq!(
            (gpus[0].name.as_str(), gpus[0].vram_bytes),
            (RTX, Some(6 << 30))
        );
        assert_eq!(gpus[1].vram_bytes, Some(128 << 20));
        // DXGI failed: CIM decides which adapters, the registry gives the exact 6 GiB that CIM's
        // 32-bit figure cannot say.
        let gpus = merge_gpus(&[failed("dxgi"), registry(), cim()]);
        assert_eq!(gpus.len(), 2, "{gpus:?}");
        assert_eq!(
            (gpus[0].name.as_str(), gpus[0].vram_bytes),
            (RTX, Some(6 << 30))
        );
        assert_eq!(
            gpus[1].name, "Intel UHD Graphics",
            "CIM's name, the same adapter"
        );
        assert_eq!(
            gpus[1].vram_bytes,
            Some(1 << 30),
            "no exact figure: the largest 32-bit one"
        );
        // Only the registry answered: what it has, the removed card included (nothing better).
        let gpus = merge_gpus(&[failed("dxgi"), registry(), failed("cim"), failed("wmic")]);
        assert_eq!(gpus.len(), 3);
        // Only CIM: its capped figure.
        let gpus = merge_gpus(&[failed("dxgi"), source("registry", false, Err("x")), cim()]);
        assert_eq!(gpus[0].vram_bytes, Some(4_293_918_720));
        // Two identical cards stay two, each with its VRAM.
        let twin = |exact| seen("NVIDIA GeForce RTX 3090", "NVIDIA", Some(24 << 30), exact);
        let gpus = merge_gpus(&[
            source("dxgi", true, Ok(vec![twin(true), twin(true)])),
            source("registry", false, Ok(vec![twin(true), twin(true)])),
            source("cim", true, Ok(vec![twin(false), twin(false)])),
        ]);
        assert_eq!(gpus.len(), 2);
        assert!(gpus.iter().all(|g| g.vram_bytes == Some(24 << 30)));
        // A vendor the first source did not know comes from another.
        let gpus = merge_gpus(&[
            source("dxgi", true, Ok(vec![seen("Adreno 690", "", None, true)])),
            source(
                "registry",
                false,
                Ok(vec![seen("Adreno 690", "Qualcomm", Some(1 << 30), false)]),
            ),
        ]);
        assert_eq!(
            (gpus[0].vendor.as_str(), gpus[0].vram_bytes),
            ("Qualcomm", Some(1 << 30))
        );
        // DXGI answered with no graphics card (only its software adapter): none, and that is a
        // fact; every source failing is not.
        let none = Hardware {
            gpu_sources: vec![source("dxgi", true, Ok(vec![])), registry()],
            ..Hardware::default()
        };
        assert!(merge_gpus(&none.gpu_sources).is_empty());
        assert!(!none.gpu_detection_failed());
        let unknown = Hardware {
            gpu_sources: vec![failed("dxgi"), failed("registry"), failed("cim")],
            ..Hardware::default()
        };
        assert!(merge_gpus(&unknown.gpu_sources).is_empty());
        assert!(unknown.gpu_detection_failed());
        assert_eq!(
            gpu_key("Intel(R) UHD Graphics 620"),
            gpu_key("intel uhd graphics 620")
        );
        assert_eq!(
            gpu_key("AMD Radeon(TM) Graphics"),
            gpu_key("AMD Radeon Graphics")
        );
        assert_ne!(gpu_key("RTX 3060"), gpu_key("RTX 3060 Ti"));
    }

    #[test]
    fn dxgi_skips_what_is_not_a_graphics_card() {
        use crate::platform::dxgi::{Adapter, ADAPTER_FLAG_SOFTWARE};
        let a = |name: &str, vendor_id, vram, flags| Adapter {
            name: name.into(),
            vendor_id,
            device_id: 0,
            dedicated_video_memory: vram,
            flags,
        };
        let (found, notes) = dxgi_cards(vec![
            a("NVIDIA GeForce RTX 4090", 0x10DE, 24 << 30, 0),
            a("Some GPU", 0x1234, 0, 0),
            a(
                "Microsoft Basic Render Driver",
                0x1414,
                0,
                ADAPTER_FLAG_SOFTWARE,
            ),
        ]);
        let found = found.unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(
            (
                found[0].gpu.vendor.as_str(),
                found[0].gpu.vram_bytes,
                found[0].exact
            ),
            ("NVIDIA", Some(24 << 30), true)
        );
        assert_eq!(
            (found[1].gpu.vendor.as_str(), found[1].gpu.vram_bytes),
            ("PCI 1234", None)
        );
        assert_eq!(notes, ["skipped Microsoft Basic Render Driver (software)"]);
        assert!(dxgi_cards(vec![]).0.is_err());
        assert_eq!(vendor_name(0x1002), "AMD");
        assert_eq!(pci_vendor("0x10de"), "NVIDIA");
        assert_eq!(pci_vendor("nonsense"), "");
    }

    #[test]
    fn the_log_says_which_source_answered() {
        let mut dxgi = source(
            "dxgi",
            true,
            Ok(vec![seen(
                "NVIDIA GeForce RTX 3060",
                "NVIDIA",
                Some(6 << 30),
                true,
            )]),
        );
        dxgi.notes
            .push("skipped Microsoft Basic Render Driver (software)".into());
        assert_eq!(
            source_text(&dxgi),
            "dxgi: NVIDIA GeForce RTX 3060 (NVIDIA, 6.00 GiB); skipped Microsoft Basic Render Driver (software)"
        );
        assert_eq!(
            source_text(&source(
                "cim",
                true,
                Ok(vec![seen("X", "", Some(1 << 30), false)])
            )),
            "cim: X (1.00 GiB, 32-bit figure)"
        );
        assert_eq!(
            source_text(&source("cim", true, Ok(vec![]))),
            "cim: no graphics card"
        );
        assert_eq!(
            source_text(&source("registry", false, Err("reg.exe: cannot start it"))),
            "registry: failed: reg.exe: cannot start it"
        );
        let mut hw = machine(Some(12 << 30), Some(32 << 30));
        hw.gpu_sources = vec![source(
            "dxgi",
            true,
            Ok(vec![seen("Big GPU", "NVIDIA", Some(12 << 30), true)]),
        )];
        let line = summary_text(&hw);
        assert!(
            line.starts_with("Test CPU, 8 cores / 16 threads, 32.0 GiB of RAM; graphics cards: "),
            "{line}"
        );
        assert!(line.contains("Big GPU (NVIDIA, 12.00 GiB)"), "{line}");
        hw.gpu_sources = vec![source("dxgi", true, Err("x"))];
        assert!(summary_text(&hw).ends_with("graphics cards unknown: every source failed"));
    }

    /// The detection itself on this system: it never fails, and each source says what it found or
    /// why not. On Windows (and Wine) the registry answers, and DXGI either lists adapters or says
    /// cleanly why it cannot.
    #[test]
    fn detects_this_computer() {
        let hw = detect();
        assert!(!hw.cpu.is_empty() && hw.threads > 0);
        let names: Vec<&str> = hw.gpu_sources.iter().map(|s| s.name).collect();
        for s in &hw.gpu_sources {
            eprintln!("{}", source_text(s));
        }
        eprintln!("{}", summary_text(&hw));
        if cfg!(windows) {
            assert_eq!(names[..3], ["dxgi", "registry", "cim"]);
            let registry = &hw.gpu_sources[1];
            assert!(registry.found.is_ok(), "{registry:?}");
            if let Err(e) = &hw.gpu_sources[0].found {
                assert!(!e.is_empty());
            }
        } else if std::env::var_os(TEST_GPUS).is_none() {
            assert_eq!(names, ["nvidia-smi", "drm"]);
        }
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
            gpu_sources: Vec::new(),
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

    #[test]
    fn test_gpus_replace_the_detected_ones() {
        assert_eq!(
            parse_test_gpus("Test GPU 12 GB|NVIDIA|12884901888; Small|Intel|"),
            vec![
                Gpu {
                    name: "Test GPU 12 GB".into(),
                    vendor: "NVIDIA".into(),
                    vram_bytes: Some(12_884_901_888),
                },
                Gpu {
                    name: "Small".into(),
                    vendor: "Intel".into(),
                    vram_bytes: None,
                },
            ]
        );
        assert!(parse_test_gpus("").is_empty());
        assert!(parse_test_gpus(" ; |x|1").is_empty());
    }
}
