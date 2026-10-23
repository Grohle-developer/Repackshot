//! The command line of `repackshot`.

use crate::hardware::Device;
use crate::platform::WindowChoice;
use std::path::PathBuf;

/// `repackshot --help`.
pub const USAGE: &str = "\
repackshot: the Repackshot desktop application

USAGE:
    repackshot [--port N] [--data-dir DIR] [--app-dir DIR] [--threads N] [--window KIND]
               [--after-update] [PROJECT.repack]
    repackshot --serve-only [--port N] [--data-dir DIR] [--app-dir DIR] [--threads N]
    repackshot --hardware <file.ini> [--device gpu|cpu]
    repackshot --shortcut-id <file.lnk>
    repackshot --version | --help

Serves the interface on 127.0.0.1 and opens it in its own window (Windows, with the WebView2
runtime) or else in an app window of Edge (Windows) or of a Chromium-family browser (Linux;
REPACKSHOT_BROWSER names another), renders with the native engine on every thread, and quits
when the window closes.

OPTIONS:
        --port <N>          port to listen on (default: a free one)
        --data-dir <DIR>    data folder (default: %LOCALAPPDATA%\\Repackshot, or
                            $XDG_DATA_HOME/repackshot, or data/ next to the program when
                            portable.txt is there)
        --app-dir <DIR>     the interface folder (default: app/ next to the program)
        --threads <N>       render threads (default: all)
        --window <KIND>     webview2: only the program's own window (fail without WebView2);
                            browser: the browser's app window; auto (default): the first,
                            else the second. Also --window=KIND
        --after-update      the previous version started this one to finish an update
                            (the application passes it by itself; it only says so in the log)
        PROJECT.repack      a project file to open at startup (a double-click in the file
                            manager passes it here; anything else is an unknown argument)
        --serve-only        no window: print the URL (with its token) and serve until stopped
        --hardware <file>   detect the computer, apply the AI model recommendation and write
                            an INI file (UTF-16) for the installer, then exit
        --device <gpu|cpu>  with --hardware: recommend for this device instead of the
                            detected one
        --shortcut-id <lnk> Windows: give a shortcut to repackshot.exe the program's
                            AppUserModelID (the installer runs it), then exit
        --version           print the version
    -h, --help              show this help
";

/// Options of a normal run.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RunOptions {
    /// Port (0: any free one).
    pub port: u16,
    /// `--data-dir`.
    pub data_dir: Option<PathBuf>,
    /// `--app-dir`.
    pub app_dir: Option<PathBuf>,
    /// Render threads (0: all).
    pub threads: usize,
    /// No window.
    pub serve_only: bool,
    /// Which window (`--window`).
    pub window: WindowChoice,
    /// `--after-update`: the previous version started this one to finish an update.
    pub after_update: bool,
    /// A project file passed on the command line (`.repack` or `.repack.json`), to open at startup.
    pub open_file: Option<PathBuf>,
}

/// A parsed command line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    /// Show the usage.
    Help,
    /// Show the version.
    Version,
    /// Write the hardware INI.
    Hardware {
        /// The INI file.
        out: PathBuf,
        /// Forced device.
        device: Option<Device>,
    },
    /// Write the AppUserModelID into a shortcut (`--shortcut-id`).
    ShortcutId(PathBuf),
    /// Serve (and open the window).
    Run(RunOptions),
}

/// Parses the arguments after the program name.
pub fn parse(args: &[String]) -> Result<Command, String> {
    let mut opts = RunOptions::default();
    let mut hardware = None;
    let mut device = None;
    let mut shortcut = None;
    let mut it = args.iter();
    let value = |it: &mut std::slice::Iter<'_, String>, flag: &str| {
        it.next()
            .cloned()
            .ok_or_else(|| format!("{flag} needs a value"))
    };
    let window = |v: &str| {
        WindowChoice::parse(v)
            .ok_or_else(|| format!("--window expects webview2, browser or auto, got '{v}'"))
    };
    while let Some(arg) = it.next() {
        if let Some(v) = arg.strip_prefix("--window=") {
            opts.window = window(v)?;
            continue;
        }
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--version" | "-V" => return Ok(Command::Version),
            "--serve-only" => opts.serve_only = true,
            "--after-update" => opts.after_update = true,
            "--port" => {
                let v = value(&mut it, arg)?;
                opts.port = v
                    .parse()
                    .map_err(|_| format!("--port expects a port number, got '{v}'"))?;
            }
            "--threads" => {
                let v = value(&mut it, arg)?;
                opts.threads = match v.parse::<usize>() {
                    Ok(n) if n > 0 => n,
                    _ => return Err(format!("--threads expects a positive number, got '{v}'")),
                };
            }
            "--window" => opts.window = window(&value(&mut it, arg)?)?,
            "--data-dir" => opts.data_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--app-dir" => opts.app_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--hardware" => hardware = Some(PathBuf::from(value(&mut it, arg)?)),
            "--shortcut-id" => shortcut = Some(PathBuf::from(value(&mut it, arg)?)),
            "--device" => {
                let v = value(&mut it, arg)?;
                device = Some(
                    Device::parse(&v)
                        .ok_or_else(|| format!("--device expects gpu or cpu, got '{v}'"))?,
                );
            }
            other => {
                // A lone project file (a double-click in the file manager): opened at startup.
                // Anything else that is not a flag is still an unknown argument.
                if other.starts_with('-') {
                    return Err(format!("unknown argument '{other}'"));
                }
                let lower = other.to_lowercase();
                if !lower.ends_with(".repack") && !lower.ends_with(".repack.json") {
                    return Err(format!("unknown argument '{other}'"));
                }
                if opts.open_file.is_some() {
                    return Err("only one project file can be opened".into());
                }
                opts.open_file = Some(PathBuf::from(other));
            }
        }
    }
    if let Some(lnk) = shortcut {
        if opts != RunOptions::default() || hardware.is_some() || device.is_some() {
            return Err("--shortcut-id takes no other option".into());
        }
        return Ok(Command::ShortcutId(lnk));
    }
    if let Some(out) = hardware {
        if opts != RunOptions::default() {
            return Err("--hardware takes no other option than --device".into());
        }
        return Ok(Command::Hardware { out, device });
    }
    if device.is_some() {
        return Err("--device goes with --hardware".into());
    }
    Ok(Command::Run(opts))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str]) -> Result<Command, String> {
        parse(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_the_command_line() {
        assert_eq!(p(&[]), Ok(Command::Run(RunOptions::default())));
        assert_eq!(
            p(&[
                "--serve-only",
                "--port",
                "8123",
                "--data-dir",
                "d",
                "--threads",
                "3"
            ]),
            Ok(Command::Run(RunOptions {
                port: 8123,
                data_dir: Some("d".into()),
                app_dir: None,
                threads: 3,
                serve_only: true,
                window: WindowChoice::Auto,
                after_update: false,
                open_file: None,
            }))
        );
        assert_eq!(
            p(&["--after-update", "--port", "8123"]),
            Ok(Command::Run(RunOptions {
                port: 8123,
                after_update: true,
                ..RunOptions::default()
            }))
        );
        for (args, choice) in [
            (&["--window=webview2"][..], WindowChoice::WebView2),
            (&["--window", "browser"], WindowChoice::Browser),
            (&["--window=auto"], WindowChoice::Auto),
        ] {
            assert_eq!(
                p(args),
                Ok(Command::Run(RunOptions {
                    window: choice,
                    ..RunOptions::default()
                }))
            );
        }
        assert_eq!(
            p(&["--hardware", "hw.ini", "--device", "cpu"]),
            Ok(Command::Hardware {
                out: "hw.ini".into(),
                device: Some(Device::Cpu)
            })
        );
        assert_eq!(p(&["--version"]), Ok(Command::Version));
        assert_eq!(
            p(&["--shortcut-id", r"C:\Users\a\Desktop\Repackshot.lnk"]),
            Ok(Command::ShortcutId(
                r"C:\Users\a\Desktop\Repackshot.lnk".into()
            ))
        );
        assert_eq!(p(&["-h"]), Ok(Command::Help));
        for bad in [
            &["--port"][..],
            &["--port", "99999"],
            &["--threads", "0"],
            &["--device", "tpu", "--hardware", "x"],
            &["--device", "gpu"],
            &["--hardware", "x", "--serve-only"],
            &["--bogus"],
            &["file"],
            &["file.txt"],
            &["a.repack", "b.repack"],
            &["--window=edge"],
            &["--window"],
            &["--window", "x"],
            &["--shortcut-id"],
            &["--shortcut-id", "a.lnk", "--port", "1"],
            &["--shortcut-id", "a.lnk", "--hardware", "x"],
            &["--hardware", "x", "--window=browser"],
            &["--hardware", "x", "--after-update"],
            &["--after-update=1"],
        ] {
            assert!(p(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_project_file_on_the_command_line_opens_at_startup() {
        for (args, want) in [
            (&["bottle.repack"][..], "bottle.repack"),
            (&["old.repack.json"][..], "old.repack.json"),
            (
                &[r"C:\Users\a\Bottle.REPACK"][..],
                r"C:\Users\a\Bottle.REPACK",
            ),
            (&["--port", "8123", "bottle.repack"][..], "bottle.repack"),
        ] {
            assert_eq!(
                p(args),
                Ok(Command::Run(RunOptions {
                    port: if args.contains(&"--port") { 8123 } else { 0 },
                    open_file: Some(want.into()),
                    ..RunOptions::default()
                })),
                "{args:?}"
            );
        }
    }
}
