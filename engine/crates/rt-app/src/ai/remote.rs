//! The AI model through a remote API (phase X7, `docs/AI-POST.md` §8): the [`RemoteApi`]
//! backend of the desktop pipeline, the keys it uses ([`ApiKeys`]), and the rules it shares with
//! the page's own (`src/core/ai-remote.ts`, `src/io/ai-api.ts`), both checked against
//! `tests/fixtures/ai-remote-cases.json`.
//!
//! The launcher has no TLS of its own (`std` only), so it calls the API with the system's `curl`,
//! as it downloads the runtimes ([`super::download`]). The **key never appears on a command line,
//! in a file of the request or in a log**: `curl` reads its whole configuration, the key's header
//! included, from its standard input (`--config -`, after `-q` so no `.curlrc` is read); the body
//! (the tile, which leaves the computer anyway) goes through a temporary file that is removed
//! after the call. No redirect is followed (it could take the render to a host the person did not
//! allow); only `https`, or plain `http` to this computer. The answer is read up to
//! [`MAX_RESPONSE_BYTES`]; past it `curl` is stopped.
//!
//! The page sends the endpoint with each post (`remote` of `POST /api/ai/post`, without the key);
//! the launcher refuses a post whose URL names another host than the one the person allowed
//! (`consentedHost`) and one with no key for its host when it needs one.

use super::backend::{BackendError, ModelBackend, TilePass};
use super::sidecar::{Progress, Stage};
use super::{b64, png};
use crate::json::{self, Value};
use rt_post::Rgb8Image;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Largest answer read, in bytes (`MAX_RESPONSE_BYTES` of `src/core/ai-remote.ts`).
pub const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
/// Largest side of an image an answer may hold.
pub const MAX_RESULT_SIDE: u32 = 8192;
/// An answer may hold at most this many times the pixels sent.
pub const MAX_RESULT_PIXEL_RATIO: u64 = 4;
/// The longest a rate limit is waited for, in seconds.
pub const MAX_RETRY_WAIT: u32 = 30;
/// Longest template text.
pub const MAX_TEMPLATE: usize = 16384;
/// Tries of a call, at most.
pub const MAX_ATTEMPTS: u32 = 5;

/// The placeholders a template may use (`API_PLACEHOLDERS`).
pub const PLACEHOLDERS: [&str; 16] = [
    "image",
    "image_base64",
    "image_data_uri",
    "depth",
    "depth_base64",
    "depth_data_uri",
    "edges",
    "edges_base64",
    "edges_data_uri",
    "prompt",
    "negative",
    "strength",
    "seed",
    "width",
    "height",
    "size",
];
const NUMERIC: [&str; 4] = ["strength", "seed", "width", "height"];
const FILES: [&str; 3] = ["image", "depth", "edges"];
const RESERVED_HEADERS: [&str; 10] = [
    "host",
    "content-length",
    "content-type",
    "transfer-encoding",
    "connection",
    "cookie",
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "api-key",
];

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Why a remote call failed: its code (one of `API_ERRORS`), in words, the tries made, the HTTP
/// status and the service's own words (short, never the key).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteError {
    /// `api-auth`, `api-timeout`… (`cancelled` when stopped).
    pub code: &'static str,
    /// In words, in English (the page words it from the code).
    pub message: String,
    /// Tries made.
    pub attempts: u32,
    /// The HTTP status, when there was an answer.
    pub status: Option<u16>,
    /// The service's own words, or what was found in place of an image.
    pub detail: String,
}

impl RemoteError {
    fn new(code: &'static str, message: impl Into<String>) -> RemoteError {
        RemoteError {
            code,
            message: message.into(),
            attempts: 1,
            status: None,
            detail: String::new(),
        }
    }
}

// ------------------------------------------------------------------ hosts

/// Whether a host (as [`host_of`] writes it) is this computer.
pub fn is_loopback(host: &str) -> bool {
    let name = match host.rsplit_once(':') {
        Some((n, p))
            if !n.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) && !host.ends_with(']') =>
        {
            n
        }
        _ => host,
    };
    if name == "localhost" || name == "[::1]" {
        return true;
    }
    let parts: Vec<&str> = name.split('.').collect();
    parts.len() == 4
        && parts[0] == "127"
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 3 && p.bytes().all(|b| b.is_ascii_digit()))
}

fn label_ok(l: &str) -> bool {
    !l.is_empty()
        && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !l.starts_with('-')
        && !l.ends_with('-')
}

/// The host of an http(s) URL as consent and keys remember it (`hostOf`): lower case, the port
/// only when it is not the scheme's own. None for anything else (a user or password, a fragment).
pub fn host_of(url: &str) -> Option<String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let (scheme, rest) = match lower.strip_prefix("https://") {
        Some(r) => ("https", r),
        None => ("http", lower.strip_prefix("http://")?),
    };
    if rest.contains('#') {
        return None;
    }
    let end = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = &rest[..end];
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let close = inner.find(']')?;
        let ip = &inner[..close];
        if ip.is_empty()
            || !ip
                .bytes()
                .all(|b| b.is_ascii_hexdigit() || b == b':' || b == b'.')
        {
            return None;
        }
        let after = &inner[close + 1..];
        let port = match after.strip_prefix(':') {
            Some(p) => Some(p),
            None if after.is_empty() => None,
            None => return None,
        };
        (format!("[{ip}]"), port)
    } else {
        let (h, p) = match authority.split_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (authority, None),
        };
        if !h.split('.').all(label_ok) {
            return None;
        }
        (h.to_string(), p)
    };
    let port = match port {
        None => None,
        Some(p) => {
            if p.is_empty() || p.len() > 5 || !p.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let n: u32 = p.parse().ok()?;
            if !(1..=65535).contains(&n) {
                return None;
            }
            Some(n)
        }
    };
    let default = if scheme == "https" { 443 } else { 80 };
    Some(match port {
        Some(p) if p != default => format!("{host}:{p}"),
        _ => host,
    })
}

// ------------------------------------------------------------------ the endpoint

/// How the request carries the image.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyKind {
    /// A JSON document.
    Json,
    /// A multipart form.
    Multipart,
}

/// What the service answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnswerKind {
    /// A JSON document with the image in it.
    Json,
    /// The image itself.
    Image,
}

/// One remote endpoint (`ApiEndpoint`): no secret in it.
#[derive(Clone, Debug, PartialEq)]
pub struct Endpoint {
    /// The URL.
    pub url: String,
    /// `POST` or `PUT`.
    pub method: String,
    /// The header of the key (empty: none).
    pub auth_header: String,
    /// What goes before the key.
    pub auth_prefix: String,
    /// More headers.
    pub headers: Vec<(String, String)>,
    /// JSON or a form.
    pub body: BodyKind,
    /// The template, a JSON object.
    pub template: Value,
    /// JSON or the image.
    pub answer: AnswerKind,
    /// Where the image is in a JSON answer.
    pub answer_path: String,
    /// Longest side sent.
    pub max_side: u32,
    /// Sides are multiples of this.
    pub multiple_of: u32,
    /// The only sizes the service makes, if it has such a list.
    pub sizes: Vec<(u32, u32)>,
}

/// How the calls are made (`ApiOptions`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CallOptions {
    /// Send the depth and edge passes too.
    pub send_passes: bool,
    /// Seconds a call may take.
    pub timeout_seconds: u32,
    /// Tries of a call.
    pub attempts: u32,
}

/// What a post carries to call the API (`AiRemoteRequest`).
#[derive(Clone, Debug, PartialEq)]
pub struct RemoteSpec {
    /// The endpoint.
    pub endpoint: Endpoint,
    /// The options.
    pub options: CallOptions,
    /// The host the person allowed: the URL's.
    pub host: String,
    /// The provider key, for the report.
    pub provider: String,
}

fn header_name_ok(n: &str) -> bool {
    (1..=64).contains(&n.len())
        && n.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+.^_`|~-".contains(&b))
}

/// Every placeholder a text uses, in order of first use.
pub fn placeholders_in(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("{{") {
        let after = &rest[i + 2..];
        match after.find("}}") {
            Some(j) => {
                let name = &after[..j];
                if !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
                    if !out.iter().any(|o| o == name) {
                        out.push(name.to_string());
                    }
                    rest = &after[j + 2..];
                } else {
                    rest = &rest[i + 1..];
                }
            }
            None => break,
        }
    }
    out
}

fn walk_strings<'a>(v: &'a Value, f: &mut dyn FnMut(&'a str)) {
    match v {
        Value::String(s) => f(s),
        Value::Array(items) => items.iter().for_each(|x| walk_strings(x, f)),
        Value::Object(members) => members.iter().for_each(|(_, x)| walk_strings(x, f)),
        _ => {}
    }
}

/// The problems of an endpoint (`endpointProblems`), as their codes, in the same order.
pub fn endpoint_problems(e: &Endpoint, o: &CallOptions) -> Vec<&'static str> {
    let mut out = Vec::new();
    match host_of(&e.url) {
        None => out.push("url"),
        Some(h) => {
            if !e.url.trim().to_ascii_lowercase().starts_with("https://") && !is_loopback(&h) {
                out.push("insecure");
            }
        }
    }
    if e.method != "POST" && e.method != "PUT" {
        out.push("method");
    }
    if !e.auth_header.is_empty() && !header_name_ok(&e.auth_header) {
        out.push("header");
    }
    if e.auth_prefix.contains(['\r', '\n']) || e.auth_prefix.len() > 64 {
        out.push("header");
    }
    for (name, value) in &e.headers {
        if !header_name_ok(name) || value.contains(['\r', '\n']) || value.len() > 1024 {
            out.push("header");
        } else if RESERVED_HEADERS.contains(&name.to_ascii_lowercase().as_str())
            || (!e.auth_header.is_empty() && name.eq_ignore_ascii_case(&e.auth_header))
        {
            out.push("reservedHeader");
        }
    }
    if !matches!(e.template, Value::Object(_)) {
        out.push("template");
    } else {
        let mut used: Vec<String> = Vec::new();
        walk_strings(&e.template, &mut |s| {
            for p in placeholders_in(s) {
                if !used.contains(&p) {
                    used.push(p);
                }
            }
        });
        for p in &used {
            if !PLACEHOLDERS.contains(&p.as_str()) {
                out.push("placeholder");
            } else if !o.send_passes && (p.starts_with("depth") || p.starts_with("edges")) {
                out.push("passes");
            }
        }
        if !["image", "image_base64", "image_data_uri"]
            .iter()
            .any(|p| used.iter().any(|u| u == p))
        {
            out.push("noImage");
        }
        if e.body == BodyKind::Multipart {
            if let Value::Object(members) = &e.template {
                for (_, v) in members {
                    if matches!(v, Value::Object(_) | Value::Array(_)) {
                        out.push("nested");
                    }
                }
            }
        }
    }
    if e.answer == AnswerKind::Json
        && (e.answer_path.is_empty()
            || e.answer_path
                .split('.')
                .any(|k| k.is_empty() || k.contains(char::is_whitespace)))
    {
        out.push("path");
    }
    let side = |n: u32| (64..=4096).contains(&n);
    if !side(e.max_side)
        || !(1..=256).contains(&e.multiple_of)
        || e.sizes.len() > 16
        || e.sizes.iter().any(|&(w, h)| !side(w) || !side(h))
    {
        out.push("size");
    }
    if !(10..=600).contains(&o.timeout_seconds) || !(1..=MAX_ATTEMPTS).contains(&o.attempts) {
        out.push("options");
    }
    out
}

fn whole_u32(v: Option<&Value>, max: f64) -> Option<u32> {
    v.and_then(Value::as_f64)
        .filter(|n| n.fract() == 0.0 && *n >= 0.0 && *n <= max)
        .map(|n| n as u32)
}

impl RemoteSpec {
    /// Reads `remote` of a post. The error is in words (the post is refused with `api-config`).
    pub fn from_json(v: &Value) -> Result<RemoteSpec, String> {
        let e = v.get("endpoint").ok_or("'remote.endpoint' is missing")?;
        let o = v.get("options").ok_or("'remote.options' is missing")?;
        let text = |x: &Value, k: &str, max: usize| -> Result<String, String> {
            x.get(k)
                .and_then(Value::as_str)
                .filter(|s| s.len() <= max)
                .map(str::to_string)
                .ok_or(format!("'{k}' must be a string of at most {max} bytes"))
        };
        let template_text = text(e, "template", MAX_TEMPLATE)?;
        let template =
            json::parse(&template_text).map_err(|_| "the template is not JSON".to_string())?;
        let mut headers = Vec::new();
        match e.get("headers") {
            Some(Value::Object(members)) if members.len() <= 16 => {
                for (k, x) in members {
                    let s = x.as_str().ok_or("a header's value must be a string")?;
                    headers.push((k.clone(), s.to_string()));
                }
            }
            None | Some(Value::Null) => {}
            _ => return Err("'headers' must be {name: value}".into()),
        }
        let mut sizes = Vec::new();
        if let Some(list) = e.get("sizes").and_then(Value::as_array) {
            for s in list.iter().take(17) {
                match s.as_array() {
                    Some([w, h]) => sizes.push((
                        whole_u32(Some(w), 65536.0).ok_or("a size must be [width, height]")?,
                        whole_u32(Some(h), 65536.0).ok_or("a size must be [width, height]")?,
                    )),
                    _ => return Err("a size must be [width, height]".into()),
                }
            }
        }
        let endpoint = Endpoint {
            url: text(e, "url", 2048)?,
            method: text(e, "method", 8)?,
            auth_header: text(e, "authHeader", 64)?,
            auth_prefix: text(e, "authPrefix", 64)?,
            headers,
            body: match e.get("body").and_then(Value::as_str) {
                Some("JSON") => BodyKind::Json,
                Some("MULTIPART") => BodyKind::Multipart,
                _ => return Err("'body' must be JSON or MULTIPART".into()),
            },
            template,
            answer: match e.get("response").and_then(Value::as_str) {
                Some("JSON") => AnswerKind::Json,
                Some("IMAGE") => AnswerKind::Image,
                _ => return Err("'response' must be JSON or IMAGE".into()),
            },
            answer_path: text(e, "responsePath", 256)?,
            max_side: whole_u32(e.get("maxSide"), 65536.0)
                .ok_or("'maxSide' must be a whole number")?,
            multiple_of: whole_u32(e.get("multipleOf"), 65536.0)
                .ok_or("'multipleOf' must be a whole number")?,
            sizes,
        };
        let options = CallOptions {
            send_passes: o
                .get("sendPasses")
                .and_then(Value::as_bool)
                .ok_or("'sendPasses' must be true or false")?,
            timeout_seconds: whole_u32(o.get("timeoutSeconds"), 1.0e6)
                .ok_or("'timeoutSeconds' must be a whole number")?,
            attempts: whole_u32(o.get("attempts"), 1.0e6)
                .ok_or("'attempts' must be a whole number")?,
        };
        let problems = endpoint_problems(&endpoint, &options);
        if let Some(p) = problems.first() {
            return Err(format!("the endpoint cannot be used: {p}"));
        }
        let host = host_of(&endpoint.url).ok_or("the URL has no host")?;
        let consented = v.get("consentedHost").and_then(Value::as_str).unwrap_or("");
        if consented != host {
            return Err(format!("sending to {host} was not allowed"));
        }
        let provider = v
            .get("provider")
            .and_then(Value::as_str)
            .filter(|p| {
                (1..=32).contains(&p.len())
                    && p.bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            })
            .unwrap_or("GENERIC")
            .to_string();
        Ok(RemoteSpec {
            endpoint,
            options,
            host,
            provider,
        })
    }
}

// ------------------------------------------------------------------ the template

/// The values of one call (`ApiValues`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Values {
    /// The prompt.
    pub prompt: String,
    /// The negative prompt.
    pub negative: String,
    /// The strength (rounded with [`round_strength`] when written).
    pub strength: f64,
    /// The seed.
    pub seed: u32,
    /// The size sent.
    pub width: u32,
    /// The size sent.
    pub height: u32,
    /// The tile, PNG in base64.
    pub image: String,
    /// The depth pass, PNG in base64, when it is sent.
    pub depth: Option<String>,
    /// The edge pass, PNG in base64, when it is sent.
    pub edges: Option<String>,
}

/// The strength with three decimals at most (the page's `roundStrength`).
pub fn round_strength(s: f64) -> f64 {
    (s.clamp(0.0, 1.0) * 1000.0).round() / 1000.0
}

fn text_of(name: &str, v: &Values) -> String {
    let opt = |o: &Option<String>| o.clone().unwrap_or_default();
    match name {
        "image" | "image_base64" => v.image.clone(),
        "image_data_uri" => format!("data:image/png;base64,{}", v.image),
        "depth" | "depth_base64" => opt(&v.depth),
        "depth_data_uri" => format!("data:image/png;base64,{}", opt(&v.depth)),
        "edges" | "edges_base64" => opt(&v.edges),
        "edges_data_uri" => format!("data:image/png;base64,{}", opt(&v.edges)),
        "prompt" => v.prompt.clone(),
        "negative" => v.negative.clone(),
        "strength" => format!("{}", round_strength(v.strength)),
        "seed" => v.seed.to_string(),
        "width" => v.width.to_string(),
        "height" => v.height.to_string(),
        "size" => format!("{}x{}", v.width, v.height),
        _ => String::new(),
    }
}

fn number_of(name: &str, v: &Values) -> f64 {
    match name {
        "strength" => round_strength(v.strength),
        "seed" => f64::from(v.seed),
        "width" => f64::from(v.width),
        _ => f64::from(v.height),
    }
}

/// The one placeholder a string is, exactly.
fn whole_placeholder(s: &str) -> Option<&str> {
    let inner = s.strip_prefix("{{")?.strip_suffix("}}")?;
    (!inner.is_empty() && inner.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'))
        .then_some(inner)
}

fn substitute(s: &str, v: &Values) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("{{") {
        let after = &rest[i + 2..];
        match after.find("}}") {
            Some(j)
                if !after[..j].is_empty()
                    && after[..j]
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b == b'_') =>
            {
                out.push_str(&rest[..i]);
                out.push_str(&text_of(&after[..j], v));
                rest = &after[j + 2..];
            }
            _ => {
                out.push_str(&rest[..i + 2]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn fill_value(x: &Value, v: &Values) -> Value {
    match x {
        Value::String(s) => match whole_placeholder(s) {
            Some(name) if NUMERIC.contains(&name) => Value::Number(number_of(name, v)),
            _ => Value::String(substitute(s, v)),
        },
        Value::Array(items) => Value::Array(items.iter().map(|y| fill_value(y, v)).collect()),
        Value::Object(members) => Value::Object(
            members
                .iter()
                .map(|(k, y)| (k.clone(), fill_value(y, v)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// A JSON body: the template filled (`fillJson`).
pub fn fill_json(template: &Value, v: &Values) -> Value {
    fill_value(template, v)
}

/// One part of a multipart body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Part {
    /// A text field.
    Text {
        /// Its name.
        name: String,
        /// Its value.
        value: String,
    },
    /// A PNG file: `image`, `depth` or `edges`.
    File {
        /// Its name.
        name: String,
        /// Which image.
        what: &'static str,
    },
}

/// A multipart body's parts (`fillMultipart`).
pub fn fill_multipart(template: &Value, v: &Values) -> Vec<Part> {
    let Value::Object(members) = template else {
        return Vec::new();
    };
    members
        .iter()
        .map(|(name, x)| {
            if let Value::String(s) = x {
                if let Some(f) = whole_placeholder(s).and_then(|p| FILES.iter().find(|f| **f == p))
                {
                    return Part::File {
                        name: name.clone(),
                        what: f,
                    };
                }
            }
            let value = match x {
                Value::String(s) => substitute(s, v),
                Value::Bool(b) => b.to_string(),
                Value::Number(n) => json::number(*n),
                Value::Null => "null".into(),
                other => other.to_json(),
            };
            Part::Text {
                name: name.clone(),
                value,
            }
        })
        .collect()
}

/// The boundary of a seed (`multipartBoundary`).
pub fn multipart_boundary(seed: u32) -> String {
    format!("----RepackshotBoundary{seed:08x}")
}

/// The bytes of a multipart form (RFC 7578), files as `image/png`.
pub fn multipart_bytes(parts: &[Part], files: &[(&str, &[u8])], boundary: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let clean = |n: &str| n.replace(['"', '\r', '\n'], "_");
    for p in parts {
        match p {
            Part::File { name, what } => {
                out.extend_from_slice(
                    format!(
                        "--{boundary}\r\nContent-Disposition: form-data; name=\"{}\"; filename=\"{what}.png\"\r\nContent-Type: image/png\r\n\r\n",
                        clean(name)
                    )
                    .as_bytes(),
                );
                if let Some((_, bytes)) = files.iter().find(|(k, _)| k == what) {
                    out.extend_from_slice(bytes);
                }
                out.extend_from_slice(b"\r\n");
            }
            Part::Text { name, value } => out.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{value}\r\n",
                    clean(name)
                )
                .as_bytes(),
            ),
        }
    }
    out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    out
}

// ------------------------------------------------------------------ the answer

/// The value at a dotted path (`atPath`).
pub fn at_path<'a>(doc: &'a Value, path: &str) -> Option<&'a Value> {
    let mut at = doc;
    for key in path.split('.') {
        at = match at {
            Value::Array(items) => {
                if key.is_empty() || !key.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                items.get(key.parse::<usize>().ok()?)?
            }
            Value::Object(_) => at.get(key)?,
            _ => return None,
        };
    }
    Some(at)
}

/// The base64 of an image value: a data URI's payload or the value itself (`base64Of`).
pub fn base64_of(value: &str) -> Option<String> {
    let s = value.trim();
    let body = if s.len() > 5 && s[..5].eq_ignore_ascii_case("data:") {
        let comma = s.find(',')?;
        let head = s[5..comma].to_ascii_lowercase();
        if !head.starts_with("image/") || !head.ends_with(";base64") {
            return None;
        }
        &s[comma + 1..]
    } else {
        s
    };
    let clean: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    let core = clean.trim_end_matches('=');
    let ok = !clean.is_empty()
        && clean.len() - core.len() <= 2
        && core
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"+/_-".contains(&b));
    ok.then_some(clean)
}

/// What kind of picture some bytes are (`pictureKind`).
pub fn picture_kind(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        "PNG"
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        "JPEG"
    } else if bytes.len() >= 10 && bytes.starts_with(b"RI") && &bytes[8..10] == b"WE" {
        "WEBP"
    } else if bytes.starts_with(b"GIF") {
        "GIF"
    } else {
        "OTHER"
    }
}

/// The failure an HTTP status means (`statusError`).
pub fn status_error(status: u16) -> Option<&'static str> {
    Some(match status {
        200..=299 => return None,
        300..=399 => "api-redirect",
        401 | 403 => "api-auth",
        408 => "api-timeout",
        413 => "api-too-large",
        429 => "api-rate-limit",
        500.. => "api-server",
        _ => "api-refused",
    })
}

/// Whether the same call may be tried again (`retryable`).
pub fn retryable(code: &str) -> bool {
    matches!(
        code,
        "api-rate-limit" | "api-timeout" | "api-network" | "api-server"
    )
}

/// Seconds before try `next` (`retryWait`); None: not tried again.
pub fn retry_wait(next: u32, retry_after: Option<&str>) -> Option<u32> {
    if let Some(r) = retry_after
        .map(str::trim)
        .filter(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_digit()))
    {
        let n: u64 = r.parse().unwrap_or(u64::MAX);
        return (n <= u64::from(MAX_RETRY_WAIT)).then_some(n as u32);
    }
    Some(MAX_RETRY_WAIT.min(1u32 << next.saturating_sub(2).min(5)))
}

/// The key's mask (`maskKey`).
pub fn mask_key(key: &str) -> String {
    let n = key.chars().count();
    if n >= 12 {
        let last: String = key.chars().skip(n - 4).collect();
        format!("••••{last}")
    } else {
        "••••".into()
    }
}

/// A key that can travel in a header (`validKey`).
pub fn valid_key(key: &str) -> bool {
    (1..=4096).contains(&key.len())
        && key == key.trim()
        && key.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

/// The text with the key replaced by its mask (`scrub`).
pub fn scrub(text: &str, key: Option<&str>) -> String {
    match key {
        Some(k) if k.len() >= 4 => text.replace(k, &mask_key(k)),
        _ => text.to_string(),
    }
}

/// The service's own words of a failure (`serviceWords`).
pub fn service_words(body: &str, key: Option<&str>) -> String {
    fn pick(v: &Value) -> Option<String> {
        match v {
            Value::String(s) => Some(s.clone()),
            Value::Array(items) => {
                let t: Vec<&str> = items.iter().filter_map(Value::as_str).collect();
                (!t.is_empty()).then(|| t.join("; "))
            }
            Value::Object(_) => v.get("message").and_then(pick),
            _ => None,
        }
    }
    let text = json::parse(body)
        .ok()
        .and_then(|v| {
            ["message", "error", "errors", "detail"]
                .iter()
                .find_map(|k| v.get(k).and_then(pick))
        })
        .unwrap_or_else(|| body.to_string());
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = flat.chars().take(300).collect();
    scrub(&cut, key)
}

// ------------------------------------------------------------------ the size sent

/// How a tile is sent (`TileFit`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fit {
    /// The canvas sent.
    pub width: u32,
    /// The canvas sent.
    pub height: u32,
    /// Where the tile is in it.
    pub x: u32,
    /// Where the tile is in it.
    pub y: u32,
    /// The tile's size in it.
    pub w: u32,
    /// The tile's size in it.
    pub h: u32,
}

/// `Math.round` of a non-negative double (halves up).
fn round_half_up(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// The size a tile is sent at (`fitTile`).
pub fn fit_tile(tw: u32, th: u32, max_side: u32, multiple_of: u32, sizes: &[(u32, u32)]) -> Fit {
    if let Some(&first) = sizes.first() {
        let shape = (f64::from(tw) / f64::from(th)).ln();
        let off = |s: (u32, u32)| ((f64::from(s.0) / f64::from(s.1)).ln() - shape).abs();
        let mut best = first;
        for &s in sizes {
            if off(s) < off(best) - 1e-9 {
                best = s;
            }
        }
        let (cw, ch) = best;
        let k = (f64::from(cw) / f64::from(tw)).min(f64::from(ch) / f64::from(th));
        let w = (round_half_up(f64::from(tw) * k) as u32).clamp(1, cw);
        let h = (round_half_up(f64::from(th) * k) as u32).clamp(1, ch);
        return Fit {
            width: cw,
            height: ch,
            x: (cw - w) / 2,
            y: (ch - h) / 2,
            w,
            h,
        };
    }
    let q = multiple_of.max(1);
    let k = (f64::from(max_side) / f64::from(tw.max(th))).min(1.0);
    let down = |n: u32| (((f64::from(n) * k) / f64::from(q)).floor() as u32 * q).max(q);
    let width = if k == 1.0 && tw.is_multiple_of(q) {
        tw
    } else {
        down(tw)
    };
    let height = if k == 1.0 && th.is_multiple_of(q) {
        th
    } else {
        down(th)
    };
    Fit {
        width,
        height,
        x: 0,
        y: 0,
        w: width,
        h: height,
    }
}

/// Bilinear resampling of `channels`-byte pixels (`resampleRgb`).
pub fn resample(src: &[u8], sw: u32, sh: u32, channels: usize, dw: u32, dh: u32) -> Vec<u8> {
    if (sw, sh) == (dw, dh) {
        return src.to_vec();
    }
    let mut out = vec![0u8; dw as usize * dh as usize * channels];
    let sx = f64::from(sw) / f64::from(dw);
    let sy = f64::from(sh) / f64::from(dh);
    let at = |x: usize, y: usize, c: usize| f64::from(src[(y * sw as usize + x) * channels + c]);
    for y in 0..dh as usize {
        let fy = ((y as f64 + 0.5) * sy - 0.5).clamp(0.0, f64::from(sh - 1));
        let y0 = fy.floor() as usize;
        let y1 = (y0 + 1).min(sh as usize - 1);
        let wy = fy - y0 as f64;
        for x in 0..dw as usize {
            let fx = ((x as f64 + 0.5) * sx - 0.5).clamp(0.0, f64::from(sw - 1));
            let x0 = fx.floor() as usize;
            let x1 = (x0 + 1).min(sw as usize - 1);
            let wx = fx - x0 as f64;
            for c in 0..channels {
                let top = at(x0, y0, c) * (1.0 - wx) + at(x1, y0, c) * wx;
                let bottom = at(x0, y1, c) * (1.0 - wx) + at(x1, y1, c) * wx;
                out[(y * dw as usize + x) * channels + c] =
                    round_half_up(top * (1.0 - wy) + bottom * wy) as u8;
            }
        }
    }
    out
}

/// The tile as sent (`toCanvas`): scaled into the fit, the canvas filled with its nearest edge.
pub fn to_canvas(src: &[u8], tw: u32, th: u32, channels: usize, fit: &Fit) -> Vec<u8> {
    let inner = resample(src, tw, th, channels, fit.w, fit.h);
    if (fit.w, fit.h) == (fit.width, fit.height) {
        return inner;
    }
    let mut out = vec![0u8; fit.width as usize * fit.height as usize * channels];
    for y in 0..fit.height {
        let iy = y.saturating_sub(fit.y).min(fit.h - 1);
        for x in 0..fit.width {
            let ix = x.saturating_sub(fit.x).min(fit.w - 1);
            let from = (iy as usize * fit.w as usize + ix as usize) * channels;
            let to = (y as usize * fit.width as usize + x as usize) * channels;
            out[to..to + channels].copy_from_slice(&inner[from..from + channels]);
        }
    }
    out
}

/// The answer back at the tile's size (`fromCanvas`).
pub fn from_canvas(answer: &Rgb8Image, fit: &Fit, tw: u32, th: u32) -> Rgb8Image {
    let canvas = resample(
        &answer.rgb,
        answer.width,
        answer.height,
        3,
        fit.width,
        fit.height,
    );
    let part = if (fit.w, fit.h) != (fit.width, fit.height) {
        let mut p = Vec::with_capacity(fit.w as usize * fit.h as usize * 3);
        for y in 0..fit.h as usize {
            let start = ((fit.y as usize + y) * fit.width as usize + fit.x as usize) * 3;
            p.extend_from_slice(&canvas[start..start + fit.w as usize * 3]);
        }
        p
    } else {
        canvas
    };
    Rgb8Image {
        width: tw,
        height: th,
        rgb: resample(&part, fit.w, fit.h, 3, tw, th),
    }
}

/// Whether an answer's size is within reason (`answerSizeOk`).
pub fn answer_size_ok(width: u32, height: u32, fit: &Fit) -> bool {
    width >= 1
        && height >= 1
        && width <= MAX_RESULT_SIDE
        && height <= MAX_RESULT_SIDE
        && u64::from(width) * u64::from(height)
            <= MAX_RESULT_PIXEL_RATIO * u64::from(fit.width) * u64::from(fit.height)
}

// ------------------------------------------------------------------ the transport

/// One request as it goes out.
#[derive(Clone, Debug)]
pub struct HttpRequest {
    /// The URL.
    pub url: String,
    /// `POST` or `PUT`.
    pub method: String,
    /// The headers, the key's among them.
    pub headers: Vec<(String, String)>,
    /// The body.
    pub body: Vec<u8>,
    /// Plain `http` is allowed (the host is this computer).
    pub allow_http: bool,
}

/// An answer.
#[derive(Clone, Debug, Default)]
pub struct HttpResponse {
    /// The HTTP status.
    pub status: u16,
    /// Its headers, names in lower case.
    pub headers: Vec<(String, String)>,
    /// Its body.
    pub body: Vec<u8>,
}

impl HttpResponse {
    /// A header's value.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// Why no answer came.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransportError {
    /// Past the time limit.
    Timeout,
    /// No connection, a cut, a certificate refused…: in words.
    Network(String),
    /// The answer is larger than allowed.
    Oversize,
    /// Stopped.
    Cancelled,
}

/// How requests are sent.
pub trait Transport: Send + Sync {
    /// Sends one request.
    fn send(
        &self,
        req: &HttpRequest,
        timeout: Duration,
        max_bytes: usize,
        cancel: &AtomicBool,
    ) -> Result<HttpResponse, TransportError>;
}

/// The system's `curl` (the program of [`super::download::Downloader::system`]).
pub struct Curl {
    /// The program.
    pub program: Option<PathBuf>,
    /// Where the body and the answer's headers go during a call (removed after it).
    pub scratch: PathBuf,
    counter: AtomicU32,
}

impl Curl {
    /// `curl` writing its scratch files in `scratch`.
    pub fn new(program: Option<PathBuf>, scratch: PathBuf) -> Curl {
        Curl {
            program,
            scratch,
            counter: AtomicU32::new(0),
        }
    }
}

/// A value of `curl`'s configuration, quoted.
fn quoted(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `curl`'s configuration for a request: the key's header is in it, so it only ever goes
/// through `curl`'s standard input.
pub fn curl_config(
    req: &HttpRequest,
    body: &Path,
    headers: &Path,
    timeout: Duration,
    max_bytes: usize,
) -> String {
    let proto = if req.allow_http {
        "=http,https"
    } else {
        "=https"
    };
    let mut c = String::new();
    for (k, v) in [
        ("url", req.url.as_str()),
        ("request", req.method.as_str()),
        ("proto", proto),
    ] {
        c.push_str(&format!("{k} = {}\n", quoted(v)));
    }
    for (k, v) in &req.headers {
        c.push_str(&format!("header = {}\n", quoted(&format!("{k}: {v}"))));
    }
    // An empty Expect: no `100 Continue` round trip before the body.
    c.push_str("header = \"Expect:\"\n");
    c.push_str(&format!(
        "data-binary = {}\n",
        quoted(&format!("@{}", body.display()))
    ));
    c.push_str(&format!(
        "dump-header = {}\n",
        quoted(&headers.display().to_string())
    ));
    c.push_str(&format!("max-time = \"{}\"\n", timeout.as_secs().max(1)));
    c.push_str("connect-timeout = \"30\"\n");
    c.push_str(&format!("max-filesize = \"{max_bytes}\"\n"));
    c.push_str("globoff\nsilent\nshow-error\n");
    c
}

/// The status and headers of the last answer in a `--dump-header` file (a `100 Continue` may
/// come first).
pub fn parse_headers(text: &str) -> Option<(u16, Vec<(String, String)>)> {
    let block = text
        .split("\r\n\r\n")
        .flat_map(|b| b.split("\n\n"))
        .filter(|b| b.trim_start().starts_with("HTTP/"))
        .last()?;
    let mut lines = block.lines();
    let status = lines
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse::<u16>()
        .ok()?;
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    Some((status, headers))
}

impl Transport for Curl {
    fn send(
        &self,
        req: &HttpRequest,
        timeout: Duration,
        max_bytes: usize,
        cancel: &AtomicBool,
    ) -> Result<HttpResponse, TransportError> {
        let Some(program) = &self.program else {
            return Err(TransportError::Network(
                "there is no curl on this computer".into(),
            ));
        };
        std::fs::create_dir_all(&self.scratch)
            .map_err(|e| TransportError::Network(e.to_string()))?;
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let stem = format!("call-{}-{n}", std::process::id());
        let body_path = self.scratch.join(format!("{stem}.body"));
        let head_path = self.scratch.join(format!("{stem}.headers"));
        struct Cleanup<'a>(&'a Path, &'a Path);
        impl Drop for Cleanup<'_> {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(self.0);
                let _ = std::fs::remove_file(self.1);
            }
        }
        let _cleanup = Cleanup(&body_path, &head_path);
        std::fs::write(&body_path, &req.body)
            .map_err(|e| TransportError::Network(e.to_string()))?;
        let mut cmd = Command::new(program);
        cmd.args(["-q", "--config", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::process::no_window(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| TransportError::Network(format!("curl did not start: {e}")))?;
        let config = curl_config(req, &body_path, &head_path, timeout, max_bytes);
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(config.as_bytes());
        }
        let too_large = Arc::new(AtomicBool::new(false));
        let reader = child.stdout.take().map(|mut out| {
            let too_large = Arc::clone(&too_large);
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let mut chunk = vec![0u8; 1 << 16];
                loop {
                    match out.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => {
                            if buf.len() + n > max_bytes {
                                too_large.store(true, Ordering::Release);
                                break;
                            }
                            buf.extend_from_slice(&chunk[..n]);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                        Err(_) => break,
                    }
                }
                buf
            })
        });
        let errors = child.stderr.take().map(|mut s| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = (&mut s).take(8 << 10).read_to_end(&mut buf);
                String::from_utf8_lossy(&buf).into_owned()
            })
        });
        // `curl` keeps its own time limit; this one is a last guard against a process that hangs.
        let deadline = Instant::now() + timeout + Duration::from_secs(15);
        let status = loop {
            if cancel.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(TransportError::Cancelled);
            }
            if too_large.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(TransportError::Oversize);
            }
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) if Instant::now() > deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(TransportError::Timeout);
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(e) => return Err(TransportError::Network(e.to_string())),
            }
        };
        let body = reader.and_then(|r| r.join().ok()).unwrap_or_default();
        let stderr = errors.and_then(|e| e.join().ok()).unwrap_or_default();
        if too_large.load(Ordering::Acquire) {
            return Err(TransportError::Oversize);
        }
        match status.code() {
            Some(0) => {}
            Some(28) => return Err(TransportError::Timeout),
            Some(63) => return Err(TransportError::Oversize),
            code => {
                return Err(TransportError::Network(super::download::curl_error(
                    code, &stderr,
                )));
            }
        }
        let head = std::fs::read_to_string(&head_path).unwrap_or_default();
        let (status, headers) = parse_headers(&head).ok_or_else(|| {
            TransportError::Network("the service's answer has no HTTP status".into())
        })?;
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

// ------------------------------------------------------------------ the backend

/// The remote API as the pipeline's model ([`ModelBackend`]).
pub struct RemoteApi {
    spec: RemoteSpec,
    key: Option<String>,
    transport: Arc<dyn Transport>,
    runtime: String,
    /// Requests made (tries included).
    pub calls: AtomicU32,
    /// Waits between tries, in place of the real ones (the tests).
    pub sleep: fn(Duration),
}

fn png_b64(width: u32, height: u32, rgb: &[u8]) -> (Vec<u8>, String) {
    let bytes = rt_core::png::encode(width, height, rgb);
    let text = b64::encode(&bytes);
    (bytes, text)
}

/// The image an answer holds, PNG bytes (`imageOfAnswer`).
pub fn image_of_answer(
    e: &Endpoint,
    body: &[u8],
    content_type: Option<&str>,
) -> Result<Vec<u8>, RemoteError> {
    let format = |message: String, detail: &str| RemoteError {
        detail: detail.to_string(),
        ..RemoteError::new("api-format", message)
    };
    let bytes = match e.answer {
        AnswerKind::Image => body.to_vec(),
        AnswerKind::Json => {
            let doc = std::str::from_utf8(body)
                .ok()
                .and_then(|t| json::parse(t).ok())
                .ok_or_else(|| {
                    format(
                        format!(
                            "the answer is not JSON{}",
                            content_type.map(|c| format!(" ({c})")).unwrap_or_default()
                        ),
                        "json",
                    )
                })?;
            let text = at_path(&doc, &e.answer_path)
                .and_then(Value::as_str)
                .and_then(base64_of)
                .ok_or_else(|| {
                    format(
                        format!("no image at '{}' in the answer", e.answer_path),
                        "path",
                    )
                })?;
            let standard: String = text
                .chars()
                .map(|c| match c {
                    '-' => '+',
                    '_' => '/',
                    c => c,
                })
                .collect();
            let padded = format!("{standard}{}", "=".repeat((4 - standard.len() % 4) % 4));
            b64::decode(&padded).ok_or_else(|| {
                format(
                    format!("the value at '{}' is not base64", e.answer_path),
                    "base64",
                )
            })?
        }
    };
    let kind = picture_kind(&bytes);
    if kind != "PNG" {
        let what = if kind == "OTHER" {
            "not a picture"
        } else {
            kind
        };
        return Err(format(format!("the image is {what}, not PNG"), kind));
    }
    Ok(bytes)
}

impl RemoteApi {
    /// The backend of a post.
    pub fn new(spec: RemoteSpec, key: Option<String>, transport: Arc<dyn Transport>) -> RemoteApi {
        let runtime = format!("api:{}", spec.host);
        RemoteApi {
            spec,
            key,
            transport,
            runtime,
            calls: AtomicU32::new(0),
            sleep: std::thread::sleep,
        }
    }

    /// The request of one pass (the key in its header, when there is one).
    pub fn request(&self, values: &Values, files: &[(&str, &[u8])], seed: u32) -> HttpRequest {
        let e = &self.spec.endpoint;
        let mut headers = e.headers.clone();
        if let (false, Some(k)) = (e.auth_header.is_empty(), &self.key) {
            headers.push((e.auth_header.clone(), format!("{}{k}", e.auth_prefix)));
        }
        let body = match e.body {
            BodyKind::Json => {
                headers.push(("Content-Type".into(), "application/json".into()));
                fill_json(&e.template, values).to_json().into_bytes()
            }
            BodyKind::Multipart => {
                let parts = fill_multipart(&e.template, values);
                let texts: String = parts
                    .iter()
                    .map(|p| match p {
                        Part::Text { value, .. } => value.as_str(),
                        Part::File { .. } => "",
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                let mut boundary = multipart_boundary(seed);
                let mut n = 1u32;
                while texts.contains(&boundary) {
                    boundary = multipart_boundary(seed.wrapping_add(n));
                    n += 1;
                }
                headers.push((
                    "Content-Type".into(),
                    format!("multipart/form-data; boundary={boundary}"),
                ));
                multipart_bytes(&parts, files, &boundary)
            }
        };
        HttpRequest {
            url: e.url.clone(),
            method: e.method.clone(),
            headers,
            body,
            allow_http: is_loopback(&self.spec.host),
        }
    }

    /// One try: the answer as the tile's image, or why not, with the service's Retry-After.
    fn once(
        &self,
        req: &HttpRequest,
        fit: &Fit,
        tw: u32,
        th: u32,
        cancel: &AtomicBool,
    ) -> Result<Rgb8Image, (RemoteError, Option<String>)> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        let key = self.key.as_deref();
        let timeout = Duration::from_secs(u64::from(self.spec.options.timeout_seconds));
        let res = match self
            .transport
            .send(req, timeout, MAX_RESPONSE_BYTES, cancel)
        {
            Ok(r) => r,
            Err(TransportError::Cancelled) => {
                return Err((RemoteError::new("cancelled", "cancelled"), None))
            }
            Err(TransportError::Timeout) => {
                return Err((
                    RemoteError::new(
                        "api-timeout",
                        format!("no answer within {} s", timeout.as_secs()),
                    ),
                    None,
                ))
            }
            Err(TransportError::Oversize) => {
                return Err((
                    RemoteError::new(
                        "api-oversize",
                        format!("the answer is larger than {MAX_RESPONSE_BYTES} bytes"),
                    ),
                    None,
                ))
            }
            Err(TransportError::Network(m)) => {
                return Err((RemoteError::new("api-network", scrub(&m, key)), None))
            }
        };
        let with_status = |mut e: RemoteError| {
            e.status = Some(res.status);
            e
        };
        if let Some(code) = status_error(res.status) {
            let words = service_words(
                &String::from_utf8_lossy(&res.body[..res.body.len().min(4096)]),
                key,
            );
            let e = RemoteError {
                detail: words,
                ..with_status(RemoteError::new(code, format!("HTTP {}", res.status)))
            };
            return Err((e, res.header("retry-after").map(str::to_string)));
        }
        let png_bytes = image_of_answer(&self.spec.endpoint, &res.body, res.header("content-type"))
            .map_err(|e| (with_status(e), None))?;
        let head = png::header(&png_bytes).map_err(|e| {
            (
                with_status(RemoteError {
                    detail: "png".into(),
                    ..RemoteError::new("api-format", e.to_string())
                }),
                None,
            )
        })?;
        if !answer_size_ok(head.width, head.height, fit) {
            let e = RemoteError {
                detail: format!("{}x{}", head.width, head.height),
                ..RemoteError::new(
                    "api-oversize",
                    format!(
                        "an image of {}×{} for {}×{} sent",
                        head.width, head.height, fit.width, fit.height
                    ),
                )
            };
            return Err((with_status(e), None));
        }
        let img = png::decode(
            &png_bytes,
            MAX_RESULT_PIXEL_RATIO * u64::from(fit.width) * u64::from(fit.height),
        )
        .map_err(|e| {
            (
                with_status(RemoteError {
                    detail: "png".into(),
                    ..RemoteError::new("api-format", e.to_string())
                }),
                None,
            )
        })?;
        let answer = Rgb8Image {
            width: img.width,
            height: img.height,
            rgb: png::rgb_of(&img),
        };
        Ok(from_canvas(&answer, fit, tw, th))
    }
}

impl ModelBackend for RemoteApi {
    fn runtime(&self) -> &str {
        &self.runtime
    }

    fn is_remote(&self) -> bool {
        true
    }

    fn wants_passes(&self) -> bool {
        self.spec.options.send_passes
    }

    fn run(
        &self,
        pass: &TilePass<'_>,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Rgb8Image, BackendError> {
        let e = &self.spec.endpoint;
        let (tw, th) = (pass.input.width, pass.input.height);
        let fit = fit_tile(tw, th, e.max_side, e.multiple_of, &e.sizes);
        let (image_png, image_b64) = png_b64(
            fit.width,
            fit.height,
            &to_canvas(&pass.input.rgb, tw, th, 3, &fit),
        );
        let mut values = Values {
            prompt: pass.prompt.to_string(),
            negative: pass.negative.to_string(),
            strength: f64::from(pass.strength),
            seed: pass.seed,
            width: fit.width,
            height: fit.height,
            image: image_b64,
            depth: None,
            edges: None,
        };
        let mut pass_files: Vec<(&str, Vec<u8>)> = Vec::new();
        if self.spec.options.send_passes {
            if let Some((edges, depth)) = pass.passes {
                for (name, plane) in [("depth", depth), ("edges", edges)] {
                    let grey = to_canvas(plane, tw, th, 1, &fit);
                    let rgb: Vec<u8> = grey.iter().flat_map(|&g| [g, g, g]).collect();
                    let (bytes, text) = png_b64(fit.width, fit.height, &rgb);
                    if name == "depth" {
                        values.depth = Some(text);
                    } else {
                        values.edges = Some(text);
                    }
                    pass_files.push((name, bytes));
                }
            }
        }
        let mut files: Vec<(&str, &[u8])> = vec![("image", &image_png)];
        files.extend(pass_files.iter().map(|(k, b)| (*k, b.as_slice())));
        let req = self.request(&values, &files, pass.seed.wrapping_add(pass.tile));
        progress(Progress {
            stage: Stage::Inference,
            step: 0,
            steps: 1,
        });
        let tries = self.spec.options.attempts.max(1);
        let mut n = 1u32;
        loop {
            match self.once(&req, &fit, tw, th, cancel) {
                Ok(img) => {
                    progress(Progress {
                        stage: Stage::Finishing,
                        step: 1,
                        steps: 1,
                    });
                    return Ok(img);
                }
                Err((err, retry_after)) => {
                    if err.code == "cancelled" {
                        return Err(BackendError::Remote(err));
                    }
                    let wait = (n < tries && retryable(err.code))
                        .then(|| retry_wait(n + 1, retry_after.as_deref()))
                        .flatten();
                    let Some(wait) = wait else {
                        return Err(BackendError::Remote(RemoteError { attempts: n, ..err }));
                    };
                    crate::log!(
                        "AI API {}: try {n} of {tries} failed ({}), again in {wait} s",
                        self.spec.host,
                        err.code
                    );
                    // The wait listens for a stop.
                    let until = Instant::now() + Duration::from_secs(u64::from(wait));
                    while Instant::now() < until {
                        if cancel.load(Ordering::Acquire) {
                            return Err(BackendError::Remote(RemoteError::new(
                                "cancelled",
                                "cancelled",
                            )));
                        }
                        (self.sleep)(
                            Duration::from_millis(50)
                                .min(until.saturating_duration_since(Instant::now())),
                        );
                    }
                    n += 1;
                }
            }
        }
    }
}

// ------------------------------------------------------------------ the keys

/// The API keys of this computer: `<data>/ai/api-keys.json`, one per host, readable only by the
/// user (0600 where the system has such modes). Never logged; the page can store and forget one
/// and list them masked, never read one back.
pub struct ApiKeys {
    path: PathBuf,
    guard: Mutex<()>,
}

impl ApiKeys {
    /// The store of `<data>/ai`.
    pub fn new(ai_root: &Path) -> ApiKeys {
        ApiKeys {
            path: ai_root.join("api-keys.json"),
            guard: Mutex::new(()),
        }
    }

    /// Where it is.
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn read(&self) -> Vec<(String, String)> {
        let Ok(text) = std::fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        match json::parse(&text).ok().as_ref().and_then(|v| v.get("keys")) {
            Some(Value::Object(members)) => members
                .iter()
                .filter_map(|(h, k)| {
                    let k = k.as_str()?;
                    (valid_key(k) && host_of(&format!("https://{h}/")).as_deref() == Some(h))
                        .then(|| (h.clone(), k.to_string()))
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    fn write(&self, keys: &[(String, String)]) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut obj = json::Object::new();
        for (h, k) in keys {
            obj = obj.str(h, k);
        }
        let text = format!("{{\"keys\":{}}}", obj.build());
        let tmp = self.path.with_extension("json.tmp");
        {
            let mut opts = std::fs::OpenOptions::new();
            opts.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut f = opts.open(&tmp)?;
            f.write_all(text.as_bytes())?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &self.path)
    }

    /// The hosts with a key, and its mask.
    pub fn list(&self) -> Vec<(String, String)> {
        let _g = lock(&self.guard);
        self.read()
            .into_iter()
            .map(|(h, k)| (h, mask_key(&k)))
            .collect()
    }

    /// The key of a host (only the backend asks).
    pub fn get(&self, host: &str) -> Option<String> {
        let _g = lock(&self.guard);
        self.read()
            .into_iter()
            .find(|(h, _)| h == host)
            .map(|(_, k)| k)
    }

    /// Stores a key for a host. The error is in words, never with the key.
    pub fn save(&self, host: &str, key: &str) -> Result<(), String> {
        if host_of(&format!("https://{host}/")).as_deref() != Some(host) {
            return Err("not a host".into());
        }
        if !valid_key(key) {
            return Err("a key is 1 to 4096 printable characters, no spaces at its ends".into());
        }
        let _g = lock(&self.guard);
        let mut keys: Vec<(String, String)> =
            self.read().into_iter().filter(|(h, _)| h != host).collect();
        keys.push((host.to_string(), key.to_string()));
        self.write(&keys).map_err(|e| e.to_string())
    }

    /// Forgets a host's key.
    pub fn forget(&self, host: &str) -> Result<(), String> {
        let _g = lock(&self.guard);
        let keys: Vec<(String, String)> =
            self.read().into_iter().filter(|(h, _)| h != host).collect();
        if keys.is_empty() {
            return match std::fs::remove_file(&self.path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            };
        }
        self.write(&keys).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_are_written_as_the_page_writes_them() {
        assert_eq!(
            host_of("https://API.Stability.ai/v2beta/x").as_deref(),
            Some("api.stability.ai")
        );
        assert_eq!(host_of("https://a.b:443/").as_deref(), Some("a.b"));
        assert_eq!(
            host_of("http://127.0.0.1:8123/x?y").as_deref(),
            Some("127.0.0.1:8123")
        );
        assert_eq!(host_of("http://[::1]:9/").as_deref(), Some("[::1]:9"));
        for bad in [
            "ftp://a.b/",
            "https://user@a.b/",
            "https://a.b/#f",
            "https://-a.b/",
            "https://a.b:0/",
            "https:///x",
        ] {
            assert_eq!(host_of(bad), None, "{bad}");
        }
        assert!(
            is_loopback("127.0.0.1:8123") && is_loopback("localhost") && is_loopback("[::1]:9")
        );
        assert!(!is_loopback("127.0.0.1.example.com") && !is_loopback("10.0.0.1"));
    }

    #[test]
    fn the_key_goes_only_through_standard_input() {
        let req = HttpRequest {
            url: "https://a.b/x".into(),
            method: "POST".into(),
            headers: vec![("Authorization".into(), "Bearer sk-SECRET\"\\".into())],
            body: Vec::new(),
            allow_http: false,
        };
        let c = curl_config(
            &req,
            Path::new("/t/b"),
            Path::new("/t/h"),
            Duration::from_secs(9),
            10,
        );
        assert!(
            c.contains("header = \"Authorization: Bearer sk-SECRET\\\"\\\\\"\n"),
            "{c}"
        );
        assert!(
            c.contains("proto = \"=https\"")
                && c.contains("max-time = \"9\"")
                && !c.contains("location")
        );
    }

    #[test]
    fn the_last_answer_of_a_header_dump_is_read() {
        let text =
            "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 429 Too Many\r\nRetry-After: 3\r\nX: y\r\n\r\n";
        let (status, headers) = parse_headers(text).unwrap();
        assert_eq!(status, 429);
        assert_eq!(headers[0], ("retry-after".to_string(), "3".to_string()));
    }

    #[test]
    fn keys_are_masked_and_never_listed_in_full() {
        let dir = std::env::temp_dir().join(format!("rt-keys-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let keys = ApiKeys::new(&dir);
        keys.save("api.example.com", "sk-0123456789abcdef").unwrap();
        assert_eq!(
            keys.list(),
            vec![("api.example.com".to_string(), "••••cdef".to_string())]
        );
        assert_eq!(
            keys.get("api.example.com").as_deref(),
            Some("sk-0123456789abcdef")
        );
        assert!(keys.save("api.example.com/x", "k").is_err());
        assert!(keys.save("a.b", " k").is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(keys.path()).unwrap().permissions().mode();
            assert_eq!(mode & 0o077, 0, "{mode:o}");
        }
        keys.forget("api.example.com").unwrap();
        assert!(keys.list().is_empty() && !keys.path().exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    const CASES: &str = include_str!("../../../../../tests/fixtures/ai-remote-cases.json");

    fn cases() -> Value {
        json::parse(CASES).unwrap()
    }

    fn list<'a>(v: &'a Value, k: &str) -> &'a [Value] {
        v.get(k).and_then(Value::as_array).unwrap()
    }

    fn num(v: &Value, k: &str) -> u32 {
        v.get(k).and_then(Value::as_f64).unwrap() as u32
    }

    fn pair(v: &Value) -> (u32, u32) {
        let a = v.as_array().unwrap();
        (a[0].as_f64().unwrap() as u32, a[1].as_f64().unwrap() as u32)
    }

    /// A JSON value as the page's `JSON.stringify` writes it, members in order (numbers compared as numbers).
    fn same(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => x == y,
            (Value::Array(x), Value::Array(y)) => {
                x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
            }
            (Value::Object(x), Value::Object(y)) => {
                x.len() == y.len() && x.iter().zip(y).all(|((k, p), (l, q))| k == l && same(p, q))
            }
            _ => a == b,
        }
    }

    #[test]
    fn the_shared_cases_give_what_the_page_gives() {
        let c = cases();
        for h in list(&c, "hosts") {
            let url = h.get("url").and_then(Value::as_str).unwrap();
            let want = h.get("host").and_then(Value::as_str);
            let got = host_of(url);
            assert_eq!(got.as_deref(), want, "{url}");
            if let Some(g) = &got {
                assert_eq!(
                    is_loopback(g),
                    h.get("loopback").and_then(Value::as_bool).unwrap(),
                    "{url}"
                );
            }
        }
        for f in list(&c, "fill") {
            let v = f.get("values").unwrap();
            let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap().to_string();
            let values = Values {
                prompt: s("prompt"),
                negative: s("negative"),
                strength: v.get("strength").and_then(Value::as_f64).unwrap(),
                seed: num(v, "seed"),
                width: num(v, "width"),
                height: num(v, "height"),
                image: s("image"),
                depth: Some(s("depth")),
                edges: Some(s("edges")),
            };
            let template = f.get("template").unwrap();
            let want = f.get("expect").unwrap();
            if f.get("body").and_then(Value::as_str) == Some("JSON") {
                let got = fill_json(template, &values);
                assert!(same(&got, want), "{}\n{}", got.to_json(), want.to_json());
            } else {
                let got = fill_multipart(template, &values);
                let want: Vec<Part> = want
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| {
                        let name = p.get("name").and_then(Value::as_str).unwrap().to_string();
                        match p.get("kind").and_then(Value::as_str) {
                            Some("file") => Part::File {
                                name,
                                what: FILES
                                    .iter()
                                    .find(|f| Some(**f) == p.get("what").and_then(Value::as_str))
                                    .unwrap(),
                            },
                            _ => Part::Text {
                                name,
                                value: p.get("value").and_then(Value::as_str).unwrap().to_string(),
                            },
                        }
                    })
                    .collect();
                assert_eq!(got, want);
            }
        }
        for p in list(&c, "paths") {
            let got = at_path(
                p.get("doc").unwrap(),
                p.get("path").and_then(Value::as_str).unwrap(),
            );
            let want = p.get("expect").unwrap();
            assert_eq!(got.unwrap_or(&Value::Null), want, "{}", p.to_json());
        }
        for b in list(&c, "base64") {
            let got = base64_of(b.get("value").and_then(Value::as_str).unwrap());
            assert_eq!(
                got.as_deref(),
                b.get("expect").and_then(Value::as_str),
                "{}",
                b.to_json()
            );
        }
        for st in list(&c, "status") {
            let code = status_error(num(st, "status") as u16);
            assert_eq!(
                code,
                st.get("code").and_then(Value::as_str),
                "{}",
                st.to_json()
            );
            assert_eq!(
                code.is_some_and(retryable),
                st.get("retryable").and_then(Value::as_bool).unwrap()
            );
        }
        for w in list(&c, "waits") {
            let got = retry_wait(num(w, "next"), w.get("retryAfter").and_then(Value::as_str));
            assert_eq!(
                got.map(f64::from),
                w.get("expect").and_then(Value::as_f64),
                "{}",
                w.to_json()
            );
        }
        for f in list(&c, "fits") {
            let (tw, th) = pair(f.get("tile").unwrap());
            let sizes: Vec<(u32, u32)> = list(f, "sizes").iter().map(pair).collect();
            let got = fit_tile(tw, th, num(f, "maxSide"), num(f, "multipleOf"), &sizes);
            let e = f.get("expect").unwrap();
            let want = Fit {
                width: num(e, "width"),
                height: num(e, "height"),
                x: num(e, "x"),
                y: num(e, "y"),
                w: num(e, "w"),
                h: num(e, "h"),
            };
            assert_eq!(got, want, "{}", f.to_json());
        }
        for k in list(&c, "keys") {
            let key = k.get("key").and_then(Value::as_str).unwrap();
            assert_eq!(
                mask_key(key),
                k.get("mask").and_then(Value::as_str).unwrap(),
                "{key}"
            );
            assert_eq!(
                valid_key(key),
                k.get("valid").and_then(Value::as_bool).unwrap(),
                "{key}"
            );
        }
        for p in list(&c, "problems") {
            // The endpoint as the page sends it, read field by field without the checks.
            let e = p.get("endpoint").unwrap();
            let o = p.get("options").unwrap();
            let t = |k: &str| e.get(k).and_then(Value::as_str).unwrap().to_string();
            let endpoint = Endpoint {
                url: t("url"),
                method: t("method"),
                auth_header: t("authHeader"),
                auth_prefix: t("authPrefix"),
                headers: match e.get("headers") {
                    Some(Value::Object(m)) => m
                        .iter()
                        .map(|(k, x)| (k.clone(), x.as_str().unwrap().to_string()))
                        .collect(),
                    _ => Vec::new(),
                },
                body: if t("body") == "JSON" {
                    BodyKind::Json
                } else {
                    BodyKind::Multipart
                },
                template: json::parse(&t("template")).unwrap_or(Value::Null),
                answer: if t("response") == "JSON" {
                    AnswerKind::Json
                } else {
                    AnswerKind::Image
                },
                answer_path: t("responsePath"),
                max_side: num(e, "maxSide"),
                multiple_of: num(e, "multipleOf"),
                sizes: list(e, "sizes").iter().map(pair).collect(),
            };
            let options = CallOptions {
                send_passes: o.get("sendPasses").and_then(Value::as_bool).unwrap(),
                timeout_seconds: num(o, "timeoutSeconds"),
                attempts: num(o, "attempts"),
            };
            let want: Vec<&str> = list(p, "expect")
                .iter()
                .map(|x| x.as_str().unwrap())
                .collect();
            assert_eq!(
                endpoint_problems(&endpoint, &options),
                want,
                "{}",
                p.to_json()
            );
        }
        for w in list(&c, "words") {
            let got = service_words(
                w.get("body").and_then(Value::as_str).unwrap(),
                w.get("key").and_then(Value::as_str),
            );
            assert_eq!(got, w.get("expect").and_then(Value::as_str).unwrap());
        }
    }

    #[test]
    fn a_tile_that_already_fits_goes_and_comes_back_unchanged() {
        let rgb: Vec<u8> = (0..96 * 64 * 3).map(|i| (i * 7 % 251) as u8).collect();
        let fit = fit_tile(96, 64, 1024, 16, &[]);
        let sent = to_canvas(&rgb, 96, 64, 3, &fit);
        assert_eq!(sent, rgb);
        let back = from_canvas(
            &Rgb8Image {
                width: 96,
                height: 64,
                rgb: sent,
            },
            &fit,
            96,
            64,
        );
        assert_eq!(back.rgb, rgb);
        // Into a fixed size and back: the tile's part only, at its size.
        let fit = fit_tile(96, 64, 1536, 16, &[(1536, 1024)]);
        let canvas = to_canvas(&rgb, 96, 64, 3, &fit);
        assert_eq!(canvas.len(), 1536 * 1024 * 3);
        let back = from_canvas(
            &Rgb8Image {
                width: 1536,
                height: 1024,
                rgb: canvas,
            },
            &fit,
            96,
            64,
        );
        assert_eq!(
            (back.width, back.height, back.rgb.len()),
            (96, 64, rgb.len())
        );
    }
}
