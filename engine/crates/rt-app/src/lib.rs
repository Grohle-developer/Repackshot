//! `rt-app`: the Repackshot desktop launcher (`repackshot`).
//!
//! A program written with `std` only and no `unsafe`: it serves the interface (Vite's `dist/`,
//! shipped as `app/`) on `127.0.0.1`, opens it in an app window of Edge or Chromium, renders with
//! `rt-core` natively on every thread (`/api/render`), stores AI models in the data folder
//! (`/api/models`, checked with its own SHA-256), detects the hardware for the model
//! recommendation (`/api/hardware`, `repackshot --hardware`) and quits when the window closes.
//! The API contract is in this crate's `README.md`.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod browser;
pub mod cli;
pub mod client;
pub mod hardware;
pub mod http;
pub mod instance;
pub mod json;
pub mod launcher;
pub mod log;
pub mod models;
pub mod paths;
pub mod process;
pub mod recommend;
pub mod render;
pub mod server;
pub mod sha256;
pub mod static_files;
pub mod token;

/// A fresh, empty folder for a test.
#[cfg(test)]
pub(crate) fn test_dir(name: &str) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "rt-app-{name}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("test folder");
    dir
}
