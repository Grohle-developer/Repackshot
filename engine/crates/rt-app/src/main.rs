//! `repackshot`: the Repackshot desktop application. See `repackshot --help`.

// The Windows release build has no console window; its messages go to <data>/logs/repackshot.log.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use rt_app::cli::{parse, Command, USAGE};
use rt_app::{hardware, launcher, recommend, server};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let command = match parse(&args) {
        Ok(c) => c,
        Err(message) => {
            eprintln!("repackshot: {message}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let result = match command {
        Command::Help => {
            print!("{USAGE}");
            Ok(())
        }
        Command::Version => {
            println!(
                "repackshot {} (engine {})",
                server::app_version(),
                server::engine_version()
            );
            Ok(())
        }
        Command::Hardware { out, device } => {
            let hw = hardware::detect();
            let catalogue = recommend::catalogue();
            let a = hardware::assess(&hw, device, catalogue);
            let ini = hardware::to_ini(&hw, &a, catalogue);
            std::fs::write(&out, hardware::utf16le(&ini))
                .map_err(|e| format!("{}: {e}", out.display()))
        }
        Command::ShortcutId(lnk) => rt_app::platform::shortcut::set_app_user_model_id(&lnk),
        Command::Run(opts) => launcher::run(opts),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            rt_app::log::line(&format!("error: {message}"));
            ExitCode::FAILURE
        }
    }
}
