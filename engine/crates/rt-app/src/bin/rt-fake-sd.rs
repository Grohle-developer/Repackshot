//! `rt-fake-sd`: a stand-in for stable-diffusion.cpp's `sd-cli` and `sd-server` in the tests of
//! `rt-app` (never shipped). It speaks the same command line and the same native server API
//! (`examples/server/api.md` of the pinned release), prints the same progress lines, and can be
//! told to misbehave.
//!
//! * `--version`, `--list-devices`, `--help`: like `sd-cli`.
//! * With `--listen-port`: a server. It "loads" (a `#` progress bar), listens on `--listen-ip`,
//!   answers `GET /sdcpp/v1/capabilities`, `POST /sdcpp/v1/img_gen` (202 and a job id),
//!   `GET /sdcpp/v1/jobs/<id>` and `POST /sdcpp/v1/jobs/<id>/cancel`, and makes a deterministic
//!   image from the init image (the same size), printing `|=>  | k/N - 0.01s/it` per step,
//!   `N = steps × strength` as img2img does.
//!
//! Next to the executable: `fake-sd.json` (optional) says how to load (`{"load":
//! "ok|hang|crash", "loadMs": 40, "stepMs": 10, "devices": "CPU\tFake CPU", "fail": "version"}`);
//! `args.log` gets every start's arguments (one JSON array a line) and `requests.log` every job
//! (its JSON with the images replaced by their length). A prompt with `[fake:hang]`,
//! `[fake:crash]`, `[fake:slow]`, `[fake:fail]`, `[fake:quiet]` or `[fake:size=WxH]` makes that
//! job hang, crash the process, go slowly, fail, print nothing, or answer another size.

use rt_app::ai::{b64, png};
use rt_app::http::{read_request, write_response, Response};
use rt_app::json::{self, Value};
use std::collections::HashMap;
use std::io::{BufReader, BufWriter, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_default()
}

fn control() -> Value {
    std::fs::read_to_string(exe_dir().join("fake-sd.json"))
        .ok()
        .and_then(|t| json::parse(&t).ok())
        .unwrap_or(Value::Null)
}

fn append(name: &str, line: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(exe_dir().join(name))
    {
        let _ = writeln!(f, "{line}");
    }
}

fn bar(c: char, k: u32, n: u32) -> String {
    let filled = (k * 50 / n.max(1)) as usize;
    format!(
        "  |{}{}|",
        c.to_string().repeat(filled),
        " ".repeat(50 - filled)
    )
}

#[derive(Clone, Debug)]
struct Job {
    status: &'static str,
    image: Option<String>,
    error: Option<String>,
    cancel: bool,
}

type Jobs = Arc<Mutex<HashMap<String, Job>>>;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let ctl = control();
    let fail = ctl.get("fail").and_then(Value::as_str).unwrap_or("");
    if args.iter().any(|a| a == "--version") {
        if fail == "version" {
            eprintln!(
                "error while loading shared libraries: libfake.so: cannot open shared object file"
            );
            return ExitCode::from(127);
        }
        println!("stable-diffusion.cpp version fake, commit fake000");
        return ExitCode::SUCCESS;
    }
    if args.iter().any(|a| a == "--list-devices") {
        eprintln!("load_backend: loaded CPU backend from fake");
        println!(
            "{}",
            ctl.get("devices")
                .and_then(Value::as_str)
                .unwrap_or("CPU\tFake CPU")
        );
        return ExitCode::SUCCESS;
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("Usage: rt-fake-sd [options]\n  --listen-ip <string>\n  --listen-port <int>");
        return ExitCode::SUCCESS;
    }
    let value = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let (Some(ip), Some(port)) = (value("--listen-ip"), value("--listen-port")) else {
        eprintln!("error: the following arguments are required: listen_port");
        return ExitCode::from(2);
    };
    append(
        "args.log",
        &json::array(args.iter().map(|a| json::string(a))),
    );
    // Loading.
    let load_ms = ctl.get("loadMs").and_then(Value::as_f64).unwrap_or(40.0) as u64;
    match ctl.get("load").and_then(Value::as_str).unwrap_or("ok") {
        "crash" => {
            println!("  |##        | 1/4 - 10.00MB/s");
            eprintln!("[ERROR] fake: the model file is not a model");
            return ExitCode::from(1);
        }
        "hang" => {
            println!("  |##        | 1/4 - 10.00MB/s");
            std::thread::sleep(Duration::from_secs(3600));
            return ExitCode::from(1);
        }
        _ => {}
    }
    for k in 1..=4 {
        std::thread::sleep(Duration::from_millis(load_ms / 4));
        print!(
            "\r{} {k}/4 - 12.00MB/s\u{1b}[K{}",
            bar('#', k, 4),
            if k == 4 { "\n" } else { "" }
        );
        let _ = std::io::stdout().flush();
    }
    let listener = match TcpListener::bind((ip.as_str(), port.parse::<u16>().unwrap_or(0))) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[ERROR] fake: cannot listen on {ip}:{port}: {e}");
            return ExitCode::from(1);
        }
    };
    println!("[INFO ] listening on: http://{ip}:{port}");
    let jobs: Jobs = Arc::new(Mutex::new(HashMap::new()));
    let next = Arc::new(AtomicU32::new(1));
    let step_ms = ctl.get("stepMs").and_then(Value::as_f64).unwrap_or(10.0) as u64;
    for stream in listener.incoming().flatten() {
        let (jobs, next) = (Arc::clone(&jobs), Arc::clone(&next));
        std::thread::spawn(move || serve(stream, &jobs, &next, step_ms));
    }
    ExitCode::SUCCESS
}

fn job_json(id: &str, j: &Job) -> String {
    let result = j.image.as_ref().map_or_else(
        || "null".to_string(),
        |img| {
            format!(
                "{{\"output_format\":\"png\",\"images\":[{{\"index\":0,\"b64_json\":{}}}]}}",
                json::string(img)
            )
        },
    );
    let error = j.error.as_ref().map_or_else(
        || "null".to_string(),
        |m| {
            json::Object::new()
                .str(
                    "code",
                    if j.status == "cancelled" {
                        "cancelled"
                    } else {
                        "generation_failed"
                    },
                )
                .str("message", m)
                .build()
        },
    );
    json::Object::new()
        .str("id", id)
        .str("kind", "img_gen")
        .str("status", j.status)
        .num("created", 1_775_401_200.0)
        .num("queue_position", 0.0)
        .raw("result", &result)
        .raw("error", &error)
        .build()
}

fn serve(stream: TcpStream, jobs: &Jobs, next: &AtomicU32, step_ms: u64) {
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let mut writer = BufWriter::new(stream);
    let Ok(req) = read_request(&mut reader) else {
        return;
    };
    let mut body = Vec::new();
    let _ = (&mut reader)
        .take(req.content_length)
        .read_to_end(&mut body);
    let parts: Vec<&str> = req.path.trim_start_matches('/').split('/').collect();
    let response = match (req.method.as_str(), parts.as_slice()) {
        ("GET", ["sdcpp", "v1", "capabilities"]) => Response::json(
            200,
            "{\"model\":{\"name\":\"fake\"},\"supported_modes\":[\"img_gen\"]}".into(),
        ),
        ("POST", ["sdcpp", "v1", "img_gen"]) => submit(&body, jobs, next, step_ms),
        ("GET", ["sdcpp", "v1", "jobs", id]) => match jobs.lock().unwrap().get(*id) {
            Some(j) => Response::json(200, job_json(id, j)),
            None => Response::json(404, "{\"error\":\"job not found\"}".into()),
        },
        ("POST", ["sdcpp", "v1", "jobs", id, "cancel"]) => {
            let mut all = jobs.lock().unwrap();
            match all.get_mut(*id) {
                Some(j) if j.status == "queued" || j.status == "generating" => {
                    j.cancel = true;
                    Response::json(200, job_json(id, j))
                }
                Some(j) => Response::json(409, job_json(id, j)),
                None => Response::json(404, "{\"error\":\"job not found\"}".into()),
            }
        }
        _ => Response::json(404, "{\"error\":\"not found\"}".into()),
    };
    let _ = write_response(&mut writer, response, false, false);
}

fn tag<'a>(prompt: &'a str, name: &str) -> Option<&'a str> {
    let start = prompt.find(&format!("[fake:{name}"))? + 6 + name.len();
    let end = prompt[start..].find(']')? + start;
    Some(prompt[start..end].trim_start_matches('='))
}

fn submit(body: &[u8], jobs: &Jobs, next: &AtomicU32, step_ms: u64) -> Response {
    let text = String::from_utf8_lossy(body);
    let Ok(v) = json::parse(&text) else {
        return Response::json(400, "{\"error\":\"invalid JSON\"}".into());
    };
    // The log: the request with its images replaced by their length.
    let logged = match &v {
        Value::Object(fields) => {
            let mut o = json::Object::new();
            for (k, val) in fields {
                o = match val {
                    Value::String(s) if k.ends_with("image") => {
                        o.str(k, &format!("<{} chars>", s.len()))
                    }
                    Value::Array(a) if k == "ref_images" => o.num(k, a.len() as f64),
                    other => o.raw(k, &other.to_json()),
                };
            }
            o.build()
        }
        _ => "null".into(),
    };
    append("requests.log", &logged);
    let Some(init) = v.get("init_image").and_then(Value::as_str) else {
        return Response::json(400, "{\"error\":\"invalid generation parameters\"}".into());
    };
    let prompt = v
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let strength = v.get("strength").and_then(Value::as_f64).unwrap_or(0.75);
    let seed = v.get("seed").and_then(Value::as_f64).unwrap_or(42.0) as u64;
    let steps = v
        .get("sample_params")
        .and_then(|s| s.get("sample_steps"))
        .and_then(Value::as_f64)
        .unwrap_or(20.0);
    let n = ((steps * strength).floor() as u32).max(1);
    let img = b64::decode(init).and_then(|b| png::decode(&b, 1 << 26).ok());
    let id = format!(
        "job_6a{:06x}_{:08}",
        0x1234,
        next.fetch_add(1, Ordering::Relaxed)
    );
    jobs.lock().unwrap().insert(
        id.clone(),
        Job {
            status: "queued",
            image: None,
            error: None,
            cancel: false,
        },
    );
    let jobs = Arc::clone(jobs);
    let job_id = id.clone();
    std::thread::spawn(move || {
        let set = |f: &dyn Fn(&mut Job)| {
            if let Some(j) = jobs.lock().unwrap().get_mut(&job_id) {
                f(j);
            }
        };
        let cancelled = || jobs.lock().unwrap().get(&job_id).is_some_and(|j| j.cancel);
        set(&|j| j.status = "generating");
        let slow = tag(&prompt, "slow").is_some();
        let quiet = tag(&prompt, "quiet").is_some();
        for k in 1..=n {
            std::thread::sleep(Duration::from_millis(if slow { 300 } else { step_ms }));
            if cancelled() {
                set(&|j| {
                    j.status = "cancelled";
                    j.error = Some("job cancelled by client".into());
                });
                return;
            }
            if !quiet {
                print!(
                    "\r{} {k}/{n} - 0.01s/it\u{1b}[K{}",
                    bar('=', k, n),
                    if k == n { "\n" } else { "" }
                );
                let _ = std::io::stdout().flush();
            }
            if k == 1 && tag(&prompt, "hang").is_some() {
                std::thread::sleep(Duration::from_secs(3600));
            }
            if k == 1 && tag(&prompt, "crash").is_some() {
                eprintln!("[ERROR] fake: GGML_ASSERT failed");
                std::process::exit(3);
            }
        }
        if tag(&prompt, "fail").is_some() {
            set(&|j| {
                j.status = "failed";
                j.error = Some("generate_image returned empty results".into());
            });
            return;
        }
        let Some(src) = &img else {
            set(&|j| {
                j.status = "failed";
                j.error = Some("the init image does not decode".into());
            });
            return;
        };
        let (w, h) = tag(&prompt, "size")
            .and_then(|s| s.split_once('x'))
            .and_then(|(a, b)| Some((a.parse::<u32>().ok()?, b.parse::<u32>().ok()?)))
            .unwrap_or((src.width, src.height));
        // Deterministic: the input brightened by the strength and shifted by the seed.
        let lift = (strength * 64.0).round() as u32 + (seed % 7) as u32;
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                for c in 0..3 {
                    let v = if x < src.width && y < src.height {
                        u32::from(src.rgba[((y * src.width + x) * 4 + c) as usize])
                    } else {
                        128
                    };
                    rgb.push(((v + lift) % 256) as u8);
                }
            }
        }
        let out = b64::encode(&rt_core::png::encode(w, h, &rgb));
        set(&|j| {
            j.status = "completed";
            j.image = Some(out.clone());
        });
    });
    Response::json(
        202,
        json::Object::new()
            .str("id", &id)
            .str("kind", "img_gen")
            .str("status", "queued")
            .num("created", 1_775_401_200.0)
            .str("poll_url", &format!("/sdcpp/v1/jobs/{id}"))
            .build(),
    )
}
