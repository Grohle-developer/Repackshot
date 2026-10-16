//! The dialogs and the file API over real sockets, with a stand-in for `zenity` that answers what
//! the test says: what a page can and cannot read or write.

#![cfg(unix)]

mod common;

use common::{temp_dir, TestServer};
use rt_app::dialogs::Backend;
use rt_app::json::Value;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// A fake `zenity`: prints `answer` (one path per line) and exits with `code`; its arguments go
/// to `args.txt` next to it.
struct FakeDialog {
    dir: PathBuf,
}

impl FakeDialog {
    fn install(t: &TestServer) -> FakeDialog {
        let dir = t.dir.join("fake-zenity");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("zenity");
        std::fs::write(
            &exe,
            "#!/bin/sh\nd=$(dirname \"$0\")\nprintf '%s\\n' \"$@\" > \"$d/args.txt\"\ncat \"$d/answer\"\nexit $(cat \"$d/code\")\n",
        )
        .unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        t.server.app.dialogs.use_backend(Backend::Zenity(exe));
        FakeDialog { dir }
    }

    fn answer(&self, paths: &[&Path], code: i32) {
        let text: String = paths.iter().map(|p| format!("{}\n", p.display())).collect();
        std::fs::write(self.dir.join("answer"), text).unwrap();
        std::fs::write(self.dir.join("code"), code.to_string()).unwrap();
    }

    fn args(&self) -> String {
        std::fs::read_to_string(self.dir.join("args.txt")).unwrap_or_default()
    }
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

#[test]
fn a_chosen_folder_takes_new_files_and_nothing_else() {
    let t = TestServer::start("files-folder", 1);
    let fake = FakeDialog::install(&t);
    let out = temp_dir("files-out");
    std::fs::write(out.join("existing.png"), b"old").unwrap();

    // Before any dialog nothing is writable.
    let r = t.api(
        "PUT",
        "/api/files?dir=d0123456789abcdef01234567&name=a.png",
        b"x",
    );
    assert_eq!(r.status, 404, "{}", r.text());
    assert_eq!(
        t.api("PUT", "/api/files?dir=..%2F..%2Fetc&name=a.png", b"x")
            .status,
        404
    );

    // Cancelled.
    fake.answer(&[], 1);
    let v = t.json(
        "POST",
        "/api/dialog/folder",
        br#"{"title":"Output folder","start":"/nonexistent"}"#,
    );
    assert_eq!(v.get("cancelled"), Some(&Value::Bool(true)));
    assert!(fake.args().contains("--directory"));
    assert!(fake.args().contains("--title=Output folder"));

    // Chosen.
    fake.answer(&[&out], 0);
    let v = t.json("POST", "/api/dialog/folder", b"{}");
    assert_eq!(v.get("cancelled"), Some(&Value::Bool(false)));
    let folder = v.get("file").unwrap();
    let id = s(folder, "id").to_string();
    assert_eq!(
        Path::new(s(folder, "path")),
        out.canonicalize().unwrap().as_path()
    );
    assert_eq!(folder.get("write"), Some(&Value::Bool(true)));
    assert_eq!(folder.get("read"), Some(&Value::Bool(false)));
    // The same folder chosen again keeps its id (a project's destination stays valid).
    let again = t.json("POST", "/api/dialog/folder", b"{}");
    assert_eq!(s(again.get("file").unwrap(), "id"), id);

    // New files, never an overwrite.
    let r = t.api(
        "PUT",
        &format!("/api/files?dir={id}&name=existing.png"),
        b"new",
    );
    assert_eq!(r.status, 201, "{}", r.text());
    let written = rt_app::json::parse(&r.text()).unwrap();
    assert_eq!(s(&written, "name"), "existing (2).png");
    assert_eq!(std::fs::read(out.join("existing.png")).unwrap(), b"old");
    assert_eq!(std::fs::read(out.join("existing (2).png")).unwrap(), b"new");
    // Unsafe names stay inside the folder; executables are refused.
    let r = t.api(
        "PUT",
        &format!("/api/files?dir={id}&name=..%2F..%2Fevil.png"),
        b"x",
    );
    assert_eq!(r.status, 201);
    assert!(std::fs::read_dir(&out)
        .unwrap()
        .any(|e| e.unwrap().file_name() == ".._.._evil.png"));
    assert_eq!(
        t.api("PUT", &format!("/api/files?dir={id}&name=run.cmd"), b"x")
            .status,
        403
    );
    // A written file is not readable through the API, nor is the folder listable.
    let new_id = s(&written, "id").to_string();
    assert_eq!(
        t.api("GET", &format!("/api/files/{new_id}"), b"").status,
        403
    );
    assert_eq!(
        t.api("GET", &format!("/api/files/{id}/list"), b"").status,
        403
    );
    assert_eq!(
        t.api("PUT", &format!("/api/files/{new_id}"), b"x").status,
        403
    );
    // Its information (for the results viewer) is.
    let info = t.json("GET", &format!("/api/files/{new_id}/info"), b"");
    assert_eq!(s(&info, "name"), "existing (2).png");
    assert_eq!(info.get("size"), Some(&Value::Number(3.0)));
    // Missing query, wrong methods.
    assert_eq!(t.api("PUT", "/api/files?name=a.png", b"x").status, 400);
    assert_eq!(
        t.api("DELETE", &format!("/api/files/{id}"), b"").status,
        405
    );
    assert_eq!(t.api("GET", "/api/dialog/folder", b"").status, 405);
}

#[test]
fn opened_files_are_read_and_written_only_as_granted() {
    let t = TestServer::start("files-open", 1);
    let fake = FakeDialog::install(&t);
    let dir = temp_dir("files-open-src");
    let model = dir.join("model.glb");
    let bytes: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(&model, &bytes).unwrap();
    let project = dir.join("bottle.repack.json");
    std::fs::write(&project, br#"{"format":"repackshot"}"#).unwrap();

    fake.answer(&[&model, &project], 0);
    let v = t.json(
        "POST",
        "/api/dialog/open",
        br#"{"title":"Import","multiple":true,"filters":[{"name":"Models","extensions":["glb","obj"]},{"name":"All files","extensions":["*"]}]}"#,
    );
    let files = v.get("files").and_then(Value::as_array).unwrap();
    assert_eq!(files.len(), 2);
    assert!(fake.args().contains("--multiple"));
    assert!(fake
        .args()
        .contains("--file-filter=Models | *.glb *.GLB *.obj *.OBJ"));
    let model_id = s(&files[0], "id").to_string();
    assert_eq!(files[0].get("size"), Some(&Value::Number(300_000.0)));
    assert_eq!(files[0].get("write"), Some(&Value::Bool(false)));

    // Streamed, with ranges.
    let all = t.api("GET", &format!("/api/files/{model_id}"), b"");
    assert_eq!(all.status, 200);
    assert_eq!(all.body, bytes);
    let part = t.raw(
        "GET",
        &format!("/api/files/{model_id}"),
        &[
            ("X-Repackshot-Token", common::TOKEN),
            ("Range", "bytes=10-19"),
        ],
        b"",
    );
    assert_eq!(part.status, 206);
    assert_eq!(part.body, &bytes[10..20]);
    // Read-only.
    assert_eq!(
        t.api("PUT", &format!("/api/files/{model_id}"), b"x").status,
        403
    );
    // Its SHA-256, computed by the launcher.
    let sha = t.json("POST", &format!("/api/files/{model_id}/sha256"), b"");
    assert_eq!(
        s(&sha, "sha256"),
        rt_app::sha256::hex(&rt_app::sha256::Sha256::digest(&bytes))
    );

    // A project opened to be saved again is writable, in place and whole.
    fake.answer(&[&project], 0);
    let v = t.json(
        "POST",
        "/api/dialog/open",
        br#"{"writable":true,"filters":[{"name":"Project","extensions":["repack.json"]}]}"#,
    );
    let p = v.get("file").unwrap();
    assert_eq!(p.get("write"), Some(&Value::Bool(true)));
    let pid = s(p, "id").to_string();
    let r = t.api("PUT", &format!("/api/files/{pid}"), br#"{"saved":1}"#);
    assert_eq!(r.status, 200, "{}", r.text());
    assert_eq!(std::fs::read(&project).unwrap(), br#"{"saved":1}"#);
    // A project saved as .repack: the Open dialog lists both extensions in one filter, and the file is writable whole.
    let repack = dir.join("bottle.repack");
    std::fs::write(&repack, br#"{"format":"repackshot"}"#).unwrap();
    fake.answer(&[&repack], 0);
    let v = t.json(
        "POST",
        "/api/dialog/open",
        br#"{"writable":true,"filters":[{"name":"Project","extensions":["repack","repack.json"]},{"name":"All files","extensions":["*"]}]}"#,
    );
    assert!(fake
        .args()
        .contains("--file-filter=Project | *.repack *.REPACK *.repack.json *.REPACK.JSON"));
    let rid = s(v.get("file").unwrap(), "id").to_string();
    let r = t.api("PUT", &format!("/api/files/{rid}"), br#"{"saved":2}"#);
    assert_eq!(r.status, 200, "{}", r.text());
    assert_eq!(std::fs::read(&repack).unwrap(), br#"{"saved":2}"#);
    // The last project survives the launch: a new server finds it through its data folder.
    assert_eq!(
        t.api(
            "PUT",
            "/api/projects/last",
            format!(r#"{{"id":"{pid}"}}"#).as_bytes()
        )
        .status,
        204
    );
    assert_eq!(
        t.api(
            "PUT",
            "/api/projects/last",
            format!(r#"{{"id":"{model_id}"}}"#).as_bytes()
        )
        .status,
        403
    );
    let last = t.json("GET", "/api/projects/last", b"");
    assert_eq!(s(&last, "id"), pid);

    // Bad filters are refused before any dialog.
    for bad in [
        &br#"{"filters":[{"name":"x","extensions":["../x"]}]}"#[..],
        br#"{"filters":[{"name":"","extensions":["png"]}]}"#,
        br#"{"filters":"png"}"#,
        b"not json",
    ] {
        assert_eq!(t.api("POST", "/api/dialog/open", bad).status, 400);
    }
}

#[test]
fn a_save_dialog_grants_one_file_with_a_known_extension() {
    let t = TestServer::start("files-save", 1);
    let fake = FakeDialog::install(&t);
    let dir = temp_dir("files-save-dst");
    let target = dir.join("scene.rsb");
    fake.answer(&[&target], 0);
    let v = t.json(
        "POST",
        "/api/dialog/save",
        br#"{"title":"Export scene","defaultName":"bottle.rsb","start":"/tmp","filters":[{"name":"Scene","extensions":["rsb"]}]}"#,
    );
    let g = v.get("file").unwrap();
    assert!(fake.args().contains("--save"));
    assert!(fake.args().contains("--filename=/tmp/bottle.rsb"));
    let id = s(g, "id");
    assert_eq!(
        t.api("PUT", &format!("/api/files/{id}"), b"RSB1").status,
        200
    );
    assert_eq!(std::fs::read(&target).unwrap(), b"RSB1");
    // Shown in the file manager (204), or 500 no-file-manager where there is none (CI).
    let shown = t.api("POST", &format!("/api/files/{id}/reveal"), b"");
    assert!(
        shown.status == 204 || shown.text().contains("no-file-manager"),
        "{}",
        shown.text()
    );
    // A file that is gone is not shown.
    std::fs::remove_file(&target).unwrap();
    assert_eq!(
        t.api("POST", &format!("/api/files/{id}/reveal"), b"")
            .status,
        410
    );
    // An extension the application does not write.
    fake.answer(&[&dir.join("evil.exe")], 0);
    assert_eq!(t.api("POST", "/api/dialog/save", b"{}").status, 422);
    // A folder that does not exist.
    fake.answer(&[&dir.join("no/such/x.png")], 0);
    assert_eq!(t.api("POST", "/api/dialog/save", b"{}").status, 400);
    // No dialog program.
    t.server
        .app
        .dialogs
        .use_backend(Backend::Zenity("/nonexistent/zenity".into()));
    let r = t.api("POST", "/api/dialog/folder", b"{}");
    assert_eq!(r.status, 501, "{}", r.text());
    assert!(r.text().contains("no-dialog"));
}

#[test]
fn a_project_is_saved_as_repack_and_a_repack_json_still_is() {
    let t = TestServer::start("files-save-project", 1);
    let fake = FakeDialog::install(&t);
    let dir = temp_dir("files-save-project-dst");
    let body = br#"{"filters":[{"name":"Project","extensions":["repack","repack.json"]}],"defaultName":"bottle.repack"}"#;
    for name in ["bottle.repack", "old.repack.json"] {
        let target = dir.join(name);
        fake.answer(&[&target], 0);
        let v = t.json("POST", "/api/dialog/save", body);
        assert!(fake
            .args()
            .contains("--file-filter=Project | *.repack *.REPACK *.repack.json *.REPACK.JSON"));
        let id = s(v.get("file").unwrap(), "id").to_string();
        assert_eq!(
            t.api("PUT", &format!("/api/files/{id}"), br#"{"v":2}"#)
                .status,
            200,
            "{name}"
        );
        assert_eq!(std::fs::read(&target).unwrap(), br#"{"v":2}"#, "{name}");
        // The page remembers it as the last project.
        assert_eq!(
            t.api(
                "PUT",
                "/api/projects/last",
                format!(r#"{{"id":"{id}"}}"#).as_bytes()
            )
            .status,
            204,
            "{name}"
        );
    }
    // A name that is not a project, saved as one, is still refused when its extension is not ours.
    fake.answer(&[&dir.join("bottle.repack.exe")], 0);
    assert_eq!(t.api("POST", "/api/dialog/save", body).status, 422);
}

#[test]
fn imports_read_a_chosen_folder_and_urls_are_https_only() {
    let t = TestServer::start("files-import", 1);
    let fake = FakeDialog::install(&t);
    let dir = temp_dir("files-model");
    std::fs::create_dir_all(dir.join("vae")).unwrap();
    std::fs::write(dir.join("model.safetensors"), b"weights").unwrap();
    std::fs::write(dir.join("vae/vae.safetensors"), b"vae").unwrap();
    fake.answer(&[&dir], 0);
    let v = t.json(
        "POST",
        "/api/dialog/folder",
        br#"{"read":true,"write":false}"#,
    );
    let g = v.get("file").unwrap();
    assert_eq!(g.get("write"), Some(&Value::Bool(false)));
    let id = s(g, "id");
    let list = t.json("GET", &format!("/api/files/{id}/list"), b"");
    let files = list.get("files").and_then(Value::as_array).unwrap();
    let rels: Vec<&str> = files.iter().map(|f| s(f, "rel")).collect();
    assert_eq!(rels, ["model.safetensors", "vae/vae.safetensors"]);
    let vae = t.api("GET", &format!("/api/files/{}", s(&files[1], "id")), b"");
    assert_eq!(vae.body, b"vae");
    // A read-only folder takes no new files.
    assert_eq!(
        t.api("PUT", &format!("/api/files?dir={id}&name=x.png"), b"x")
            .status,
        403
    );
    for bad in [
        r#"{"url":"http://example.org"}"#,
        r#"{"url":"file:///etc/passwd"}"#,
        r#"{"url":"https://a\" & calc"}"#,
        r#"{}"#,
    ] {
        assert_eq!(
            t.api("POST", "/api/open-url", bad.as_bytes()).status,
            400,
            "{bad}"
        );
    }
    // Without the token, nothing of this answers.
    assert_eq!(t.raw("POST", "/api/dialog/folder", &[], b"{}").status, 401);
    assert_eq!(
        t.raw("GET", &format!("/api/files/{id}/list"), &[], b"")
            .status,
        401
    );
}
