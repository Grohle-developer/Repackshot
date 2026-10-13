//! A normal run: folders, log, single instance, server, window, and the end of the application
//! when the window closes (the browser process exits, or the page's heartbeat stops).

use crate::browser;
use crate::cli::RunOptions;
use crate::instance::{self, Instance};
use crate::log;
use crate::paths::{self, Env, Paths};
use crate::server::{app_version, engine_version, App};
use std::io::Write;
use std::process::Child;
use std::time::{Duration, Instant};

/// Heartbeat silence after which the application ends.
pub const SILENCE: Duration = Duration::from_secs(20);
/// The same at start, while the window opens and the page loads.
pub const START_GRACE: Duration = Duration::from_secs(60);
/// A browser process that exits sooner than this handed the window to a browser already
/// running with the same profile: the heartbeat decides then.
pub const HANDOFF: Duration = Duration::from_secs(5);

/// Runs the application.
pub fn run(opts: RunOptions) -> Result<(), String> {
    let exe_dir = paths::exe_dir()?;
    let paths = paths::resolve(
        &exe_dir,
        opts.data_dir.as_deref(),
        opts.app_dir.as_deref(),
        &Env::current(),
    )?;
    std::fs::create_dir_all(&paths.data_dir)
        .map_err(|e| format!("{}: {e}", paths.data_dir.display()))?;
    if let Err(e) = log::open(&paths.logs()) {
        eprintln!("repackshot: no log file ({e})");
    }
    crate::log!(
        "repackshot {} (engine {}), {} {}; data {}{}; interface {}",
        app_version(),
        engine_version(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        paths.data_dir.display(),
        if paths.portable { " (portable)" } else { "" },
        paths.app_dir.display()
    );
    if !paths.app_dir.join("index.html").is_file() {
        crate::log!("warning: {} has no index.html", paths.app_dir.display());
    }

    if !opts.serve_only {
        if let Some(running) = instance::read(&paths.instance()) {
            if running.pid != std::process::id() && instance::alive(&running) {
                crate::log!(
                    "already running on port {} (pid {}): opening another window",
                    running.port,
                    running.pid
                );
                let (child, _) = open_window(&paths, &running.url());
                // A handed-off browser exits at once; nothing else to wait for.
                if let Some(mut c) = child {
                    std::thread::sleep(Duration::from_millis(200));
                    let _ = c.try_wait();
                }
                return Ok(());
            }
        }
    }

    let token = crate::token::generate();
    // The data folder's own port (port.rs): the window's origin stays the same from launch to launch.
    let mut server = crate::port::start(&paths, opts.port, token.clone(), opts.threads)
        .map_err(|e| format!("cannot listen on 127.0.0.1:{}: {e}", opts.port))?;
    let port = server.port();
    crate::log!(
        "listening on http://127.0.0.1:{port}/ with {} render threads ({})",
        server.app.engine.threads(),
        server.app.engine.isa().name()
    );

    if opts.serve_only {
        println!("{}", server.app.url());
        let _ = std::io::stdout().flush();
        loop {
            std::thread::park();
        }
    }

    let me = Instance {
        port,
        token,
        pid: std::process::id(),
    };
    if let Err(e) = instance::write(&paths.instance(), &me) {
        crate::log!("cannot write instance.json: {e}");
    }
    let (child, name) = open_window(&paths, &server.app.url());
    *server
        .app
        .browser
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = name;
    watch(&server.app, child);
    crate::log!("closing");
    server.stop();
    instance::remove_if_ours(&paths.instance(), me.pid);
    Ok(())
}

/// Opens the app window (or the default browser). Returns the browser process when it is ours
/// to watch, and the browser's name.
fn open_window(paths: &Paths, url: &str) -> (Option<Child>, Option<String>) {
    if let Some(path) = browser::find() {
        match browser::launch_app(&path, url, &paths.browser_profile()) {
            Ok(child) => {
                crate::log!("window: {}", path.display());
                return (Some(child), Some(browser::name_of(&path)));
            }
            Err(e) => crate::log!("cannot start {}: {e}", path.display()),
        }
    }
    match browser::open_default(url) {
        Ok(mut child) => {
            crate::log!("window: the default browser");
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            (None, Some("default".into()))
        }
        Err(e) => {
            crate::log!("cannot open a browser: {e}");
            (None, None)
        }
    }
}

/// Returns when the window is gone.
fn watch(app: &App, mut child: Option<Child>) {
    let started = Instant::now();
    let mut tick = Instant::now();
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let now = Instant::now();
        if now.duration_since(tick) > Duration::from_secs(5) {
            // The computer slept (or this process was stopped): give the page time to beat.
            app.alive();
        }
        tick = now;
        if let Some(c) = child.as_mut() {
            if let Ok(Some(status)) = c.try_wait() {
                if started.elapsed() > HANDOFF {
                    crate::log!("the window closed ({status})");
                    return;
                }
                crate::log!(
                    "the browser handed the window over ({status}); following the heartbeat"
                );
                child = None;
            }
        }
        let limit = if started.elapsed() < START_GRACE {
            START_GRACE
        } else {
            SILENCE
        };
        if app.silence() > limit {
            crate::log!("no heartbeat for {} s", app.silence().as_secs());
            return;
        }
    }
}
