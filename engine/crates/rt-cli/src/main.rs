//! The `rt` command. See `rt --help`.

use rt_cli::cli::{parse_args, run, Command, USAGE};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match parse_args(&args) {
        Ok(command) => command,
        Err(message) => {
            eprintln!("rt: {message}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    if command == Command::Help {
        print!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    match run(command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("rt: {message}");
            ExitCode::FAILURE
        }
    }
}
