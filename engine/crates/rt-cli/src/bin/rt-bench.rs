//! The `rt-bench` command: ray throughput of the BVH. See `rt-bench --help`.

use rt_cli::bench::{parse_args, run, USAGE};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match parse_args(&args) {
        Ok(Some(options)) => {
            print!("{}", run(&options));
            ExitCode::SUCCESS
        }
        Ok(None) => {
            print!("{USAGE}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("rt-bench: {message}\n\n{USAGE}");
            ExitCode::from(2)
        }
    }
}
