//! A minimal HTTP/1.1 client for the launcher's own server: a second launch asks the first one
//! whether it is alive, and the tests talk to the server through it.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// A response.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reply {
    /// Status code.
    pub status: u16,
    /// Header fields, names in lower case.
    pub headers: Vec<(String, String)>,
    /// The body.
    pub body: Vec<u8>,
}

impl Reply {
    /// A header value.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// The body as text.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// Sends one request to `127.0.0.1:port` on a new connection (`Connection: close`). `headers`
/// are sent as given; `Host` is added unless present.
pub fn request(
    port: u16,
    method: &str,
    target: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    timeout: Duration,
) -> io::Result<Reply> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let mut head = format!("{method} {target} HTTP/1.1\r\n");
    if !headers.iter().any(|(n, _)| n.eq_ignore_ascii_case("host")) {
        head.push_str(&format!("Host: 127.0.0.1:{port}\r\n"));
    }
    for (n, v) in headers {
        head.push_str(&format!("{n}: {v}\r\n"));
    }
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    ));
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()?;
    read_reply(&mut BufReader::new(stream), method == "HEAD")
}

/// Reads one response (a `Content-Length` body, or up to the end of the connection).
pub fn read_reply<R: BufRead>(r: &mut R, head_only: bool) -> io::Result<Reply> {
    let bad = |m: &str| io::Error::new(io::ErrorKind::InvalidData, m.to_string());
    let mut line = String::new();
    r.read_line(&mut line)?;
    let status = line
        .split(' ')
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| bad("bad status line"))?;
    let mut headers = Vec::new();
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            return Err(bad("connection closed in the head"));
        }
        let l = line.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some((n, v)) = l.split_once(':') {
            headers.push((n.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    let mut body = Vec::new();
    if !head_only && status != 204 && status != 304 {
        match headers
            .iter()
            .find(|(n, _)| n == "content-length")
            .and_then(|(_, v)| v.parse::<u64>().ok())
        {
            Some(len) => {
                r.take(len).read_to_end(&mut body)?;
                if body.len() as u64 != len {
                    return Err(bad("short body"));
                }
            }
            None => {
                r.read_to_end(&mut body)?;
            }
        }
    }
    Ok(Reply {
        status,
        headers,
        body,
    })
}
