//! The installer's AI models page (`packaging/windows/models-page.nsh`, phases P2 and U10) against
//! the launcher. NSIS cannot run here (nor under Wine), so the script is read as text: what it
//! reads from `hw.ini` must be what `repackshot --hardware` writes, and the line it writes to
//! `pending-models.json` must be what the launcher reads back, with the inference runtime in it
//! when the person left the box ticked.

use rt_app::ai::catalogue::runtime_catalogue;
use rt_app::hardware::{assess, runtime_offer, to_ini, Device, Gpu, Hardware};
use rt_app::json;
use rt_app::models::{load_pending, read_pending};
use std::collections::BTreeSet;

const PAGE: &str = include_str!("../../../../packaging/windows/models-page.nsh");

fn machine(vram_gib: u64) -> Hardware {
    Hardware {
        cpu: "Test CPU".into(),
        cores: 8,
        threads: 16,
        ram_installed: Some(32 << 30),
        ram_usable: Some(31 << 30),
        gpus: vec![Gpu {
            name: "Test GPU".into(),
            vendor: "NVIDIA".into(),
            vram_bytes: Some(vram_gib << 30),
        }],
        gpu_sources: Vec::new(),
    }
}

/// The INI as the launcher writes it for the installer.
fn ini(hw: &Hardware, forced: Option<Device>) -> String {
    let models = rt_app::recommend::catalogue();
    let runtime = runtime_offer(hw, forced, runtime_catalogue(), "windows", "x86_64");
    to_ini(hw, &assess(hw, forced, models), models, runtime.as_ref())
}

/// Every `ReadINIStr $var "${HW}" "section" "key"` of the script, as (section, key); the
/// per-model section `model$R0` is read as `model0`.
fn reads() -> BTreeSet<(String, String)> {
    PAGE.lines()
        .filter(|l| l.contains("ReadINIStr") && l.contains("${HW}"))
        .map(|l| {
            let quoted: Vec<&str> = l.split('"').skip(1).step_by(2).collect();
            // ["${HW}", section, key]
            assert_eq!(quoted.len(), 3, "{l}");
            assert_eq!(quoted[0], "${HW}", "{l}");
            (quoted[1].replace("$R0", "0"), quoted[2].to_string())
        })
        .collect()
}

fn has(ini: &str, section: &str, key: &str) -> bool {
    let mut inside = false;
    for line in ini.lines() {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            inside = name == section;
        } else if inside && line.split('=').next() == Some(key) {
            return true;
        }
    }
    false
}

fn value(ini: &str, section: &str, key: &str) -> String {
    let mut inside = false;
    for line in ini.lines() {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            inside = name == section;
        } else if inside {
            if let Some((k, v)) = line.split_once('=') {
                if k == key {
                    return v.to_string();
                }
            }
        }
    }
    panic!("no {key} in [{section}]");
}

#[test]
fn everything_the_page_reads_is_in_the_ini_the_launcher_writes() {
    let reads = reads();
    // The page reads the runtime (phase U10) as well as the computer and the models.
    for key in ["available", "key", "backend", "size_mib"] {
        assert!(
            reads.contains(&("runtime".into(), key.into())),
            "the page does not read [runtime] {key}"
        );
    }
    assert!(reads.len() > 15, "{reads:?}");
    for (hw, forced) in [
        (machine(12), None),
        (machine(12), Some(Device::Cpu)),
        (machine(2), None),
        (Hardware::default(), None),
    ] {
        let text = ini(&hw, forced);
        for (section, key) in &reads {
            assert!(
                has(&text, section, key),
                "[{section}] {key} is not in:\n{text}"
            );
        }
    }
}

/// The line `FileWrite` puts in `pending-models.json`, with the variables of the script
/// filled in the way the script fills them.
fn pending_line(device: &str, keys: &str, runtime_tail: &str) -> String {
    let line = PAGE
        .lines()
        .find(|l| l.contains("FileWrite $0") && l.contains("\"device\""))
        .expect("the page writes pending-models.json");
    let template = line.split('\'').nth(1).expect("the line is single-quoted");
    template
        .replace("$6", device)
        .replace("$5", keys)
        .replace("$9", runtime_tail)
        .replace("$\\r$\\n", "\r\n")
}

/// What `StrCpy $9 '...'` puts in the variable that carries the runtime, for a key.
fn runtime_tail(key: &str) -> String {
    let line = PAGE
        .lines()
        .find(|l| l.contains("StrCpy $9 '"))
        .expect("the page builds the runtime member");
    line.split('\'').nth(1).unwrap().replace("$RtKey", key)
}

#[test]
fn the_line_the_page_writes_is_the_choice_the_launcher_reads() {
    let dir = std::env::temp_dir().join(format!("rt-app-installer-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("pending-models.json");
    let read = |text: String| {
        std::fs::write(&path, text).unwrap();
        (read_pending(&path), load_pending(&path))
    };

    // Models chosen and the runtime ticked.
    let (page, loaded) = read(pending_line(
        "gpu",
        "\"ZIMAGE_Q8\", \"SD15_LIGHT\"",
        &runtime_tail("SDCPP_WIN_VULKAN"),
    ));
    assert_eq!(
        page.as_deref(),
        Some(r#"{"device":"gpu","keys":["ZIMAGE_Q8","SD15_LIGHT"],"runtime":"SDCPP_WIN_VULKAN"}"#)
    );
    assert_eq!(loaded.unwrap().runtime.as_deref(), Some("SDCPP_WIN_VULKAN"));

    // The runtime unticked: the member is not there at all.
    let (page, loaded) = read(pending_line("cpu", "\"SD15_LIGHT\"", ""));
    assert_eq!(
        page.as_deref(),
        Some(r#"{"device":"cpu","keys":["SD15_LIGHT"]}"#)
    );
    assert_eq!(loaded.unwrap().runtime, None);

    // No model: an empty list, as before.
    let (page, _) = read(pending_line("cpu", "", ""));
    assert_eq!(page.as_deref(), Some(r#"{"device":"cpu","keys":[]}"#));

    // Every runtime key the catalogue offers survives the trip.
    for rt in &runtime_catalogue().runtimes {
        let (_, loaded) = read(pending_line("gpu", "\"ZIMAGE_Q8\"", &runtime_tail(&rt.key)));
        assert_eq!(loaded.unwrap().runtime.as_deref(), Some(rt.key.as_str()));
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_page_writes_the_runtime_only_with_models_and_a_ticked_box() {
    let leave = PAGE
        .split("Function ModelsLeave")
        .nth(1)
        .expect("ModelsLeave")
        .split("FunctionEnd")
        .next()
        .unwrap();
    // It starts with no runtime, then asks for models, then for the ticked box, and only then sets it.
    let at = |needle: &str, from: usize| {
        from + leave[from..]
            .find(needle)
            .unwrap_or_else(|| panic!("`{needle}` is not in ModelsLeave after {from}:\n{leave}"))
    };
    let none = at("StrCpy $9 \"\"", 0);
    let models = at("${If} $5 != \"\"", none);
    let ticked = at("${If} $1 == ${BST_CHECKED}", models);
    let set = at("StrCpy $9 ', \"runtime\"", ticked);
    assert!(none < models && models < ticked && ticked < set);
    // And it is the line written that carries it.
    let line = pending_line("gpu", "\"ZIMAGE_Q8\"", &runtime_tail("SDCPP_WIN_VULKAN"));
    let v = json::parse(line.trim()).unwrap();
    assert_eq!(v.get("runtime").unwrap().as_str(), Some("SDCPP_WIN_VULKAN"));
}

#[test]
fn the_runtime_the_page_offers_follows_the_device_it_detects() {
    // The text of the box comes from the INI: Vulkan beside a usable card, the CPU build beside none
    // or when the processor is asked for; the same key the application's own rule would pick.
    let card = ini(&machine(12), None);
    assert_eq!(value(&card, "runtime", "key"), "SDCPP_WIN_VULKAN");
    assert_eq!(value(&card, "runtime", "backend"), "VULKAN");
    assert_eq!(value(&card, "runtime", "available"), "1");
    let cpu = ini(&machine(12), Some(Device::Cpu));
    assert_eq!(value(&cpu, "runtime", "key"), "SDCPP_WIN_CPU");
    let none = ini(&Hardware::default(), None);
    assert_eq!(value(&none, "runtime", "key"), "SDCPP_WIN_CPU");
}

// ------------------------------------------------------------------ updating from inside the application (P5)

const INSTALLER: &str = include_str!("../../../../packaging/windows/installer.nsi");

/// The lines of the script's `Function <name>` … `FunctionEnd`.
fn function<'a>(script: &'a str, name: &str) -> &'a str {
    script
        .split(&format!("Function {name}"))
        .nth(1)
        .unwrap_or_else(|| panic!("no Function {name}"))
        .split("FunctionEnd")
        .next()
        .unwrap()
}

/// The text of `CHECK_NOT_RUNNING`, which both the installer and the uninstaller use.
fn not_running() -> &'static str {
    INSTALLER
        .split("!macro CHECK_NOT_RUNNING PREFIX")
        .nth(1)
        .expect("the macro")
        .split("!macroend")
        .next()
        .unwrap()
}

fn at(text: &str, needle: &str, from: usize) -> usize {
    from + text[from..]
        .find(needle)
        .unwrap_or_else(|| panic!("`{needle}` is not there after {from}:\n{text}"))
}

#[test]
fn a_silent_install_waits_up_to_thirty_seconds_for_the_program_to_be_free() {
    // The application that runs `setup.exe /S /LAUNCH` is still closing: the installer opens
    // `repackshot.exe` for writing (a running program cannot be) and sleeps, until it can.
    let m = not_running();
    let exists = at(m, "IfFileExists \"$INSTDIR\\repackshot.exe\"", 0);
    let open = at(m, "FileOpen $0 \"$INSTDIR\\repackshot.exe\" a", exists);
    let silent = at(m, "IfSilent 0 ask", open);
    let count = at(m, "IntOp $1 $1 + 1", silent);
    let limit = at(m, "IntCmp $1 ", count);
    let sleep = at(m, "Sleep ", limit);
    let back = at(m, "Goto retry", sleep);
    let ask = at(m, "ask:\n", back);
    let ask_box = at(m, "MessageBox MB_RETRYCANCEL", ask);
    assert!(exists < open && open < silent && silent < count && count < limit && limit < sleep);
    assert!(sleep < back && back < ask && ask < ask_box);
    // 60 turns of half a second: 30 seconds, and then it asks (a silent run answers Cancel).
    let number = |from: usize, prefix: &str| -> u32 {
        let start = from + prefix.len();
        m[start..]
            .split_whitespace()
            .next()
            .unwrap()
            .parse()
            .unwrap_or_else(|_| panic!("a number after `{prefix}`"))
    };
    let turns = number(limit, "IntCmp $1 ");
    let ms = number(sleep, "Sleep ");
    assert_eq!(turns * ms, 30_000, "{turns} turns of {ms} ms");
    assert!(m.contains("/SD IDCANCEL"));
    // Nothing in the script opens the file for truncating (`w`): that would empty a free program.
    assert!(!m.contains("repackshot.exe\" w"));
    // The file it waits for is the one it installs.
    assert!(INSTALLER.contains("File \"${STAGE}/repackshot.exe\""));
    // The uninstaller is built from the same macro.
    assert!(INSTALLER.contains("!insertmacro CHECK_NOT_RUNNING \"un.\""));
    // And a person running the installer by hand is asked at once, not after half a minute: the
    // wait is behind IfSilent, whose "not silent" branch is the question.
    assert!(m.contains("IfSilent 0 ask"));
}

#[test]
fn launch_starts_the_application_when_the_installation_is_done_silently_too() {
    // The launcher runs the installer with these (src/update/mod.rs).
    assert_eq!(rt_app::update::INSTALLER_ARGS, ["/S", "/LAUNCH"]);
    let f = function(INSTALLER, ".onInstSuccess");
    let params = at(f, "${GetParameters} $R0", 0);
    let option = at(f, "${GetOptions} $R0 \"/LAUNCH\" $R1", params);
    let absent = at(f, "IfErrors done", option);
    let start = at(f, "Exec '\"$INSTDIR\\repackshot.exe\"'", absent);
    assert!(params < option && option < absent && absent < start);
    // The option is read with FileFunc's macros, which have to be inserted once.
    assert!(INSTALLER.contains("!insertmacro GetParameters"));
    assert!(INSTALLER.contains("!insertmacro GetOptions"));
    // `.onInstSuccess` runs for a silent install too (the finish page, which has the same
    // "Open Repackshot", does not).
    assert!(INSTALLER.contains("!define MUI_FINISHPAGE_RUN \"$INSTDIR\\repackshot.exe\""));
}

#[test]
fn a_silent_run_changes_nothing_the_person_chose() {
    // The models page neither shows nor writes pending-models.json in a silent run.
    let page = function(PAGE, "ModelsPage");
    assert!(
        page.trim_start().starts_with("; A silent run") && page.contains("IfSilent 0 +2\n  Abort"),
        "{page}"
    );
    let leave = function(PAGE, "ModelsLeave");
    assert!(
        leave.trim_start().starts_with("IfSilent 0 +2\n  Return"),
        "{leave}"
    );
    // The desktop shortcut is renewed when it is there, not brought back.
    let at_desktop = INSTALLER
        .find("Section \"$(SecDesktop)\" SecDesktop")
        .unwrap();
    let section =
        &INSTALLER[at_desktop..INSTALLER[at_desktop..].find("SectionEnd").unwrap() + at_desktop];
    let silent = at(section, "IfSilent 0 create", 0);
    let exists = at(
        section,
        "IfFileExists \"$DESKTOP\\Repackshot.lnk\" create done",
        silent,
    );
    let create = at(section, "create:\n", exists);
    let link = at(section, "CreateShortCut", create);
    assert!(silent < exists && exists < create && create < link);
}

#[test]
fn what_the_launcher_calls_an_installed_copy_is_what_the_installer_writes() {
    // `Mode::of` tells an installed copy by the uninstaller beside the program.
    assert_eq!(rt_app::update::UNINSTALLER, "uninstall.exe");
    assert!(INSTALLER.contains("WriteUninstaller \"$INSTDIR\\uninstall.exe\""));
    // It installs into the folder the registry remembers, so a silent run lands on the same copy.
    assert!(INSTALLER.contains("InstallDirRegKey HKCU \"${APP_KEY}\" \"InstallDir\""));
    // Per user: no administrator rights, so the application can run it without asking for them.
    assert!(INSTALLER.contains("RequestExecutionLevel user"));
}
