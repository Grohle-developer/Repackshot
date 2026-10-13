// A stand-in for powershell.exe in the Wine check of the launcher's dialogs (packaging/wine-dialogs.mjs): it logs its
// switches, the decoded -EncodedCommand and the RPX_* inputs to FAKE_PS_LOG, then answers the path in the file
// FAKE_PS_ANSWER_FILE the way the real script does (`PATH <base64 of UTF-8>`), or `CANCEL` when it is empty.
// A test tool, never shipped: compiled by the check with rustc for x86_64-pc-windows-gnu.
use std::io::Write;
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
fn dec(t: &str) -> Vec<u8> {
    let t = t.trim_end_matches('=');
    let (mut acc, mut bits, mut out) = (0u32, 0u32, Vec::new());
    for b in t.bytes() {
        let v = B64.iter().position(|&c| c == b).unwrap() as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    out
}
fn enc(b: &[u8]) -> String {
    let mut o = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                o.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char)
            } else {
                o.push('=')
            }
        }
    }
    o
}
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let log = std::env::var("FAKE_PS_LOG").unwrap_or_else(|_| "C:\\fakeps.log".into());
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
        .unwrap();
    writeln!(f, "--- call").unwrap();
    for a in &args[..args.len().saturating_sub(1)] {
        writeln!(f, "arg {a}").unwrap();
    }
    let script: Vec<u16> = dec(args.last().unwrap())
        .chunks(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let script = String::from_utf16(&script).unwrap();
    writeln!(f, "script-starts {}", script.lines().next().unwrap_or("")).unwrap();
    writeln!(
        f,
        "script-has-folder-picker {}",
        script.contains("FOS") || script.contains("0x20u")
    )
    .unwrap();
    for k in [
        "RPX_KIND",
        "RPX_TITLE",
        "RPX_FILTER",
        "RPX_MULTI",
        "RPX_NAME",
        "RPX_EXT",
        "RPX_START",
        "RPX_FOLDER_ITEM",
        "RPX_OWNER",
        "RPX_CACHE",
    ] {
        writeln!(f, "env {k}={}", std::env::var(k).unwrap_or_default()).unwrap();
    }
    let answer = std::env::var("FAKE_PS_ANSWER_FILE")
        .ok()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .unwrap_or_default();
    let answer = answer.trim();
    if answer.is_empty() {
        println!("CANCEL")
    } else {
        println!("PATH {}", enc(answer.as_bytes()))
    }
}
