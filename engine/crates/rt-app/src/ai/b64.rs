//! Base64 (RFC 4648, standard alphabet) for the images that go to and come from the inference
//! runtime in JSON: a table-driven decoder that takes a `data:` URL too, ignores line breaks and
//! accepts missing padding; the encoder is [`crate::dialogs::base64_encode`].

const INVALID: u8 = 0xff;

const TABLE: [u8; 256] = {
    let mut t = [INVALID; 256];
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut i = 0;
    while i < 64 {
        t[alphabet[i] as usize] = i as u8;
        i += 1;
    }
    t
};

/// Decodes `text` (optionally `data:<type>;base64,<data>`), or `None` when it is not base64.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    let body = match text.strip_prefix("data:") {
        Some(rest) => rest.split_once(";base64,")?.1,
        None => text,
    };
    let mut out = Vec::with_capacity(body.len() / 4 * 3 + 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    let mut padding = 0;
    for &b in body.as_bytes() {
        match b {
            b'\r' | b'\n' | b' ' | b'\t' => continue,
            b'=' => {
                padding += 1;
                continue;
            }
            _ => {}
        }
        // Nothing but whitespace and padding after the first `=`.
        if padding > 0 {
            return None;
        }
        let v = TABLE[usize::from(b)];
        if v == INVALID {
            return None;
        }
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    // A last group of one character cannot be.
    if bits >= 6 || padding > 2 {
        return None;
    }
    Some(out)
}

/// Encodes bytes as base64 with padding.
pub fn encode(bytes: &[u8]) -> String {
    crate::dialogs::base64_encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc_4648_vectors_both_ways() {
        for (plain, coded) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(encode(plain.as_bytes()), coded);
            assert_eq!(decode(coded).unwrap(), plain.as_bytes(), "{coded}");
            assert_eq!(
                decode(coded.trim_end_matches('=')).unwrap(),
                plain.as_bytes()
            );
        }
        let all: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
        assert_eq!(decode(&encode(&all)).unwrap(), all);
        assert_eq!(
            decode("data:image/png;base64,Zm9v\r\nYmFy").unwrap(),
            b"foobar"
        );
        for bad in ["Zm9v!", "Z", "Zm=9v", "data:image/png,Zm9v", "Zg==="] {
            assert_eq!(decode(bad), None, "{bad}");
        }
    }
}
