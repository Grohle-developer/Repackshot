//! The port is stable per data folder (phase P3e): a second start uses the same port when it is free;
//! a busy port gives a new one, which is then the one used; `--port` is used and not remembered.

mod common;

use common::{temp_dir, TOKEN};
use rt_app::paths::Paths;
use rt_app::port;
use std::net::TcpListener;

fn paths(name: &str) -> Paths {
    let dir = temp_dir(name);
    std::fs::create_dir_all(dir.join("app")).unwrap();
    Paths {
        exe_dir: dir.clone(),
        app_dir: dir.join("app"),
        data_dir: dir.join("data"),
        portable: false,
    }
}

#[test]
fn a_second_start_uses_the_same_port_and_a_busy_one_is_replaced_once() {
    let p = paths("port-stable");
    let first = port::start(&p, 0, TOKEN.into(), 1, None).unwrap();
    let a = first.port();
    assert_eq!(port::remembered(&port::file(&p)), Some(a));
    drop(first);

    // Free again: the same port, the same origin for the window.
    let second = port::start(&p, 0, TOKEN.into(), 1, None).unwrap();
    assert_eq!(second.port(), a);
    drop(second);

    // Taken by something else: another port, remembered from then on.
    let blocker = TcpListener::bind(("127.0.0.1", a)).unwrap();
    let third = port::start(&p, 0, TOKEN.into(), 1, None).unwrap();
    let b = third.port();
    assert_ne!(b, a);
    assert_eq!(port::remembered(&port::file(&p)), Some(b));
    drop(third);
    drop(blocker);
    let fourth = port::start(&p, 0, TOKEN.into(), 1, None).unwrap();
    assert_eq!(fourth.port(), b);
    drop(fourth);

    // `--port N`: N, and the remembered one stays.
    let free = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let n = free.local_addr().unwrap().port();
    drop(free);
    let forced = port::start(&p, n, TOKEN.into(), 1, None).unwrap();
    assert_eq!(forced.port(), n);
    assert_eq!(port::remembered(&port::file(&p)), Some(b));
}

#[test]
fn a_damaged_memory_picks_a_new_port() {
    let p = paths("port-damaged");
    std::fs::create_dir_all(&p.data_dir).unwrap();
    std::fs::write(port::file(&p), "{\"port\": 22}").unwrap();
    let s = port::start(&p, 0, TOKEN.into(), 1, None).unwrap();
    assert_ne!(s.port(), 22);
    assert_eq!(port::remembered(&port::file(&p)), Some(s.port()));
}
