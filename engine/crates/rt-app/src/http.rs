//! The HTTP/1.1 subset the launcher speaks (RFC 9112): request heads, `Content-Length` bodies
//! (no chunked requests), keep-alive, single byte ranges, and responses with a known length.

use std::io::{self, BufRead, Write};

/// Longest request line or header line, in bytes.
pub const MAX_LINE: usize = 8 * 1024;
/// Most header lines in one request.
pub const MAX_HEADERS: usize = 100;
/// Largest whole request head (request line and headers).
pub const MAX_HEAD: usize = 32 * 1024;

/// A parsed request head.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    /// The method, as sent (`GET`, `POST`...).
    pub method: String,
    /// The request target exactly as sent.
    pub target: String,
    /// The percent-decoded path, without the query.
    pub path: String,
    /// The decoded query parameters, in order.
    pub query: Vec<(String, String)>,
    /// True for HTTP/1.1, false for HTTP/1.0.
    pub http11: bool,
    /// Header fields, names in lower case, values trimmed.
    pub headers: Vec<(String, String)>,
    /// The body length (`Content-Length`, 0 when absent).
    pub content_length: u64,
}

impl Request {
    /// The value of a header field (`name` in lower case); repeated fields give the first.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// The value of a query parameter.
    pub fn query(&self, name: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// Whether the connection stays open after the response.
    pub fn keep_alive(&self) -> bool {
        let connection = self.header("connection").unwrap_or("").to_ascii_lowercase();
        let tokens = || connection.split(',').map(str::trim);
        if self.http11 {
            !tokens().any(|t| t == "close")
        } else {
            tokens().any(|t| t == "keep-alive")
        }
    }
}

/// Why a request could not be read.
#[derive(Debug)]
pub enum ReadError {
    /// The connection closed (or idled out) before a request started: not an error.
    Closed,
    /// Malformed request: answer 400 and close.
    Bad(&'static str),
    /// Head too large: answer 431 and close.
    TooLarge,
    /// A feature this server does not have (`Transfer-Encoding`): answer 501 and close.
    Unsupported(&'static str),
    /// Not HTTP/1.0 or 1.1: answer 505 and close.
    Version,
    /// The socket failed in the middle of a request.
    Io(io::Error),
}

/// Reads one line ending in LF (CRLF or bare LF), without the line ending. `Ok(None)` at a clean
/// end of input before any byte.
fn read_line<R: BufRead>(r: &mut R, limit: usize) -> Result<Option<Vec<u8>>, ReadError> {
    let mut line = Vec::new();
    loop {
        let available = match r.fill_buf() {
            Ok(buf) => buf,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e)
                if line.is_empty()
                    && matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock
                            | io::ErrorKind::TimedOut
                            | io::ErrorKind::ConnectionReset
                            | io::ErrorKind::ConnectionAborted
                    ) =>
            {
                return Ok(None)
            }
            Err(e) => return Err(ReadError::Io(e)),
        };
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(ReadError::Bad("connection closed in the middle of a line"))
            };
        }
        match available.iter().position(|&b| b == b'\n') {
            Some(i) => {
                line.extend_from_slice(&available[..i]);
                r.consume(i + 1);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if line.len() > limit {
                    return Err(ReadError::TooLarge);
                }
                return Ok(Some(line));
            }
            None => {
                let n = available.len();
                line.extend_from_slice(available);
                r.consume(n);
                if line.len() > limit {
                    return Err(ReadError::TooLarge);
                }
            }
        }
    }
}

fn is_token(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// Reads a request head. Leading empty lines are skipped (RFC 9112 §2.2).
pub fn read_request<R: BufRead>(r: &mut R) -> Result<Request, ReadError> {
    let mut total = 0usize;
    let line = loop {
        match read_line(r, MAX_LINE)? {
            None => return Err(ReadError::Closed),
            Some(l) if l.is_empty() => {
                total += 2;
                if total > MAX_HEAD {
                    return Err(ReadError::TooLarge);
                }
            }
            Some(l) => break l,
        }
    };
    total += line.len();
    let line = String::from_utf8(line).map_err(|_| ReadError::Bad("request line is not UTF-8"))?;
    let mut parts = line.split(' ');
    let (Some(method), Some(target), Some(version), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(ReadError::Bad("malformed request line"));
    };
    if !is_token(method) {
        return Err(ReadError::Bad("malformed method"));
    }
    let http11 = match version {
        "HTTP/1.1" => true,
        "HTTP/1.0" => false,
        v if v.starts_with("HTTP/") => return Err(ReadError::Version),
        _ => return Err(ReadError::Bad("malformed version")),
    };
    // Only the origin form (`/path?query`): no absolute URLs, no `*`.
    if !target.starts_with('/') || target.bytes().any(|b| b <= b' ' || b == 0x7f) {
        return Err(ReadError::Bad("malformed request target"));
    }
    let (raw_path, raw_query) = target.split_once('?').unwrap_or((target, ""));
    let path = percent_decode(raw_path, false).ok_or(ReadError::Bad("malformed path"))?;
    let query = parse_query(raw_query).ok_or(ReadError::Bad("malformed query"))?;

    let mut headers = Vec::new();
    loop {
        let l = read_line(r, MAX_LINE)?.ok_or(ReadError::Bad("connection closed in the head"))?;
        total += l.len() + 2;
        if total > MAX_HEAD {
            return Err(ReadError::TooLarge);
        }
        if l.is_empty() {
            break;
        }
        if l[0] == b' ' || l[0] == b'\t' {
            return Err(ReadError::Bad("obsolete line folding"));
        }
        if headers.len() >= MAX_HEADERS {
            return Err(ReadError::TooLarge);
        }
        let l = String::from_utf8(l).map_err(|_| ReadError::Bad("header is not UTF-8"))?;
        let (name, value) = l
            .split_once(':')
            .ok_or(ReadError::Bad("header without ':'"))?;
        if !is_token(name) {
            return Err(ReadError::Bad("malformed header name"));
        }
        let value = value.trim_matches([' ', '\t']);
        if value.bytes().any(|b| b == 0 || b == b'\r' || b == b'\n') {
            return Err(ReadError::Bad("malformed header value"));
        }
        headers.push((name.to_ascii_lowercase(), value.to_string()));
    }

    if headers.iter().any(|(n, _)| n == "transfer-encoding") {
        return Err(ReadError::Unsupported("Transfer-Encoding"));
    }
    let mut content_length = None;
    for (n, v) in &headers {
        if n == "content-length" {
            let parsed = if !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()) {
                v.parse::<u64>().ok()
            } else {
                None
            };
            let len = parsed.ok_or(ReadError::Bad("malformed Content-Length"))?;
            if content_length.is_some_and(|c| c != len) {
                return Err(ReadError::Bad("conflicting Content-Length"));
            }
            content_length = Some(len);
        }
    }
    let host_count = headers.iter().filter(|(n, _)| n == "host").count();
    if host_count > 1 || (http11 && host_count == 0) {
        return Err(ReadError::Bad("exactly one Host header is required"));
    }
    Ok(Request {
        method: method.to_string(),
        target: target.to_string(),
        path,
        query,
        http11,
        headers,
        content_length: content_length.unwrap_or(0),
    })
}

/// Percent-decodes `text` (and `+` as a space when `plus` is set). `None` for a malformed escape,
/// an encoded NUL or bytes that are not UTF-8.
pub fn percent_decode(text: &str, plus: bool) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hi = (*bytes.get(i + 1)? as char).to_digit(16)?;
                let lo = (*bytes.get(i + 2)? as char).to_digit(16)?;
                let b = (hi * 16 + lo) as u8;
                if b == 0 {
                    return None;
                }
                out.push(b);
                i += 3;
            }
            b'+' if plus => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Splits and decodes `a=1&b=2`.
pub fn parse_query(text: &str) -> Option<Vec<(String, String)>> {
    text.split('&')
        .filter(|p| !p.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            Some((percent_decode(k, true)?, percent_decode(v, true)?))
        })
        .collect()
}

/// The answer to a `Range` header for a resource of `len` bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RangeAnswer {
    /// No usable range: send the whole resource (also for several ranges or bad syntax, which a
    /// server may ignore).
    Whole,
    /// Bytes `start..=end`, a 206 with `Content-Range`.
    Partial {
        /// First byte.
        start: u64,
        /// Last byte (inclusive).
        end: u64,
    },
    /// The range starts beyond the end: 416 with `Content-Range: bytes */len`.
    Unsatisfiable,
}

/// Interprets `bytes=a-b`, `bytes=a-` and `bytes=-n` against a resource of `len` bytes.
pub fn parse_range(header: Option<&str>, len: u64) -> RangeAnswer {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return RangeAnswer::Whole;
    };
    if spec.contains(',') {
        return RangeAnswer::Whole;
    }
    let Some((a, b)) = spec.trim().split_once('-') else {
        return RangeAnswer::Whole;
    };
    let num = |s: &str| {
        if !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()) {
            s.parse::<u64>().ok()
        } else {
            None
        }
    };
    match (a.trim(), b.trim()) {
        ("", suffix) => match num(suffix) {
            Some(0) => RangeAnswer::Unsatisfiable,
            Some(n) if len == 0 => {
                let _ = n;
                RangeAnswer::Unsatisfiable
            }
            Some(n) => RangeAnswer::Partial {
                start: len.saturating_sub(n),
                end: len - 1,
            },
            None => RangeAnswer::Whole,
        },
        (first, "") => match num(first) {
            Some(start) if start < len => RangeAnswer::Partial {
                start,
                end: len - 1,
            },
            Some(_) => RangeAnswer::Unsatisfiable,
            None => RangeAnswer::Whole,
        },
        (first, last) => match (num(first), num(last)) {
            (Some(start), Some(end)) if start <= end => {
                if start >= len {
                    RangeAnswer::Unsatisfiable
                } else {
                    RangeAnswer::Partial {
                        start,
                        end: end.min(len - 1),
                    }
                }
            }
            _ => RangeAnswer::Whole,
        },
    }
}

/// The reason phrase of a status code.
pub fn reason(status: u16) -> &'static str {
    match status {
        100 => "Continue",
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        206 => "Partial Content",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        411 => "Length Required",
        413 => "Content Too Large",
        416 => "Range Not Satisfiable",
        421 => "Misdirected Request",
        422 => "Unprocessable Content",
        431 => "Request Header Fields Too Large",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        503 => "Service Unavailable",
        505 => "HTTP Version Not Supported",
        507 => "Insufficient Storage",
        _ => "Unknown",
    }
}

/// Writes the body of a response.
pub type Writer = Box<dyn FnOnce(&mut dyn Write) -> io::Result<()> + Send>;

/// A response body.
pub enum Body {
    /// No body.
    Empty,
    /// Bytes in memory.
    Bytes(Vec<u8>),
    /// `len` bytes produced by a writer (a file range, a frame buffer).
    Stream {
        /// Exact length the writer writes.
        len: u64,
        /// Writes the body.
        write: Writer,
    },
}

/// A response.
pub struct Response {
    /// Status code.
    pub status: u16,
    /// Header fields besides the ones [`write_response`] adds.
    pub headers: Vec<(String, String)>,
    /// The body.
    pub body: Body,
}

impl Response {
    /// A response with a body in memory.
    pub fn bytes(status: u16, content_type: &str, body: Vec<u8>) -> Response {
        Response {
            status,
            headers: vec![("Content-Type".into(), content_type.into())],
            body: Body::Bytes(body),
        }
    }

    /// A JSON response.
    pub fn json(status: u16, json: String) -> Response {
        Response::bytes(status, "application/json; charset=utf-8", json.into_bytes())
    }

    /// A JSON error `{"error": code, "message": text}`.
    pub fn error(status: u16, code: &str, message: &str) -> Response {
        Response::json(
            status,
            crate::json::Object::new()
                .str("error", code)
                .str("message", message)
                .build(),
        )
    }

    /// A plain text response.
    pub fn text(status: u16, text: &str) -> Response {
        Response::bytes(
            status,
            "text/plain; charset=utf-8",
            text.as_bytes().to_vec(),
        )
    }

    /// An empty response (204 and such).
    pub fn empty(status: u16) -> Response {
        Response {
            status,
            headers: Vec::new(),
            body: Body::Empty,
        }
    }

    /// Adds a header field.
    pub fn with(mut self, name: &str, value: &str) -> Response {
        self.headers.push((name.into(), value.into()));
        self
    }

    /// The body length.
    pub fn len(&self) -> u64 {
        match &self.body {
            Body::Empty => 0,
            Body::Bytes(b) => b.len() as u64,
            Body::Stream { len, .. } => *len,
        }
    }

    /// True when there is no body.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Headers sent with every response: no sniffing, no referrer, no framing, no cross-origin reads.
/// No CORS header is ever sent.
pub const SECURITY_HEADERS: [(&str, &str); 4] = [
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Frame-Options", "DENY"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
];

/// Writes `response` (its body unless `head_only`) and flushes.
pub fn write_response(
    w: &mut dyn Write,
    response: Response,
    head_only: bool,
    keep_alive: bool,
) -> io::Result<()> {
    let len = response.len();
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nServer: repackshot\r\nContent-Length: {len}\r\nConnection: {}\r\n",
        response.status,
        reason(response.status),
        if keep_alive { "keep-alive" } else { "close" }
    );
    for (n, v) in SECURITY_HEADERS {
        head.push_str(&format!("{n}: {v}\r\n"));
    }
    for (n, v) in &response.headers {
        head.push_str(&format!("{n}: {v}\r\n"));
    }
    head.push_str("\r\n");
    w.write_all(head.as_bytes())?;
    if !head_only {
        match response.body {
            Body::Empty => {}
            Body::Bytes(b) => w.write_all(&b)?,
            Body::Stream { write, .. } => write(w)?,
        }
    }
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufReader;

    fn read(text: &str) -> Result<Request, ReadError> {
        read_request(&mut BufReader::new(text.as_bytes()))
    }

    #[test]
    fn parses_a_request_head() {
        let r = read("GET /api/render/7?after=3&data=0&x=a%20b+c HTTP/1.1\r\nHost: 127.0.0.1:8080\r\nX-Repackshot-Token:  abc \r\nContent-Length: 12\r\n\r\nbody").unwrap();
        assert_eq!(r.method, "GET");
        assert_eq!(r.path, "/api/render/7");
        assert_eq!(r.query("after"), Some("3"));
        assert_eq!(r.query("x"), Some("a b c"));
        assert_eq!(r.header("x-repackshot-token"), Some("abc"));
        assert_eq!(r.header("host"), Some("127.0.0.1:8080"));
        assert_eq!(r.content_length, 12);
        assert!(r.http11 && r.keep_alive());
        // Bare LF line endings and leading empty lines are tolerated.
        let r = read("\r\n\nPUT /a%C3%A9 HTTP/1.0\nHost: x\nConnection: keep-alive\n\n").unwrap();
        assert_eq!(r.path, "/aé");
        assert!(!r.http11 && r.keep_alive());
        let r = read("GET / HTTP/1.1\r\nHost: x\r\nConnection: Close\r\n\r\n").unwrap();
        assert!(!r.keep_alive());
        assert!(!read("GET / HTTP/1.0\r\n\r\n").unwrap().keep_alive());
    }

    #[test]
    fn rejects_bad_requests() {
        for bad in [
            "GET /\r\nHost: x\r\n\r\n",
            "GET  / HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET / HTTP/1.1 extra\r\nHost: x\r\n\r\n",
            "G(T / HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET http://evil/ HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET * HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET /%00 HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET /%zz HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET /%ff HTTP/1.1\r\nHost: x\r\n\r\n",
            "GET / HTTP/1.1\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: a\r\nHost: b\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: x\r\n folded\r\n\r\n",
            "GET / HTTP/1.1\r\nHost x\r\n\r\n",
            "GET / HTTP/1.1\r\nBad Name: x\r\nHost: x\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: x\r\nContent-Length: 1, 2\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: x\r\n",
            "GET / FTP/1.1\r\nHost: x\r\n\r\n",
        ] {
            assert!(
                matches!(read(bad), Err(ReadError::Bad(_))),
                "{bad:?} should be a bad request"
            );
        }
        // Folded lines are refused for what they are (header names would also refuse them).
        let folded = read("GET / HTTP/1.1\r\nHost: x\r\n folded: on\r\n\r\n");
        assert!(
            matches!(folded, Err(ReadError::Bad("obsolete line folding"))),
            "{folded:?}"
        );
        assert!(matches!(
            read("GET / HTTP/2.0\r\nHost: x\r\n\r\n"),
            Err(ReadError::Version)
        ));
        assert!(matches!(
            read("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n"),
            Err(ReadError::Unsupported(_))
        ));
        assert!(matches!(read(""), Err(ReadError::Closed)));
        let long = format!("GET /{} HTTP/1.1\r\nHost: x\r\n\r\n", "a".repeat(MAX_LINE));
        assert!(matches!(read(&long), Err(ReadError::TooLarge)));
        let many: String = (0..=MAX_HEADERS).map(|i| format!("X-{i}: 1\r\n")).collect();
        assert!(matches!(
            read(&format!("GET / HTTP/1.1\r\nHost: x\r\n{many}\r\n")),
            Err(ReadError::TooLarge)
        ));
        // Equal repeated lengths are allowed.
        assert_eq!(
            read("GET / HTTP/1.1\r\nHost: x\r\nContent-Length: 3\r\nContent-Length: 3\r\n\r\n")
                .unwrap()
                .content_length,
            3
        );
    }

    #[test]
    fn ranges() {
        use RangeAnswer::*;
        let r = |h: &str, len| parse_range(Some(h), len);
        assert_eq!(parse_range(None, 10), Whole);
        assert_eq!(r("bytes=0-3", 10), Partial { start: 0, end: 3 });
        assert_eq!(r("bytes=4-", 10), Partial { start: 4, end: 9 });
        assert_eq!(r("bytes=-3", 10), Partial { start: 7, end: 9 });
        assert_eq!(r("bytes=-30", 10), Partial { start: 0, end: 9 });
        assert_eq!(r("bytes=5-100", 10), Partial { start: 5, end: 9 });
        assert_eq!(r("bytes=9-9", 10), Partial { start: 9, end: 9 });
        assert_eq!(r("bytes=10-", 10), Unsatisfiable);
        assert_eq!(r("bytes=10-20", 10), Unsatisfiable);
        assert_eq!(r("bytes=-0", 10), Unsatisfiable);
        assert_eq!(r("bytes=0-", 0), Unsatisfiable);
        assert_eq!(r("bytes=-5", 0), Unsatisfiable);
        assert_eq!(r("bytes=3-1", 10), Whole);
        assert_eq!(r("bytes=0-1,4-5", 10), Whole);
        assert_eq!(r("items=0-1", 10), Whole);
        assert_eq!(r("bytes=a-b", 10), Whole);
        assert_eq!(r("bytes=1", 10), Whole);
    }

    #[test]
    fn writes_responses_with_security_headers_and_no_cors() {
        let mut out = Vec::new();
        write_response(
            &mut out,
            Response::text(404, "nope").with("Cache-Control", "no-store"),
            false,
            true,
        )
        .unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("HTTP/1.1 404 Not Found\r\n"));
        assert!(text.contains("Content-Length: 4\r\n"));
        assert!(text.contains("Connection: keep-alive\r\n"));
        assert!(text.contains("X-Content-Type-Options: nosniff\r\n"));
        assert!(text.contains("Cache-Control: no-store\r\n"));
        assert!(!text.to_ascii_lowercase().contains("access-control"));
        assert!(text.ends_with("\r\n\r\nnope"));
        let mut out = Vec::new();
        write_response(&mut out, Response::text(200, "body"), true, false).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("Content-Length: 4\r\n") && text.ends_with("\r\n\r\n"));
    }

    #[test]
    fn decodes_percent_escapes_and_queries() {
        assert_eq!(percent_decode("a%2Fb", false).as_deref(), Some("a/b"));
        assert_eq!(percent_decode("a+b", false).as_deref(), Some("a+b"));
        assert_eq!(percent_decode("a+b", true).as_deref(), Some("a b"));
        assert_eq!(percent_decode("%", false), None);
        assert_eq!(percent_decode("%4", false), None);
        assert_eq!(percent_decode("%00", false), None);
        assert_eq!(
            parse_query("a=1&&b&c=%3D").unwrap(),
            vec![
                ("a".into(), "1".into()),
                ("b".into(), String::new()),
                ("c".into(), "=".into())
            ]
        );
    }
}
