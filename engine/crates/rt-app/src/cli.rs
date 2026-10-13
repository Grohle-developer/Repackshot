//! The command line of `repackshot`.

use crate::hardware::Device;
use std::path::PathBuf;

/// `repackshot --help`.
pub const USAGE: &str = "\
repackshot: the Repackshot desktop application

USAGE:
    repackshot [--port N] [--data-dir DIR] [--app-dir DIR] [--threads N]
    repackshot --serve-only [--port N] [--data-dir DIR] [--app-dir DIR] [--threads N]
    repackshot --hardware <file.ini> [--device gpu|cpu]
    repackshot --version | --help

Serves the interface on 127.0.0.1 and opens it in an app window of Edge (Windows) or of a
Chromium-family browser (Linux; REPACKSHOT_BROWSER names another), renders with the native engine
on every thread, and quits when the window closes.

OPTIONS:
        --port <N>          port to listen on (default: a free one)
        --data-dir <DIR>    data folder (default: %LOCALAPPDATA%\\Repackshot, or
                            $XDG_DATA_HOME/repackshot, or data/ next to the program when
                            portable.txt is there)
        --app-dir <DIR>     the interface folder (default: app/ next to the program)
        --threads <N>       render threads (default: all)
        --serve-only        no window: print the URL (with its token) and serve until stopped
        --hardware <file>   detect the computer, apply the AI model recommendation and write
                            an INI file (UTF-16) for the installer, then exit
        --device <gpu|cpu>  with --hardware: recommend for this device instead of the
                            detected one
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
    /// Serve (and open the window).
    Run(RunOptions),
}

/// Parses the arguments after the program name.
pub fn parse(args: &[String]) -> Result<Command, String> {
    let mut opts = RunOptions::default();
    let mut hardware = None;
    let mut device = None;
    let mut it = args.iter();
    let value = |it: &mut std::slice::Iter<'_, String>, flag: &str| {
        it.next()
            .cloned()
            .ok_or_else(|| format!("{flag} needs a value"))
    };
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--version" | "-V" => return Ok(Command::Version),
            "--serve-only" => opts.serve_only = true,
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
            "--data-dir" => opts.data_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--app-dir" => opts.app_dir = Some(PathBuf::from(value(&mut it, arg)?)),
            "--hardware" => hardware = Some(PathBuf::from(value(&mut it, arg)?)),
            "--device" => {
                let v = value(&mut it, arg)?;
                device = Some(
                    Device::parse(&v)
                        .ok_or_else(|| format!("--device expects gpu or cpu, got '{v}'"))?,
                );
            }
            other => return Err(format!("unknown argument '{other}'")),
        }
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
            }))
        );
        assert_eq!(
            p(&["--hardware", "hw.ini", "--device", "cpu"]),
            Ok(Command::Hardware {
                out: "hw.ini".into(),
                device: Some(Device::Cpu)
            })
        );
        assert_eq!(p(&["--version"]), Ok(Command::Version));
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
        ] {
            assert!(p(bad).is_err(), "{bad:?}");
        }
    }
}
